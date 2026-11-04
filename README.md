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

## Opción rápida: Docker (recomendado para el equipo)

Requisito: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows, macOS o Linux).

```bash
docker compose up --build
```

Abrir **http://localhost:8080** y entrar con los usuarios de prueba de abajo. La primera vez tarda unos minutos.

| Contenedor | Qué es |
|---|---|
| `db` | PostgreSQL 16; los datos se guardan en el volumen `datos-db` |
| `api` | Backend (Express + Prisma). Al arrancar aplica las migraciones y carga la semilla (`SEED=true`). Corre las tareas programadas |
| `web` | Frontend compilado en nginx, que redirige `/api` al contenedor `api` (mismo origen: la cookie de sesión funciona sin CORS) |

Comandos útiles:

```bash
docker compose logs -f api          # ver la API (y los correos simulados si no hay SMTP)
docker compose down                 # detener (los datos se conservan)
docker compose down -v              # detener y BORRAR la base de datos
docker compose exec db psql -U clinica clinica_dental   # consola SQL
```

Para cambiar el puerto, la clave de la base, el SMTP, etc., copiar `.env.docker.example` a `.env` en la raíz.
**En producción (con HTTPS):** `COOKIE_SECURE=true`, `SEED=false` y un `SESSION_SECRET` largo y aleatorio.

## Instalación sin Docker (desarrollo)

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

Total: **211 pruebas de API + 58 de interfaz** (incluye las reglas acordadas en nov. 2026). Los 40 casos de uso del brief están implementados.

**Tareas programadas** (`backend/src/jobs`, node-cron, cada 15 min, hora de Lima; se activan con `JOBS_ENABLED=true`):
primero libera las citas sin confirmar a menos de 24 h y luego envía el recordatorio por correo a las que empiezan dentro de 48 h.
Si el paciente no tiene correo, «Citas del día» muestra el botón **Recordar por WhatsApp** (enlace `wa.me`, P7).

**RN-02 (sin cruces de citas)** se protege en dos niveles: bloqueo `SELECT … FOR UPDATE` de la fila del odontólogo
dentro de la transacción, y el índice único parcial `cita_horario_activo` (migración inicial). Si una reserva web y una
presencial piden el mismo horario a la vez, una se graba y la otra recibe **409 «El horario ya no está disponible»**.

## Reglas acordadas con el equipo (nov. 2026)

**Adelanto**

| Regla | Decisión |
|---|---|
| Quién paga | Pacientes con 3 o más inasistencias (RN-12) y reservas con menos de 24 h de anticipación |
| Cuánto | 50 % del **tratamiento previsto** elegido al reservar (por defecto, la Consulta), con la campaña vigente el **día de la cita** |
| Plazo | 1 hora desde la reserva. En la clínica se cobra en el momento |
| Pago web | Yape/Plin: el paciente registra el N.° de operación (y una captura opcional) → «Pago en verificación» (ya no se libera) → la recepcionista aprueba o rechaza en Caja |
| Sin pagar ni reportar en 1 hora | El horario se libera solo (tarea cada 5 min) |
| Al aprobar o cobrar | Comprobante de adelanto y la cita queda **Confirmada**, sin enlace de confirmación |
| Cobro final | Se descuentan el adelanto y el saldo a favor; si el adelanto supera el cobro, lo que sobra queda como **saldo a favor** |
| Cancela con ≥ 24 h / con < 24 h o no asiste / cancela la clínica | Saldo a favor / se pierde / se **devuelve** (los reportes de ingresos restan las devoluciones) |
| Reprograma | El adelanto pagado pasa a la nueva fecha |

**Tarifario** (estimado para Trujillo; la clínica debe confirmarlo): Consulta S/ 40 · Profilaxis S/ 80 · Destartraje S/ 120 ·
Curación con resina S/ 120 · Extracción simple S/ 80 · Extracción compleja S/ 250 · Blanqueamiento S/ 450 ·
Aplicación de flúor S/ 40 · Sellante por pieza S/ 35.

**Campañas de descuento** (Configuración → Campañas; se aplican solas en caja según la fecha de la cita; si dos aplican a
la misma línea gana la mayor): Campaña escolar 1 feb–31 mar (flúor y sellantes 30 %, hasta 17 años) · Fiestas Patrias
1–31 jul (limpieza 20 %, blanqueamiento 25 %, resinas 3x2) · Día de la Odontología Peruana 4 dic (consulta 50 %) ·
Campaña navideña 1–31 dic (blanqueamiento y destartraje 20 %). Los porcentajes no indicados por el equipo son propuestos.

**Feriados**: no se atiende. La semilla carga los feriados nacionales del año actual y el siguiente (Configuración → Feriados).
Al agregar uno, se listan las citas de ese día para reprogramarlas.

**Horarios**: cada odontólogo tiene el suyo, dentro de L–S 08:00–20:00 (Configuración → Horarios). De ejemplo:
Dr. Paredes L–V 08:00–14:00 y Dra. Díaz L–S 14:00–20:00. Sin horario propio, usa el general.

> Si ya tenías la base de datos de antes (Docker), para tener el tarifario y las campañas nuevas empieza de cero:
> `docker compose down -v` y luego `docker compose up --build` (borra los datos de prueba anteriores).

## Decisiones y supuestos

Se aplican los supuestos de la sección 14 del brief (P2–P17). Además:

- `bcryptjs` en lugar de `bcrypt` (mismo algoritmo, sin compilación nativa).
- Prisma 6 (versión estable).
- `comprobantes.tipo` (`servicio` | `adelanto`), con único `(cita_id, tipo)`, para emitir el adelanto de RN-12 y luego
  el comprobante final de la misma cita. Por eso `detalle_comprobante.tratamiento_id` admite NULL.
- Tablas extra: `descuentos` + `descuento_tratamiento` (campañas), `saldo_movimientos`, `devoluciones`, `feriados`,
  `configuracion` (bloque de 30 min, datos de Yape/Plin), `session` (sesiones).
- `citas.recordatorio_enviado_en` para no repetir el recordatorio de 48 h; `fichas_paciente.notas` para anotar inasistencias.
- El enlace de confirmación (CU-08) no pide sesión y solo muestra el nombre de pila, el odontólogo, la fecha y la hora.
  Al reprogramar se genera un enlace nuevo y el anterior deja de servir.
- **Atención:** solo el odontólogo de la cita, con la cita «Confirmada» y de hoy o de un día anterior (no futura).
  Si se elige dos veces el mismo tratamiento (p. ej. dos piezas), se cobra y se descuenta dos veces.
- **Alertas de stock (RN-14):** se genera una cuando el saldo queda ≤ mínimo, y no se repite mientras haya una sin revisar.
- **Insumo desactivado:** un tratamiento no puede reactivarse mientras alguno de sus insumos esté desactivado.
- **Caja:** con tarjeta o Yape/Plin se cobra el total exacto (sin vuelto). El correlativo se asigna con un bloqueo
  (`pg_advisory_xact_lock`), así no quedan números repetidos ni huecos. Una restricción `CHECK` en la base garantiza
  `total = subtotal − descuento − adelanto − saldo a favor` y `vuelto = recibido − total`.
- **Pago reportado:** el sistema no puede ver los pagos que llegan a Yape/Plin (no avisan a ningún programa), por eso la
  recepcionista los verifica. Una pasarela (Culqi, Izipay, Niubiz, Mercado Pago) lo haría automático: mejora futura.
- La captura del pago se guarda en la base (máx. 2 MB) y no se carga al listar citas (omisión global de Prisma).
- **Alertas (CU-24):** además de marcarse como revisadas a mano, se cierran solas cuando una recepción o un ajuste
  deja el stock sobre el mínimo; queda registrado quién hizo la reposición.
- **Pedidos:** sin precios (P13). El código `PED-0001` es correlativo sin huecos. Si un insumo no llegó, se registra 0
  y no genera movimiento.
- **Usuarios:** los pacientes crean su cuenta en la web; el Administrador gestiona al personal. El rol de odontólogo no
  se asigna ni se quita a una cuenta existente, porque tiene citas y atenciones vinculadas: se registra un usuario nuevo.
- `TODO(decisión)`: confirmar los precios del tarifario y los porcentajes de las campañas con la clínica.
