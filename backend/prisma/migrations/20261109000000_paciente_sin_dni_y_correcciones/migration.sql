-- CreateEnum
CREATE TYPE "Sexo" AS ENUM ('femenino', 'masculino');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AccionAuditoria" ADD VALUE 'corregir_paciente';
ALTER TYPE "AccionAuditoria" ADD VALUE 'cambiar_dni';
ALTER TYPE "AccionAuditoria" ADD VALUE 'editar_cita';

-- AlterTable
ALTER TABLE "pacientes" ADD COLUMN     "sexo" "Sexo",
ALTER COLUMN "dni" DROP NOT NULL;

