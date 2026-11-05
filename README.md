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

Para la **demo** (con usuarios de prueba), copiar `.env.docker.example` a `.env` (ya trae `SEED=true`) o activarlo al arrancar:

```bash
copy .env.docker.example .env
```
```bash
docker compose up --build
```

(Sin `.env`, en PowerShell: `$env:SEED="true"; docker compose up --build`; en Linux/macOS: `SEED=true docker compose up --build`.)

Abrir **http://localhost:8080** y entrar con los usuarios de prueba de abajo. La primera vez tarda unos minutos.
Si `docker compose up --build` falla con `failed to execute bake`, construir con
`docker build -f backend/Dockerfile -t clinica-dental-api .` y `docker build -f frontend/Dockerfile -t clinica-dental-web .`,
y luego `docker compose up`.

| Contenedor | Qué es |
|---|---|
| `db` | PostgreSQL 16; los datos se guardan en el volumen `datos-db` |
| `api` | Backend (Express + Prisma). Al arrancar aplica las migraciones y, solo si `SEED=true`, carga la semilla (por defecto `false`). Corre las tareas programadas |
| `web` | Frontend compilado en nginx, que redirige `/api` al contenedor `api` (mismo origen: la cookie de sesión funciona sin CORS) |

Comandos útiles:

```bash
docker compose logs -f api          # ver la API (y los correos simulados si no hay SMTP)
docker compose down                 # detener (los datos se conservan)
docker compose down -v              # detener y BORRAR la base de datos
docker compose exec db psql -U clinica clinica_dental   # consola SQL
```

Para cambiar el puerto, la clave de la base, el SMTP, etc., copiar `.env.docker.example` a `.env` en la raíz.
**En producción (con HTTPS):** `COOKIE_SECURE=true`, `SEED=false` y un `SESSION_SECRET` aleatorio de 32+ caracteres
(`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Fuera de Docker, con `NODE_ENV=production`
la API **no arranca** si falta, es corto o es un valor de ejemplo. En Docker, si se deja vacío, el contenedor genera uno
aleatorio en cada arranque (seguro, pero las sesiones se cierran al reiniciar).

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
| CU-08 Recordar cita (aviso 48 h con enlace para cancelar o reprogramar; v2) + tareas programadas | `confirmacion.test.ts`, `Iteracion1.test.tsx` |
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
| Flujos alternos 3.1 (adelanto RN-12 → la cita queda «Confirmada»), 4.1 (sin precio), 6.1 (monto insuficiente), 9.1 (sin correo), 10.1 (error al imprimir: reintentar) | `caja.test.ts`, `Caja.test.tsx` |
| Adelanto (P6, v2): 50 % del tratamiento previsto (100 % con 3+ inasistencias), se descuenta del cobro final | `caja.test.ts` |
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

Total: **273 pruebas de API + 96 de interfaz** (al commit de esta revisión). Los 40 casos de uso del brief y los CU-41 a CU-57 del informe v17 están implementados.

**Tareas programadas** (`backend/src/jobs`, node-cron, hora de Lima; se activan con `JOBS_ENABLED=true`):
- **Cada 5 min:** libera las reservas cuyo adelanto no se pagó ni reportó en 1 hora (RN-04; también las citas antiguas
  «Pendiente de confirmación» a menos de 24 h) y luego envía el recordatorio (CU-08) a las citas confirmadas que empiezan
  dentro de 48 h. Si el paciente no tiene correo, «Citas del día» muestra **Recordar por WhatsApp** (enlace `wa.me`, P7).
- **Diaria (07:10):** saldo a favor (RN-17): vence los abonos cumplidos y avisa por correo 30 y 7 días antes.

**RN-02 (sin cruces de citas)** se protege en dos niveles: bloqueo `SELECT … FOR UPDATE` de la fila del odontólogo
dentro de la transacción, y el índice único parcial `cita_horario_activo` (migración inicial). Si una reserva web y una
presencial piden el mismo horario a la vez, una se graba y la otra recibe **409 «El horario ya no está disponible»**.

## Reglas acordadas con el equipo (nov. 2026)

**Adelanto**

| Regla | Decisión |
|---|---|
| Quién paga | **Toda reserva** (web, presencial o por teléfono) — cambio v2 |
| Cuánto | 50 % del **tratamiento previsto** elegido al reservar (por defecto, la «Consulta de evaluación»), con la campaña vigente el **día de la cita**; **100 %** si el paciente tiene 3 o más inasistencias (RN-12) |
| Plazo | 1 hora desde la reserva. En la clínica se cobra en el momento |
| Saldo a favor | Se usa primero para el adelanto: si lo cubre todo, la cita queda **Confirmada** al instante (comprobante S/ 0.00); si cubre una parte, se paga solo la diferencia |
| Pago web | Yape/Plin: el paciente registra el N.° de operación (y una captura opcional) → «Pago en verificación» (ya no se libera) → la recepcionista aprueba o rechaza en Caja |
| Sin pagar ni reportar en 1 hora | El horario se libera solo (tarea cada 5 min) |
| Al aprobar o cobrar | Comprobante de adelanto y la cita queda **Confirmada**. **CU-08 pasa a «Recordar cita»**: 48 h antes se envía un aviso (correo o WhatsApp) con un enlace para cancelar o reprogramar; ya no hay que confirmar |
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

## Seguridad, auditoría y correcciones (nov. 2026)

| Función | Cómo funciona |
|---|---|
| **Límite de intentos** | Al 3.er intento fallido seguido, la cuenta se bloquea **15 minutos** (también para correos que no existen, para no revelar cuáles están registrados). El mensaje indica cuántos intentos quedan. Un ingreso correcto reinicia el contador. El Administrador puede desbloquear desde **Usuarios**; restablecer la contraseña también lo quita |
| **Auditoría** | Cada vez que se abre la ficha (historial clínico) de un paciente queda **quién, con qué rol, de qué paciente y cuándo**. También se registran correcciones de atenciones, anulaciones y bloqueos. El Administrador lo consulta en **Auditoría** (filtros por fechas, DNI, usuario y acción) |
| **Editar una atención** | Solo el odontólogo que la registró, con **motivo** obligatorio. Se guarda la versión anterior: el historial muestra «Editado el … por … – motivo: …» y lo que decía antes. Si cambian los tratamientos, el stock se corrige con la diferencia y los que se mantienen conservan su precio congelado. Si ya se cobró, solo se corrigen diagnóstico y observaciones |
| **Anular un comprobante** | No se borra: conserva su número (sin huecos), queda «Anulado», no cuenta en ingresos y su PDF muestra el sello. Recepcionista: solo los del día; Administrador: cualquiera; siempre con motivo. **Servicio**: la cita vuelve a «Atendida», el saldo a favor usado vuelve al paciente y el generado se retira (si ya se usó en otro cobro, primero se anula ese). **Adelanto**: si la cita aún no ocurre, vuelve a «Pendiente de adelanto» con 1 hora nueva |

| **Mostrar contraseña** | Botón con un ojo en todos los campos de contraseña (inicio de sesión, recuperación, registro y usuarios) |
| **Sesión** | «Cerrar sesión» vuelve al login de inmediato; si la sesión vence (15 min sin uso), cualquier pantalla lleva al login |

**Pagos del adelanto (Configuración → Pagos)**: el Administrador marca las billeteras que acepta (hoy solo **Yape**; Plin se
activa con una casilla) y en Caja el tipo de pago toma ese nombre («Yape», «Plin» o «Yape/Plin»). También sube el **QR** de la
clínica (PNG, JPG o WEBP, máx. 2 MB; en Yape: «Mi QR» → Compartir), que el paciente ve junto al número y al monto. El QR personal
de Yape no vence; se reemplaza o quita desde la misma pantalla. La semilla usa un número **ficticio**: el real se pone ahí.

**Correo**: con `SMTP_*` en `.env` (p. ej. un Gmail de la clínica con *contraseña de aplicación*) se envían recuperación de
contraseña, recordatorios, comprobantes y avisos. Sin SMTP los correos no salen y sus **enlaces se muestran en el log de la API**
(`docker compose logs api`), para poder probar.

**Autocompletar con el DNI (RENIEC)**: en Nueva cita, si el DNI no está registrado, se completan nombres y apellidos con un
proveedor de consultas RENIEC (RENIEC no da acceso directo a clínicas privadas). Requiere `RENIEC_TOKEN` en `.env` (por defecto
[Decolecta](https://decolecta.com); `RENIEC_URL` permite otro proveedor). Sin token, sin consultas o si no responde en 5 s, la
recepcionista escribe los datos. Para el informe: el tratamiento de datos personales se rige por la **Ley 29733**.

> Supuesto para el informe: los comprobantes son **internos** (P2). En una boleta electrónica real de SUNAT, la anulación se hace con una **nota de crédito**.

**Saldo a favor con vigencia**: cada abono vence a los **12 meses** (Configuración → Pagos; 0 = no vence). Se usa primero lo
que vence antes, se avisa por correo **30 y 7 días antes**, y el paciente ve sus vencimientos en «Mis datos». Lo vencido queda
registrado como movimiento «vencimiento».

**Otros ajustes**: horario de cada odontólogo en la lista al reservar («Lunes–Viernes 08:00–14:00») y debajo del campo; campos
numéricos con solo dígitos y largo fijo (DNI 8, RUC 11, celular 9, N.° de operación, CMP, porcentaje, edad) también validados
en la API; aviso de Insumos con todos los insumos en el mínimo y leyenda del color; alertas revisadas por error se pueden
«Volver a pendiente» (auditoría); al subir el mínimo de un insumo por encima de su stock se crea la alerta; razón social con el
RUC (SUNAT, mismo token que RENIEC).

**Interfaz (v3)**: modo oscuro (botón 🌙/☀️ en la esquina de todas las pantallas; se recuerda), efectos al pasar el mouse (filas, botones, menú, pestañas,
tarjetas), entrada suave de cada pantalla, botones que muestran «Guardando…» y ✓ al terminar, campos de dígitos con ✓/✗,
copiar el número de Yape y el N.° de operación con un toque, globos de ayuda en los estados de la cita, vista previa en Caja,
contadores animados en el Panel, «Pago en verificación» con un punto que late, QR ampliable, confirmación antes de registrar
un pago, pedido desde alertas resaltado (con proveedor sugerido) y buscador de insumos sin tildes y tolerante a errores.
Respeta «reducir movimiento» del sistema operativo.

> Para el informe (v2): cambian **RN-12** (100 % con 3+ inasistencias), **P6** (adelanto en toda reserva), **CU-06**, **CU-07**,
> **CU-08** (de «Confirmar cita» a «Recordar cita»; **CU-07 «extend» CU-08**: la flecha va de CU-07 hacia CU-08) y **CU-13**,
> y el diagrama de estados de la cita («Pendiente de confirmación» queda solo para citas anteriores al cambio).

## Numeración del informe v17

**Reglas de negocio que cambiaron o se agregaron**

| RN | Regla |
|---|---|
| RN-03 *(cambió)* | Citas solo dentro del horario de **cada odontólogo**; **en feriados no se atiende** |
| RN-04 *(cambió)* | La reserva queda confirmada **al pagar el adelanto**; si no se paga ni se reporta en **1 hora**, se libera. 48 h antes se envía un **recordatorio** |
| RN-10 *(cambió)* | Importe = tarifario − **campañas vigentes el día de la cita** (si dos aplican, la mayor) |
| RN-12 *(cambió)* | **Toda reserva** requiere un adelanto del 50 % del tratamiento previsto; **100 %** con 3 o más inasistencias |
| RN-16 | Cancelar con ≥ 24 h → saldo a favor; con < 24 h o inasistencia → se pierde; si cancela la clínica → devolución; al reprogramar, el adelanto pasa a la nueva fecha |
| RN-17 | El saldo a favor se usa primero (lo que vence antes) y vence a los 12 meses (configurable); avisos 30 y 7 días antes |
| RN-18 | El pago por Yape/Plin solo confirma la cita después de que la recepcionista lo verifica; solo se aceptan las billeteras habilitadas |
| RN-19 | Los comprobantes no se borran: se anulan con motivo y conservan su número. La recepcionista anula solo los del día; el administrador, cualquiera |
| RN-20 | Solo el odontólogo que registró una atención puede corregirla, con motivo y guardando la versión anterior; si ya está cobrada, solo diagnóstico y observaciones |
| RN-21 | 3 intentos fallidos de inicio de sesión → bloqueo de 15 minutos |
| RN-22 | Los accesos al historial, las correcciones, las anulaciones y los bloqueos quedan en la auditoría |

**Casos de uso nuevos**

| CU | Nombre | Actor | Relación | En el código |
|---|---|---|---|---|
| CU-41 | Pagar adelanto | Paciente | «extend» de CU-06 | `POST /citas/:id/pago` |
| CU-42 | Verificar pago de adelanto | Recepcionista | — | `POST /caja/citas/:id/aprobar-pago` y `/rechazar-pago` |
| CU-43 | Anular comprobante | Recepcionista, Administrador | — | `PATCH /comprobantes/:id/anular` |
| CU-44 | Corregir atención | Odontólogo | «extend» de CU-10 | `GET/PATCH /atenciones/:id` |
| CU-45 | Consultar auditoría | Administrador | — | `GET /admin/auditoria` |
| CU-46 | Desbloquear usuario | Administrador | «extend» de CU-35 | `PATCH /usuarios/:id/desbloquear` |
| CU-47 | Registrar campaña de descuento | Administrador | — | `POST /admin/descuentos` |
| CU-48 | Listar campañas | Administrador | — | `GET /admin/descuentos` |
| CU-49 | Modificar campaña | Administrador | «extend» de CU-48 | `PATCH /admin/descuentos/:id` |
| CU-50 | Desactivar campaña | Administrador | «extend» de CU-48 | `PATCH /admin/descuentos/:id/desactivar` |
| CU-51 | Registrar feriado | Administrador | — | `POST /admin/feriados` |
| CU-52 | Listar feriados | Administrador | — | `GET /admin/feriados` |
| CU-53 | Eliminar feriado | Administrador | «extend» de CU-52 | `DELETE /admin/feriados/:id` |
| CU-54 | Configurar horario del odontólogo | Administrador | — | `GET/PUT /admin/odontologos/:id/horario` |
| CU-55 | Configurar datos de pago | Administrador | — | `GET/PUT /admin/pago`, `PUT/DELETE /admin/pago/qr` |
| CU-56 | Consultar saldo a favor | Paciente | — | «Mis datos» (`GET /pacientes/me`) |
| CU-57 | Consultar datos en RENIEC o SUNAT | Recepcionista, Administrador + actor externo | «extend» de CU-03 y de CU-26 | `GET /reniec/:dni`, `GET /sunat/:ruc` |

Los «include» del diagrama son solo tres: **CU-05** (desde CU-06 y CU-07), **CU-12** (desde CU-11, CU-25 y CU-33) y
**CU-22 Buscar insumo** (desde CU-23, CU-25 y CU-30). En CU-44 el ajuste de stock es un flujo alterno, no un «include».
CU-57 es «extend» porque es opcional: sin token, sin consultas, sin respuesta en 5 s o sin datos, el registro sigue a mano
(hay pruebas con el proveedor caído).

## Riesgos conocidos

- **Bloqueo de cuentas (RN-21):** cualquiera que conozca el correo de un usuario puede bloquearlo 15 minutos fallando
  3 veces. Se acepta para el curso; el administrador puede desbloquear desde Usuarios (CU-46). En producción se
  complementaría con límite por IP o CAPTCHA.
- **Límite de «Recuperar contraseña»:** 3 solicitudes cada 15 minutos por IP (la 4.ª responde 429) y por correo (no se
  envían más, con la misma respuesta). Los contadores están en memoria: valen para un solo servidor.
- **Datos personales (Ley 29733):** de RENIEC/SUNAT solo se usan nombres, apellidos, razón social y estado; no se guarda la
  respuesta ni se registra el DNI/RUC en el log. Los correos escapan los datos que escriben los usuarios (nombres, motivos).

## Decisiones y supuestos

Se aplican los supuestos de la sección 14 del brief (P2–P17). Además:

- `bcryptjs` en lugar de `bcrypt` (mismo algoritmo, sin compilación nativa).
- Prisma 6 (versión estable).
- `comprobantes.tipo` (`servicio` | `adelanto`), con único `(cita_id, tipo)` entre los comprobantes vigentes (los anulados no cuentan), para emitir el adelanto de RN-12 y luego
  el comprobante final de la misma cita. Por eso `detalle_comprobante.tratamiento_id` admite NULL.
- Tablas extra: `descuentos` + `descuento_tratamiento` (campañas), `saldo_movimientos`, `devoluciones`, `feriados`,
  `configuracion` (bloque de 30 min, datos de Yape/Plin), `session` (sesiones).
- `citas.recordatorio_enviado_en` para no repetir el recordatorio de 48 h; `fichas_paciente.notas` para anotar inasistencias.
- El enlace del recordatorio (CU-08, `/citas/recordatorio/:token`; `/citas/confirmar/:token` sigue funcionando) no pide sesión y solo muestra el nombre de pila, el odontólogo, la fecha y la hora.
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
