
-- CreateEnum
CREATE TYPE "AccionAuditoria" AS ENUM ('ver_historial', 'editar_atencion', 'anular_comprobante', 'bloqueo_login', 'desbloqueo_login');

-- AlterEnum
ALTER TYPE "TipoMovimientoSaldo" ADD VALUE 'reversion_anulacion';

-- DropIndex
DROP INDEX "comprobantes_cita_id_tipo_key";

-- AlterTable
ALTER TABLE "comprobantes" ADD COLUMN     "anulado_en" TIMESTAMP(3),
ADD COLUMN     "anulado_por" INTEGER,
ADD COLUMN     "motivo_anulacion" TEXT;

-- CreateTable
CREATE TABLE "atencion_ediciones" (
    "id" SERIAL NOT NULL,
    "atencion_id" INTEGER NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "anterior" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "atencion_ediciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER,
    "accion" "AccionAuditoria" NOT NULL,
    "paciente_id" INTEGER,
    "detalle" TEXT,
    "ip" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intentos_login" (
    "email" TEXT NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_hasta" TIMESTAMP(3),
    "actualizado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intentos_login_pkey" PRIMARY KEY ("email")
);

-- CreateIndex
CREATE INDEX "atencion_ediciones_atencion_id_idx" ON "atencion_ediciones"("atencion_id");

-- CreateIndex
CREATE INDEX "auditoria_created_at_idx" ON "auditoria"("created_at");

-- CreateIndex
CREATE INDEX "auditoria_paciente_id_created_at_idx" ON "auditoria"("paciente_id", "created_at");

-- CreateIndex
CREATE INDEX "auditoria_usuario_id_created_at_idx" ON "auditoria"("usuario_id", "created_at");

-- CreateIndex
CREATE INDEX "comprobantes_cita_id_idx" ON "comprobantes"("cita_id");

-- CreateIndex
CREATE INDEX "comprobantes_created_at_idx" ON "comprobantes"("created_at");

-- AddForeignKey
ALTER TABLE "atencion_ediciones" ADD CONSTRAINT "atencion_ediciones_atencion_id_fkey" FOREIGN KEY ("atencion_id") REFERENCES "atenciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atencion_ediciones" ADD CONSTRAINT "atencion_ediciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_anulado_por_fkey" FOREIGN KEY ("anulado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Un solo comprobante VIGENTE por cita y tipo; los anulados conservan su número y no bloquean volver a emitir
CREATE UNIQUE INDEX "comprobantes_cita_tipo_vigente" ON "comprobantes"("cita_id", "tipo") WHERE "anulado_en" IS NULL;

-- Anulado ⇔ con quién, cuándo y por qué
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_anulacion_completa"
  CHECK ((anulado_en IS NULL AND anulado_por IS NULL AND motivo_anulacion IS NULL)
      OR (anulado_en IS NOT NULL AND anulado_por IS NOT NULL AND motivo_anulacion IS NOT NULL));

ALTER TABLE "intentos_login" ADD CONSTRAINT "intentos_login_no_negativo" CHECK (intentos >= 0);
