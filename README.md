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

## Avance — Iteración 1 (parcial)

| Caso de uso | Estado | Pruebas |
|---|---|---|
| CU-01 Iniciar / cerrar sesión (cookie httpOnly, 15 min deslizantes) | ✅ | `backend/tests/auth.test.ts` |
| CU-02 Recuperar contraseña (enlace de 30 min, un solo uso) | ✅ | `auth.test.ts` |
| CU-03 Registrar paciente (recepcionista) y crear cuenta (web) + ficha (RN-05) | ✅ | `paciente.test.ts` |
| CU-05 Consultar disponibilidad (horario − citas activas − horas pasadas; sugiere fecha) | ✅ | `cita.test.ts` |
| CU-06 Registrar cita web y presencial: 4.1, 8.1, 8.2, RN-01/02/03/12 | ✅ | `cita.test.ts`, `frontend/src/test/*` |
| Menú y rutas por rol (RNF07), vista móvil 360 px (RNF02) | ✅ | |
| CU-04, CU-07 Reprogramar/cancelar, CU-08 Confirmar + tareas programadas, CU-09 Inasistencia | ⏳ siguiente | |

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
- Los precios de Extracción, Blanqueamiento y Consulta en la semilla son de ejemplo: `TODO(decisión)`.
