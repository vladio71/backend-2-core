# Один Dockerfile для API і воркера. Точка входу обирається аргументом:
#   docker build --build-arg ENTRYPOINT=main.js -t devhub-api .
#   docker build --build-arg ENTRYPOINT=worker.js -t devhub-worker .
# docker-compose.yml робить це сам для сервісів api-1, api-2, worker.

# ---- build: усі залежності, компіляція TypeScript ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src src
COPY scripts scripts
RUN npm run build

# ---- pruned: прибираємо dev-залежності (tsx, jest, eslint) ----
FROM build AS pruned
RUN npm prune --omit=dev

# ---- runtime: тільки production-залежності і dist ----
FROM node:22-alpine AS runtime
ARG ENTRYPOINT=main.js
ENV NODE_ENV=production \
    APP_ENTRYPOINT=${ENTRYPOINT}
WORKDIR /app
COPY --from=pruned /app/package.json ./
COPY --from=pruned /app/node_modules ./node_modules
COPY --from=pruned /app/dist ./dist
COPY public public
USER node
EXPOSE 3000
CMD ["sh", "-c", "exec node dist/$APP_ENTRYPOINT"]
