-- Iteración 3 (Caja): adelanto de RN-12 que se descuenta del cobro final (P6)
ALTER TABLE "comprobantes" ADD COLUMN "adelanto_aplicado" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Invariantes del comprobante (RN-10 / RN-11): total = subtotal − descuento − adelanto; vuelto = recibido − total
ALTER TABLE "comprobantes" DROP CONSTRAINT "comprobantes_montos";
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_montos" CHECK (
  "subtotal" > 0 AND "descuento" >= 0 AND "adelanto_aplicado" >= 0 AND "total" >= 0
  AND "total" = "subtotal" - "descuento" - "adelanto_aplicado"
  AND "monto_recibido" >= "total" AND "vuelto" = "monto_recibido" - "total"
);
