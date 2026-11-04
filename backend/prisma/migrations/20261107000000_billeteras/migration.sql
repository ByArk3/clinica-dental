-- Billeteras aceptadas configurables (hoy solo Yape). Sin cambios de estructura: solo datos.
-- El tipo de pago de caja «Yape/Plin» pasa a llamarse según las billeteras aceptadas.
UPDATE "tipos_pago" SET "nombre" = 'Yape'
 WHERE "nombre" = 'Yape/Plin' AND NOT EXISTS (SELECT 1 FROM "tipos_pago" WHERE "nombre" IN ('Yape', 'Plin'));
INSERT INTO "configuracion" ("clave", "valor") VALUES ('pago_billeteras', 'yape') ON CONFLICT ("clave") DO NOTHING;
