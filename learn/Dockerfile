# Збірка статичного фронтенду learn і роздача його через nginx на порту 5173.
# Контекст збірки: корінь репозиторію (docker-compose.yml: context: ., dockerfile: learn/Dockerfile),
# бо сторінці "Схема проєкту" потрібен docs/architecture.excalidraw: prebuild копіює його у public/.
FROM node:22-alpine AS build
WORKDIR /app/learn
COPY learn/package.json learn/package-lock.json ./
RUN npm ci
COPY learn/ ./
COPY docs/architecture.excalidraw /app/docs/architecture.excalidraw
ARG VITE_API_URL=http://localhost:8080
ARG VITE_JAEGER_URL=http://localhost:16686
ARG VITE_GRAFANA_URL=http://localhost:3001
ENV VITE_API_URL=$VITE_API_URL VITE_JAEGER_URL=$VITE_JAEGER_URL VITE_GRAFANA_URL=$VITE_GRAFANA_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/learn/dist /usr/share/nginx/html
# SPA: будь-який шлях віддає index.html, маршрути обробляє react-router.
RUN printf 'server {\n  listen 5173;\n  root /usr/share/nginx/html;\n  location / { try_files $uri /index.html; }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 5173
