#!/bin/sh
# Aplica migraciones (y la semilla si SEED=true) antes de iniciar la API.
set -e

# Secreto de sesión: si no se configuró (o es el de ejemplo), se genera uno aleatorio para este arranque.
# Es seguro, pero las sesiones se cierran al reiniciar el contenedor. En producción defina SESSION_SECRET en .env.
case "$SESSION_SECRET" in
  ""|solo-desarrollo|cambie-este-secreto-en-produccion|cambie-esto-por-un-secreto-largo)
    SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    export SESSION_SECRET
    echo "[api] AVISO: SESSION_SECRET sin configurar; se generó uno temporal (las sesiones se cierran al reiniciar)."
    ;;
esac

echo "[api] aplicando migraciones…"
npx prisma migrate deploy
if [ "$SEED" = "true" ]; then
  echo "[api] cargando datos de ejemplo (idempotente)…"
  npx tsx prisma/seed.ts
fi
exec "$@"
