
-- AlterEnum
ALTER TYPE "AccionAuditoria" ADD VALUE 'reabrir_alerta';

-- AlterEnum
ALTER TYPE "TipoMovimientoSaldo" ADD VALUE 'vencimiento';

-- AlterTable
ALTER TABLE "saldo_movimientos" ADD COLUMN     "aviso_dias" INTEGER,
ADD COLUMN     "restante" DECIMAL(10,2),
ADD COLUMN     "vence_en" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "saldo_movimientos_vence_en_idx" ON "saldo_movimientos"("vence_en");


-- Saldo a favor con vigencia: a cada abono existente se le calcula lo que queda (se usa primero lo más antiguo)
-- y vence 12 meses después de generarse.
WITH pos AS (
  SELECT id, paciente_id, monto, SUM(monto) OVER (PARTITION BY paciente_id ORDER BY created_at, id) AS acumulado
    FROM saldo_movimientos WHERE monto > 0
), neg AS (
  SELECT paciente_id, -SUM(monto) AS usado FROM saldo_movimientos WHERE monto < 0 GROUP BY paciente_id
)
UPDATE saldo_movimientos s
   SET restante = GREATEST(0, LEAST(p.monto, p.acumulado - COALESCE(n.usado, 0))),
       vence_en = s.created_at + interval '12 months'
  FROM pos p LEFT JOIN neg n ON n.paciente_id = p.paciente_id
 WHERE s.id = p.id;

ALTER TABLE "saldo_movimientos" ADD CONSTRAINT "saldo_restante_valido"
  CHECK (restante IS NULL OR (monto > 0 AND restante >= 0 AND restante <= monto));

INSERT INTO "configuracion" ("clave", "valor") VALUES ('saldo_vigencia_meses', '12') ON CONFLICT ("clave") DO NOTHING;
-- Tipo de pago para adelantos cubiertos con el saldo a favor
INSERT INTO "tipos_pago" ("nombre") VALUES ('Saldo a favor') ON CONFLICT ("nombre") DO NOTHING;
