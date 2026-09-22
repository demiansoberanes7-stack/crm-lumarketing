# ============================================================
# LUMARK CRM — imagen multi-etapa (Next.js standalone + Node 22)
# Los secretos NO se necesitan en build: llegan en runtime.
# ============================================================

FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --no-frozen-lockfile

FROM deps AS test
RUN apk add --no-cache chromium
COPY . .
CMD ["node", "scripts/e2e-lumark.mjs"]

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Commit del que sale la imagen, para que la app pueda decir qué está corriendo.
ARG SOURCE_COMMIT=""
ARG GIT_SHA=""
ENV SOURCE_COMMIT=$SOURCE_COMMIT
ENV GIT_SHA=$GIT_SHA
RUN pnpm build
# migrate.mjs autocontenido (drizzle-orm + postgres bundleados)
RUN pnpm exec esbuild scripts/migrate.mjs --bundle --platform=node \
    --format=esm --outfile=migrate.bundle.mjs \
    --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
RUN pnpm exec esbuild scripts/seed/demo.ts --bundle --platform=node \
    --format=esm --outfile=seed-demo.bundle.mjs --alias:@=./src \
    --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S lumark && adduser -S lumark -G lumark
# Punto de montaje del volumen de adjuntos, propiedad del usuario de la app
RUN mkdir -p /data/media && chown -R lumark:lumark /data

COPY --from=builder --chown=lumark:lumark /app/.next/standalone ./
COPY --from=builder --chown=lumark:lumark /app/.next/static ./.next/static
COPY --from=builder --chown=lumark:lumark /app/public ./public
COPY --from=builder --chown=lumark:lumark /app/migrate.bundle.mjs ./migrate.mjs
COPY --from=builder --chown=lumark:lumark /app/seed-demo.bundle.mjs ./seed-demo.mjs
COPY --from=builder --chown=lumark:lumark /app/drizzle ./drizzle

USER lumark
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# start-period amplio: cubre las migraciones del arranque
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1

# Migrar al BOOT del contenedor nuevo y arrancar el server standalone
CMD ["sh", "-c", "node migrate.mjs && node server.js"]
