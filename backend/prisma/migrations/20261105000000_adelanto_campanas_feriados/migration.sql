-- Reglas acordadas con el equipo (nov. 2026):
--  · Adelanto = 50 % del tratamiento previsto para pacientes con 3+ inasistencias y reservas con < 24 h; plazo 1 h.
--  · Pago por Yape/Plin reportado por el paciente → «pago_en_verificacion» → caja aprueba o rechaza.
--  · Saldo a favor (adelanto sobrante o cita cancelada a tiempo) y devoluciones (cancela la clínica).
--  · Descuentos = campañas con fechas, tratamientos y edad máxima; se aplican por línea en caja.
--  · Feriados sin atención.
-- CreateEnum
CREATE TYPE "TipoDescuento" AS ENUM ('porcentaje', 'tres_por_dos');

-- CreateEnum
CREATE TYPE "TipoMovimientoSaldo" AS ENUM ('abono_sobrante', 'abono_cancelacion', 'uso_en_cobro');

-- CreateEnum
CREATE TYPE "MetodoPagoReportado" AS ENUM ('yape', 'plin');

-- AlterEnum
ALTER TYPE "EstadoCita" ADD VALUE 'pago_en_verificacion';

-- DropForeignKey
ALTER TABLE "comprobantes" DROP CONSTRAINT "comprobantes_descuento_id_fkey";

-- AlterTable
ALTER TABLE "citas" ADD COLUMN     "adelanto_vence_en" TIMESTAMP(3),
ADD COLUMN     "monto_adelanto" DECIMAL(10,2),
ADD COLUMN     "pago_captura" BYTEA,
ADD COLUMN     "pago_captura_tipo" TEXT,
ADD COLUMN     "pago_metodo" "MetodoPagoReportado",
ADD COLUMN     "pago_operacion" VARCHAR(40),
ADD COLUMN     "pago_rechazo_motivo" TEXT,
ADD COLUMN     "pago_reportado_en" TIMESTAMP(3),
ADD COLUMN     "tratamiento_previsto_id" INTEGER;

-- AlterTable
ALTER TABLE "comprobantes" DROP COLUMN "descuento_id",
ADD COLUMN     "operacion" VARCHAR(40),
ADD COLUMN     "saldo_aplicado" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "descuentos" ADD COLUMN     "edad_maxima" INTEGER,
ADD COLUMN     "fecha_fin" DATE NOT NULL DEFAULT CURRENT_DATE,
ADD COLUMN     "fecha_inicio" DATE NOT NULL DEFAULT CURRENT_DATE,
ADD COLUMN     "tipo" "TipoDescuento" NOT NULL DEFAULT 'porcentaje',
ALTER COLUMN "porcentaje" DROP NOT NULL;

-- AlterTable
ALTER TABLE "detalle_comprobante" ADD COLUMN     "descuento" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "descuento_id" INTEGER;

-- AlterTable
ALTER TABLE "pacientes" ADD COLUMN     "saldo_favor" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "descuento_tratamiento" (
    "descuento_id" INTEGER NOT NULL,
    "tratamiento_id" INTEGER NOT NULL,

    CONSTRAINT "descuento_tratamiento_pkey" PRIMARY KEY ("descuento_id","tratamiento_id")
);

-- CreateTable
CREATE TABLE "saldo_movimientos" (
    "id" SERIAL NOT NULL,
    "paciente_id" INTEGER NOT NULL,
    "tipo" "TipoMovimientoSaldo" NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "saldo" DECIMAL(10,2) NOT NULL,
    "cita_id" INTEGER,
    "comprobante_id" INTEGER,
    "motivo" TEXT,
    "usuario_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saldo_movimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devoluciones" (
    "id" SERIAL NOT NULL,
    "cita_id" INTEGER NOT NULL,
    "paciente_id" INTEGER NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "motivo" TEXT NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devoluciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feriados" (
    "id" SERIAL NOT NULL,
    "fecha" DATE NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "feriados_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saldo_movimientos_paciente_id_created_at_idx" ON "saldo_movimientos"("paciente_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "devoluciones_cita_id_key" ON "devoluciones"("cita_id");

-- CreateIndex
CREATE UNIQUE INDEX "feriados_fecha_key" ON "feriados"("fecha");

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_tratamiento_previsto_id_fkey" FOREIGN KEY ("tratamiento_previsto_id") REFERENCES "tratamientos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "descuento_tratamiento" ADD CONSTRAINT "descuento_tratamiento_descuento_id_fkey" FOREIGN KEY ("descuento_id") REFERENCES "descuentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "descuento_tratamiento" ADD CONSTRAINT "descuento_tratamiento_tratamiento_id_fkey" FOREIGN KEY ("tratamiento_id") REFERENCES "tratamientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldo_movimientos" ADD CONSTRAINT "saldo_movimientos_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldo_movimientos" ADD CONSTRAINT "saldo_movimientos_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldo_movimientos" ADD CONSTRAINT "saldo_movimientos_comprobante_id_fkey" FOREIGN KEY ("comprobante_id") REFERENCES "comprobantes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldo_movimientos" ADD CONSTRAINT "saldo_movimientos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devoluciones" ADD CONSTRAINT "devoluciones_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devoluciones" ADD CONSTRAINT "devoluciones_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devoluciones" ADD CONSTRAINT "devoluciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalle_comprobante" ADD CONSTRAINT "detalle_comprobante_descuento_id_fkey" FOREIGN KEY ("descuento_id") REFERENCES "descuentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Los descuentos manuales anteriores no tienen vigencia: se desactivan (el Administrador puede reconfigurarlos)
UPDATE "descuentos" SET "activo" = false;
ALTER TABLE "descuentos" ALTER COLUMN "fecha_inicio" DROP DEFAULT, ALTER COLUMN "fecha_fin" DROP DEFAULT;

-- ============================ Restricciones (CHECK) ============================
ALTER TABLE "descuentos" ADD CONSTRAINT "descuentos_vigencia" CHECK ("fecha_inicio" <= "fecha_fin");
ALTER TABLE "descuentos" ADD CONSTRAINT "descuentos_tipo_porcentaje" CHECK (
  ("tipo" = 'porcentaje' AND "porcentaje" IS NOT NULL) OR ("tipo" = 'tres_por_dos' AND "porcentaje" IS NULL));
ALTER TABLE "descuentos" ADD CONSTRAINT "descuentos_edad" CHECK ("edad_maxima" IS NULL OR "edad_maxima" BETWEEN 0 AND 120);
ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_saldo_no_negativo" CHECK ("saldo_favor" >= 0);
ALTER TABLE "citas" ADD CONSTRAINT "citas_adelanto_no_negativo" CHECK ("monto_adelanto" IS NULL OR "monto_adelanto" >= 0);
ALTER TABLE "detalle_comprobante" ADD CONSTRAINT "detalle_descuento_rango" CHECK ("descuento" >= 0 AND "descuento" <= "precio");
ALTER TABLE "devoluciones" ADD CONSTRAINT "devoluciones_monto_positivo" CHECK ("monto" > 0);

-- total = subtotal − descuento − adelanto − saldo a favor; vuelto = recibido − total
ALTER TABLE "comprobantes" DROP CONSTRAINT "comprobantes_montos";
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_montos" CHECK (
  "subtotal" > 0 AND "descuento" >= 0 AND "adelanto_aplicado" >= 0 AND "saldo_aplicado" >= 0 AND "total" >= 0
  AND "total" = "subtotal" - "descuento" - "adelanto_aplicado" - "saldo_aplicado"
  AND "monto_recibido" >= "total" AND "vuelto" = "monto_recibido" - "total"
);
