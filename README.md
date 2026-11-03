# Clínica Dental — Sistema web de gestión

Proyecto del curso **Ingeniería del Software (RUP/UML)** — UPAO, Grupo 1.
Stack: **Node.js + Express + Prisma + PostgreSQL** (backend) · **React + Vite + TanStack Query + Bootstrap** (frontend) · **TypeScript** y esquemas **Zod** compartidos (`shared/`).

## Estructura

```
backend/   prisma/schema.prisma (e_), prisma/migrations, prisma/seed.ts
           src/routes → controllers (c_) → services (RN) · middlewares (auth, requireRol, errores) · jobs (node-cron)
frontend/  src/pages (i_) · components · api (cliente HTTP) · routes.tsx (rutas por rol)
shared/    tipos (Rol, EstadoCita), mensajes exactos y esquemas Zod
```

## Instalación

Requisitos: Node 20+ y PostgreSQL 14+.

```bash
npm install                                   # instala los 3 paquetes (workspaces) y genera el cliente Prisma
cp backend/.env.example backend/.env          # ajustar DATABASE_URL y SESSION_SECRET
createdb clinica_dental && createdb clinica_dental_test
npm run db:deploy -w backend                  # aplica las migraciones
npm run db:seed -w backend                    # datos de ejemplo (ficticios)
npm run dev:backend                           # API en http://localhost:3000/api
npm run dev:frontend                          # web en http://localhost:5173 (proxy /api → 3000)
```

Las pruebas del backend usan `backend/.env.test` (base `clinica_dental_test`), que **se vacía** en cada caso de prueba.

```bash
npm test          # backend (Vitest + Supertest contra PostgreSQL) y frontend (React Testing Library)
```

### Usuarios de prueba (contraseña `Clinica2026`)

| Rol | Correo |
|---|---|
| Recepcionista | ana.rios@clinica.local |
| Odontólogo | luis.paredes@clinica.local · carmen.diaz@clinica.local |
| Administrador | carlos.vega@clinica.local |
| Paciente (con cuenta web) | maria.quispe@correo.local (DNI 72458190) |

Sin `SMTP_HOST`, los correos (recuperación de contraseña) no se envían: solo se registran en consola.

## Avance — Iteración 1 ✅ completa

| Caso de uso | Pruebas |
|---|---|
| CU-01 Iniciar / cerrar sesión (cookie httpOnly, 15 min deslizantes) | `backend/tests/auth.test.ts` |
| CU-02 Recuperar contraseña (enlace de 30 min, un solo uso) | `auth.test.ts` |
| CU-03 Registrar paciente (recepcionista) y crear cuenta (web) + ficha (RN-05) | `paciente.test.ts` |
| CU-04 Actualizar datos de contacto (paciente: «Mis datos»; recepcionista: desde «Nueva cita») | `inasistencia.test.ts` |
| CU-05 Consultar disponibilidad (horario − citas activas − horas pasadas; sugiere fecha) | `cita.test.ts` |
| CU-06 Registrar cita web y presencial: 4.1, 8.1, 8.2, RN-01/02/03/12 | `cita.test.ts`, `frontend/src/test/FormReserva*`, `NuevaCita*` |
| CU-07 Reprogramar / cancelar (paciente hasta 24 h antes, P8; recepcionista hasta la hora de la cita) | `reprogramar.test.ts`, `Iteracion1.test.tsx` |
| CU-08 Confirmar cita por enlace (2.1, 2.2, 4.1) + tareas programadas: recordatorio 48 h y liberación 24 h (RN-04) | `confirmacion.test.ts`, `Iteracion1.test.tsx` |
| CU-09 Citas del día e inasistencias (3.1, 6.1 → paciente restringido, RN-12) | `inasistencia.test.ts`, `Iteracion1.test.tsx` |
| Menú y rutas por rol (RNF07), vistas móviles 360 px (RNF02) | |

Total: 76 pruebas de API + 18 de interfaz.

**Siguiente: Iteración 2** — tarifario e insumos (CRUD), `StockService` + kárdex + alertas, CU-10 historial clínico, CU-11 registrar atención.

**Tareas programadas** (`backend/src/jobs`, node-cron, cada 15 min, hora de Lima; se activan con `JOBS_ENABLED=true`):
primero libera las citas sin confirmar a menos de 24 h y luego envía el recordatorio por correo a las que empiezan dentro de 48 h.
Si el paciente no tiene correo, «Citas del día» muestra el botón **Recordar por WhatsApp** (enlace `wa.me`, P7).

**RN-02 (sin cruces de citas)** se protege en dos niveles: bloqueo `SELECT … FOR UPDATE` de la fila del odontólogo
dentro de la transacción, y el índice único parcial `cita_horario_activo` (migración inicial). Si una reserva web y una
presencial piden el mismo horario a la vez, una se graba y la otra recibe **409 «El horario ya no está disponible»**.

## Decisiones y supuestos

Se aplican los supuestos de la sección 14 del brief (P2–P17). Además:

- `bcryptjs` en lugar de `bcrypt` (mismo algoritmo, sin compilación nativa).
- Prisma 6 (versión estable).
- `comprobantes.tipo` (`servicio` | `adelanto`), con único `(cita_id, tipo)`, para emitir el adelanto de RN-12 y luego
  el comprobante final de la misma cita. Por eso `detalle_comprobante.tratamiento_id` admite NULL.
- Tablas extra: `descuentos` (P3), `configuracion` (duración del bloque P5, monto del adelanto P6), `session` (sesiones).
- `citas.recordatorio_enviado_en` para no repetir el recordatorio de 48 h; `fichas_paciente.notas` para anotar inasistencias.
- **Reservas de último momento:** una cita registrada (o reprogramada) con menos de 24 h de anticipación ya no tiene plazo
  para confirmarse, así que queda directamente «Confirmada»; si no, la liberación automática la anularía al instante.
  `TODO(decisión)`: validarlo con la clínica.
- El enlace de confirmación (CU-08) no pide sesión y solo muestra el nombre de pila, el odontólogo, la fecha y la hora.
  Al reprogramar se genera un enlace nuevo y el anterior deja de servir.
- Los precios de Extracción, Blanqueamiento y Consulta en la semilla son de ejemplo: `TODO(decisión)`.
