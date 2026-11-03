#!/bin/sh
# Aplica migraciones (y la semilla si SEED=true) antes de iniciar la API.
set -e
echo "[api] aplicando migraciones…"
npx prisma migrate deploy
if [ "$SEED" = "true" ]; then
  echo "[api] cargando datos de ejemplo (idempotente)…"
  npx tsx prisma/seed.ts
fi
exec "$@"
