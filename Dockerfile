# Multi-stage production image (A-B16.1).
# TypedSQL (`prisma generate --sql`) needs a reachable Postgres at build time:
#   docker build --network=host \
#     --build-arg MIGRATOR_DATABASE_URL="$MIGRATOR_DATABASE_URL" \
#     -t fintech-backend:local -f Dockerfile .
ARG NODE_IMAGE=node:24.21.0-alpine3.24

# --- deps: full lockfile install (includes Nest CLI + prisma for build/migrate) ---
FROM ${NODE_IMAGE} AS deps
RUN apk add --no-cache openssl ca-certificates
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# --- build: generate TypedSQL client + Nest dist ---
FROM deps AS build
COPY . .
# Prisma TypedSQL introspects the DB; pass a real migrator URL at build time.
ARG MIGRATOR_DATABASE_URL
ENV MIGRATOR_DATABASE_URL=${MIGRATOR_DATABASE_URL}
RUN test -n "$MIGRATOR_DATABASE_URL" || (echo "MIGRATOR_DATABASE_URL build-arg is required for prisma generate --sql" >&2 && exit 1)
RUN npx prisma generate --sql && npm run build \
  && test -f dist/main.js \
  && test -d dist/generated/prisma

# --- migrate: keeps prisma CLI; runs migrate deploy (one-shot Compose service) ---
FROM deps AS migrate
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
# Generated client is not required for migrate deploy; schema + migrations are.
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# --- runtime: production deps only, non-root, healthcheck ---
FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache openssl ca-certificates wget \
  && mkdir -p /app \
  && chown node:node /app
WORKDIR /app
COPY --chown=node:node package.json package-lock.json .npmrc ./
# @prisma/client peers `prisma` (CLI) as optional; strip it so the image has no CLI / test runner.
RUN npm ci --omit=dev \
  && rm -rf node_modules/prisma \
  && npm cache clean --force \
  && test ! -d node_modules/vitest \
  && test ! -d node_modules/prisma
COPY --from=build --chown=node:node /app/dist ./dist
# Compose prod secrets loader (A-B16.2)
COPY --chmod=755 docker/entrypoint.sh /entrypoint.sh
USER node
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/v1/health/live >/dev/null || exit 1
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/main.js"]
