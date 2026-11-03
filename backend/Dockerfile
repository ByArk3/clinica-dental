# API (Node.js + Express + Prisma). Se construye desde la RAÍZ del repo (usa el workspace `shared`).
#   docker build -f backend/Dockerfile -t clinica-api .
# Imagen completa (no -slim): ya trae libssl/OpenSSL, que necesita el motor de Prisma, sin instalar nada con apt
FROM node:22-bookworm
WORKDIR /app

# 1) Dependencias (capa cacheable): manifiestos del monorepo + esquema Prisma (postinstall genera el cliente)
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY backend/prisma backend/prisma
RUN npm ci --workspace @clinica/backend --include-workspace-root --no-audit --no-fund

# 2) Código
COPY shared shared
COPY backend backend

ENV NODE_ENV=production TZ=America/Lima PORT=3000
WORKDIR /app/backend
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/api/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# sed: quita CRLF por si el archivo se editó en Windows
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npx", "tsx", "src/server.ts"]
