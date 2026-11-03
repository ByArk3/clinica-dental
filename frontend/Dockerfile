# Web (React + Vite) compilada y servida por nginx. Se construye desde la RAÍZ del repo.
#   docker build -f frontend/Dockerfile -t clinica-web .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace @clinica/frontend --include-workspace-root --ignore-scripts --no-audit --no-fund
COPY shared shared
COPY frontend frontend
RUN npm run build -w @clinica/frontend

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
