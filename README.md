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

## Avance — Iteración 2 ✅ completa

| Caso de uso | Pruebas |
|---|---|
| CU-12 Actualizar stock: `StockService.registrarMovimiento(tx, …)` (bloqueo de fila, kárdex con saldo, alerta RN-14 sin duplicar, salida que no alcanza → 0 + observación) | `stock.test.ts` |
| CU-14..17 Tarifario: agregar con insumos que consume, listar/buscar/filtrar, modificar (precio solo a futuro), desactivar/activar | `inventario.test.ts`, `Iteracion2.test.tsx` |
| CU-18..22 Insumos: registrar con stock inicial (kárdex), listar (filtro «en stock mínimo»), modificar sin tocar el stock, desactivar (no si lo usa un tratamiento activo), buscar | `inventario.test.ts` |
| Kárdex por insumo y alertas pendientes (lectura; CU-23/24 completos en la iteración 4) | `inventario.test.ts` |
| CU-10 Consultar historial clínico: búsqueda por DNI o nombre, ficha + atenciones (más reciente primero), 2.1, 4.1 (RN-07), 5.1 | `atencion.test.ts`, `Iteracion2.test.tsx` |
| CU-11 Registrar tratamiento: mis citas del día, diagnóstico, pieza FDI 11–48, uno o más tratamientos activos (RN-08), tabla de insumos a descontar; en una transacción: atención + precio congelado + cita «Atendida» + salidas de stock (RN-09) | `atencion.test.ts`, `Iteracion2.test.tsx` |

## Avance — Iteración 3 ✅ completa

| Caso de uso | Pruebas |
|---|---|
| CU-13 Emitir comprobante: pendientes de caja, importe (RN-10, precios congelados de la atención), descuento (P3), efectivo con vuelto / tarjeta / Yape-Plin, comprobante interno correlativo `C-000001` (P2) y cita «Pagada» en una transacción | `caja.test.ts`, `Caja.test.tsx` |
| Flujos alternos 3.1 (adelanto RN-12 → la cita vuelve a «Pendiente de confirmación»), 4.1 (sin precio), 6.1 (monto insuficiente), 9.1 (sin correo), 10.1 (error al imprimir: reintentar) | `caja.test.ts`, `Caja.test.tsx` |
| Adelanto (P6): S/ 30 configurable, se descuenta del cobro final | `caja.test.ts` |
| PDF del comprobante (pdfkit) y envío por correo con el PDF adjunto | `caja.test.ts` |

## Avance — Iteración 4 ✅ completa

| Caso de uso | Pruebas |
|---|---|
| CU-26..29 Proveedores: registrar (RUC de 11 dígitos, único), listar/buscar, modificar, desactivar (no con pedidos pendientes) | `pedido.test.ts` |
| CU-30 Registrar pedido: proveedor activo (3.1), ≥ 1 insumo (8.1), precarga desde alertas (1.1), código `PED-0001`, stock sin cambios; PDF y envío al proveedor | `pedido.test.ts`, `Iteracion4.test.tsx` |
| CU-31 Listar pedidos · CU-32 Anular (solo pendientes, con motivo; RN-13) | `pedido.test.ts`, `Iteracion4.test.tsx` |
| CU-33 Registrar recepción: «verifiqué» obligatorio (RN-15), 2.1, 6.1 (diferencias → observación y «Recibido con diferencias», suma solo lo recibido), en una transacción | `pedido.test.ts`, `Iteracion4.test.tsx` |
| CU-23 Kárdex con filtros (fechas, tipo) · CU-24 Revisar alertas (quién y cuándo; se cierran solas al reponer sobre el mínimo) · CU-25 Ajuste / merma (con motivo, sin stock negativo) | `admin.test.ts` |
| CU-34..37 Usuarios: registrar personal (odontólogo con CMP), listar, modificar (cierra sesiones al cambiar clave, correo o rol), desactivar (cierra sesiones); el Administrador no se desactiva ni se quita el rol | `admin.test.ts` |
| Descuentos (P3) y monto del adelanto (P6) gestionados por el Administrador | `admin.test.ts` |
| CU-38 Panel de control · CU-39 Reporte de ingresos · CU-40 Reporte de inventario (rango de fechas, exportación CSV para Excel) | `reporte.test.ts`, `Iteracion4.test.tsx` |

Total: **171 pruebas de API + 50 de interfaz**. Los 40 casos de uso del brief están implementados.

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
- **Atención:** solo el odontólogo de la cita, con la cita «Confirmada» y de hoy o de un día anterior (no futura).
  Si se elige dos veces el mismo tratamiento (p. ej. dos piezas), se cobra y se descuenta dos veces.
- **Alertas de stock (RN-14):** se genera una cuando el saldo queda ≤ mínimo, y no se repite mientras haya una sin revisar.
- **Insumo desactivado:** un tratamiento no puede reactivarse mientras alguno de sus insumos esté desactivado.
- **Caja:** con tarjeta o Yape/Plin se cobra el total exacto (sin vuelto). El correlativo se asigna con un bloqueo
  (`pg_advisory_xact_lock`), así no quedan números repetidos ni huecos. Una restricción `CHECK` en la base garantiza
  `total = subtotal − descuento − adelanto` y `vuelto = recibido − total`.
- **Adelanto (RN-12 / P6):** no admite descuentos y solo se cobra si la cita aún no pasó. Si el adelanto supera el cobro
  final, el total queda en S/ 0.00. `TODO(decisión P6)`: ¿qué pasa con el saldo sobrante, o con el adelanto de una cita
  cancelada? Hoy no se devuelve ni se acumula.
- Los descuentos (P3) y el monto del adelanto (P6) se gestionan en **Configuración** (Administrador). La semilla carga
  «Paciente frecuente», 10 %. `TODO(decisión P3)`: confirmar con la clínica qué descuentos existen.
- **Alertas (CU-24):** además de marcarse como revisadas a mano, se cierran solas cuando una recepción o un ajuste
  deja el stock sobre el mínimo; queda registrado quién hizo la reposición.
- **Pedidos:** sin precios (P13). El código `PED-0001` es correlativo sin huecos. Si un insumo no llegó, se registra 0
  y no genera movimiento.
- **Usuarios:** los pacientes crean su cuenta en la web; el Administrador gestiona al personal. El rol de odontólogo no
  se asigna ni se quita a una cuenta existente, porque tiene citas y atenciones vinculadas: se registra un usuario nuevo.
- Los precios de Extracción, Blanqueamiento y Consulta en la semilla son de ejemplo: `TODO(decisión)`.
