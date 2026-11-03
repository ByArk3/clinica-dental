-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('paciente', 'recepcionista', 'odontologo', 'administrador');

-- CreateEnum
CREATE TYPE "CanalCita" AS ENUM ('web', 'presencial');

-- CreateEnum
CREATE TYPE "EstadoCita" AS ENUM ('pendiente_confirmacion', 'pendiente_adelanto', 'confirmada', 'atendida', 'pagada', 'cancelada', 'liberada', 'inasistencia');

-- CreateEnum
CREATE TYPE "TipoMovimiento" AS ENUM ('entrada_recepcion', 'salida_tratamiento', 'ajuste', 'merma', 'inicial');

-- CreateEnum
CREATE TYPE "EstadoPedido" AS ENUM ('pendiente', 'recibido', 'recibido_con_diferencias', 'anulado');

-- CreateEnum
CREATE TYPE "TipoComprobante" AS ENUM ('servicio', 'adelanto');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" SERIAL NOT NULL,
    "nombres" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "reset_token_hash" TEXT,
    "reset_token_expira" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pacientes" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER,
    "dni" CHAR(8) NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellidos" TEXT NOT NULL,
    "fecha_nacimiento" DATE NOT NULL,
    "telefono" TEXT NOT NULL,
    "email" TEXT,
    "direccion" TEXT,
    "apoderado" TEXT,
    "inasistencias" INTEGER NOT NULL DEFAULT 0,
    "restringido" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pacientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fichas_paciente" (
    "id" SERIAL NOT NULL,
    "paciente_id" INTEGER NOT NULL,
    "alergias" TEXT,
    "antecedentes" TEXT,
    "notas" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fichas_paciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "odontologos" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "cmp" TEXT,
    "especialidad" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "odontologos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "horarios_atencion" (
    "id" SERIAL NOT NULL,
    "odontologo_id" INTEGER,
    "dia_semana" SMALLINT NOT NULL,
    "hora_inicio" TIME(0) NOT NULL,
    "hora_fin" TIME(0) NOT NULL,

    CONSTRAINT "horarios_atencion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citas" (
    "id" SERIAL NOT NULL,
    "paciente_id" INTEGER NOT NULL,
    "odontologo_id" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "hora" TIME(0) NOT NULL,
    "motivo" VARCHAR(200) NOT NULL,
    "canal" "CanalCita" NOT NULL,
    "estado" "EstadoCita" NOT NULL,
    "token_confirmacion" TEXT,
    "recordatorio_enviado_en" TIMESTAMP(3),
    "creado_por" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "citas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atenciones" (
    "id" SERIAL NOT NULL,
    "cita_id" INTEGER NOT NULL,
    "ficha_id" INTEGER NOT NULL,
    "odontologo_id" INTEGER NOT NULL,
    "diagnostico" TEXT NOT NULL,
    "observaciones" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "atenciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atencion_tratamiento" (
    "id" SERIAL NOT NULL,
    "atencion_id" INTEGER NOT NULL,
    "tratamiento_id" INTEGER NOT NULL,
    "pieza_dental" VARCHAR(2),
    "precio_aplicado" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "atencion_tratamiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tratamientos" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tratamientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tratamiento_insumo" (
    "tratamiento_id" INTEGER NOT NULL,
    "insumo_id" INTEGER NOT NULL,
    "cantidad" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "tratamiento_insumo_pkey" PRIMARY KEY ("tratamiento_id","insumo_id")
);

-- CreateTable
CREATE TABLE "insumos" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "unidad" TEXT NOT NULL,
    "stock_actual" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "stock_minimo" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insumos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_kardex" (
    "id" SERIAL NOT NULL,
    "insumo_id" INTEGER NOT NULL,
    "tipo" "TipoMovimiento" NOT NULL,
    "cantidad" DECIMAL(10,2) NOT NULL,
    "saldo" DECIMAL(10,2) NOT NULL,
    "motivo" TEXT,
    "referencia_tipo" TEXT,
    "referencia_id" INTEGER,
    "usuario_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_kardex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alertas_stock" (
    "id" SERIAL NOT NULL,
    "insumo_id" INTEGER NOT NULL,
    "stock_al_generar" DECIMAL(10,2) NOT NULL,
    "revisada" BOOLEAN NOT NULL DEFAULT false,
    "revisada_por" INTEGER,
    "revisada_en" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alertas_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proveedores" (
    "id" SERIAL NOT NULL,
    "ruc" CHAR(11) NOT NULL,
    "razon_social" TEXT NOT NULL,
    "contacto" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "proveedor_id" INTEGER NOT NULL,
    "estado" "EstadoPedido" NOT NULL DEFAULT 'pendiente',
    "motivo_anulacion" TEXT,
    "observacion_recepcion" TEXT,
    "registrado_por" INTEGER NOT NULL,
    "recibido_en" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detalle_pedido" (
    "id" SERIAL NOT NULL,
    "pedido_id" INTEGER NOT NULL,
    "insumo_id" INTEGER NOT NULL,
    "cantidad_pedida" DECIMAL(10,2) NOT NULL,
    "cantidad_recibida" DECIMAL(10,2),

    CONSTRAINT "detalle_pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_pago" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "tipos_pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "descuentos" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "porcentaje" DECIMAL(5,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "descuentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comprobantes" (
    "id" SERIAL NOT NULL,
    "numero" TEXT NOT NULL,
    "tipo" "TipoComprobante" NOT NULL DEFAULT 'servicio',
    "cita_id" INTEGER NOT NULL,
    "paciente_id" INTEGER NOT NULL,
    "tipo_pago_id" INTEGER NOT NULL,
    "descuento_id" INTEGER,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "descuento" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL,
    "monto_recibido" DECIMAL(10,2) NOT NULL,
    "vuelto" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "enviado_email" BOOLEAN NOT NULL DEFAULT false,
    "emitido_por" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comprobantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detalle_comprobante" (
    "id" SERIAL NOT NULL,
    "comprobante_id" INTEGER NOT NULL,
    "tratamiento_id" INTEGER,
    "descripcion" TEXT NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "detalle_comprobante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion" (
    "clave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,

    CONSTRAINT "configuracion_pkey" PRIMARY KEY ("clave")
);

-- CreateTable
CREATE TABLE "session" (
    "sid" VARCHAR NOT NULL,
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_reset_token_hash_key" ON "usuarios"("reset_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "pacientes_usuario_id_key" ON "pacientes"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "pacientes_dni_key" ON "pacientes"("dni");

-- CreateIndex
CREATE INDEX "pacientes_apellidos_nombres_idx" ON "pacientes"("apellidos", "nombres");

-- CreateIndex
CREATE UNIQUE INDEX "fichas_paciente_paciente_id_key" ON "fichas_paciente"("paciente_id");

-- CreateIndex
CREATE UNIQUE INDEX "odontologos_usuario_id_key" ON "odontologos"("usuario_id");

-- CreateIndex
CREATE INDEX "horarios_atencion_odontologo_id_dia_semana_idx" ON "horarios_atencion"("odontologo_id", "dia_semana");

-- CreateIndex
CREATE UNIQUE INDEX "citas_token_confirmacion_key" ON "citas"("token_confirmacion");

-- CreateIndex
CREATE INDEX "citas_fecha_estado_idx" ON "citas"("fecha", "estado");

-- CreateIndex
CREATE INDEX "citas_paciente_id_idx" ON "citas"("paciente_id");

-- CreateIndex
CREATE INDEX "citas_odontologo_id_fecha_idx" ON "citas"("odontologo_id", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "atenciones_cita_id_key" ON "atenciones"("cita_id");

-- CreateIndex
CREATE INDEX "atenciones_ficha_id_idx" ON "atenciones"("ficha_id");

-- CreateIndex
CREATE UNIQUE INDEX "tratamientos_nombre_key" ON "tratamientos"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "insumos_nombre_key" ON "insumos"("nombre");

-- CreateIndex
CREATE INDEX "movimientos_kardex_insumo_id_created_at_idx" ON "movimientos_kardex"("insumo_id", "created_at");

-- CreateIndex
CREATE INDEX "alertas_stock_revisada_idx" ON "alertas_stock"("revisada");

-- CreateIndex
CREATE UNIQUE INDEX "proveedores_ruc_key" ON "proveedores"("ruc");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_codigo_key" ON "pedidos"("codigo");

-- CreateIndex
CREATE INDEX "pedidos_estado_idx" ON "pedidos"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_pago_nombre_key" ON "tipos_pago"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "descuentos_nombre_key" ON "descuentos"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "comprobantes_numero_key" ON "comprobantes"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "comprobantes_cita_id_tipo_key" ON "comprobantes"("cita_id", "tipo");

-- CreateIndex
CREATE INDEX "IDX_session_expire" ON "session"("expire");

-- AddForeignKey
ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fichas_paciente" ADD CONSTRAINT "fichas_paciente_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "odontologos" ADD CONSTRAINT "odontologos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horarios_atencion" ADD CONSTRAINT "horarios_atencion_odontologo_id_fkey" FOREIGN KEY ("odontologo_id") REFERENCES "odontologos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_odontologo_id_fkey" FOREIGN KEY ("odontologo_id") REFERENCES "odontologos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atenciones" ADD CONSTRAINT "atenciones_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atenciones" ADD CONSTRAINT "atenciones_ficha_id_fkey" FOREIGN KEY ("ficha_id") REFERENCES "fichas_paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atenciones" ADD CONSTRAINT "atenciones_odontologo_id_fkey" FOREIGN KEY ("odontologo_id") REFERENCES "odontologos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atencion_tratamiento" ADD CONSTRAINT "atencion_tratamiento_atencion_id_fkey" FOREIGN KEY ("atencion_id") REFERENCES "atenciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atencion_tratamiento" ADD CONSTRAINT "atencion_tratamiento_tratamiento_id_fkey" FOREIGN KEY ("tratamiento_id") REFERENCES "tratamientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tratamiento_insumo" ADD CONSTRAINT "tratamiento_insumo_tratamiento_id_fkey" FOREIGN KEY ("tratamiento_id") REFERENCES "tratamientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tratamiento_insumo" ADD CONSTRAINT "tratamiento_insumo_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "insumos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_kardex" ADD CONSTRAINT "movimientos_kardex_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "insumos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_kardex" ADD CONSTRAINT "movimientos_kardex_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas_stock" ADD CONSTRAINT "alertas_stock_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "insumos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas_stock" ADD CONSTRAINT "alertas_stock_revisada_por_fkey" FOREIGN KEY ("revisada_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalle_pedido" ADD CONSTRAINT "detalle_pedido_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalle_pedido" ADD CONSTRAINT "detalle_pedido_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "insumos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_tipo_pago_id_fkey" FOREIGN KEY ("tipo_pago_id") REFERENCES "tipos_pago"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_descuento_id_fkey" FOREIGN KEY ("descuento_id") REFERENCES "descuentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_emitido_por_fkey" FOREIGN KEY ("emitido_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalle_comprobante" ADD CONSTRAINT "detalle_comprobante_comprobante_id_fkey" FOREIGN KEY ("comprobante_id") REFERENCES "comprobantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalle_comprobante" ADD CONSTRAINT "detalle_comprobante_tratamiento_id_fkey" FOREIGN KEY ("tratamiento_id") REFERENCES "tratamientos"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================
-- Reglas que Prisma no expresa en schema.prisma
-- ============================================================

-- RN-02: un odontólogo no puede tener dos citas activas en el mismo horario.
-- Índice único PARCIAL: las citas canceladas o liberadas no ocupan el horario.
CREATE UNIQUE INDEX "cita_horario_activo" ON "citas" ("odontologo_id", "fecha", "hora")
  WHERE "estado" NOT IN ('cancelada', 'liberada');

-- CHECK de montos y cantidades
ALTER TABLE "tratamientos" ADD CONSTRAINT "tratamientos_precio_positivo" CHECK ("precio" > 0);
ALTER TABLE "tratamiento_insumo" ADD CONSTRAINT "tratamiento_insumo_cantidad_positiva" CHECK ("cantidad" > 0);
ALTER TABLE "insumos" ADD CONSTRAINT "insumos_stock_no_negativo" CHECK ("stock_actual" >= 0 AND "stock_minimo" >= 0);
ALTER TABLE "detalle_pedido" ADD CONSTRAINT "detalle_pedido_cantidad_positiva" CHECK ("cantidad_pedida" > 0);
ALTER TABLE "detalle_pedido" ADD CONSTRAINT "detalle_pedido_recibida_no_negativa" CHECK ("cantidad_recibida" IS NULL OR "cantidad_recibida" >= 0);
ALTER TABLE "descuentos" ADD CONSTRAINT "descuentos_porcentaje_rango" CHECK ("porcentaje" > 0 AND "porcentaje" <= 100);
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_montos" CHECK ("total" >= 0 AND "descuento" >= 0 AND "monto_recibido" >= "total" AND "vuelto" >= 0);
ALTER TABLE "horarios_atencion" ADD CONSTRAINT "horarios_dia_semana" CHECK ("dia_semana" BETWEEN 1 AND 7);
ALTER TABLE "horarios_atencion" ADD CONSTRAINT "horarios_rango" CHECK ("hora_inicio" < "hora_fin");
ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_dni_8_digitos" CHECK ("dni" ~ '^[0-9]{8}$');
ALTER TABLE "proveedores" ADD CONSTRAINT "proveedores_ruc_11_digitos" CHECK ("ruc" ~ '^[0-9]{11}$');
ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_inasistencias_no_negativas" CHECK ("inasistencias" >= 0);
