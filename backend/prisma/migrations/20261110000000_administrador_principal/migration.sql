-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AccionAuditoria" ADD VALUE 'crear_usuario';
ALTER TYPE "AccionAuditoria" ADD VALUE 'modificar_usuario';
ALTER TYPE "AccionAuditoria" ADD VALUE 'desactivar_usuario';
ALTER TYPE "AccionAuditoria" ADD VALUE 'activar_usuario';
ALTER TYPE "AccionAuditoria" ADD VALUE 'traspasar_principal';

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "principal" BOOLEAN NOT NULL DEFAULT false;


-- RN-23: un solo administrador principal; si ya hay administradores, lo es el más antiguo
CREATE UNIQUE INDEX "usuarios_un_principal" ON "usuarios" ("principal") WHERE "principal";
UPDATE "usuarios" SET "principal" = true
 WHERE "id" = (SELECT "id" FROM "usuarios" WHERE "rol" = 'administrador' AND "activo" ORDER BY "id" LIMIT 1);
-- el principal siempre es un administrador activo
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_principal_admin" CHECK (NOT "principal" OR ("rol" = 'administrador' AND "activo"));
