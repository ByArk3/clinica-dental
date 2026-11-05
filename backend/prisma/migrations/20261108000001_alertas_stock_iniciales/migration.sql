-- RN-14: insumos activos que ya están en el mínimo o por debajo, sin alerta pendiente → se les crea su alerta
-- (antes solo se generaba al bajar el stock; un mínimo subido o el inventario inicial no la creaban).
INSERT INTO "alertas_stock" ("insumo_id", "stock_al_generar", "revisada", "created_at")
SELECT i.id, i.stock_actual, false, CURRENT_TIMESTAMP
  FROM "insumos" i
 WHERE i.activo AND i.stock_actual <= i.stock_minimo
   AND NOT EXISTS (SELECT 1 FROM "alertas_stock" a WHERE a.insumo_id = i.id AND NOT a.revisada);
