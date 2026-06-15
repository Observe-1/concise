# syntax=docker/dockerfile:1

# Concise — minimalist personal finance tracker.
# One Node.js process serves the JSON API and the built SPA; state is a single
# SQLite file on a mounted volume. node:sqlite is built into Node, so there is
# no native build step and the runtime image needs no compilers.

# ---- Stage 1: build the server bundle and the static frontend ----
FROM node:24-slim AS build
WORKDIR /app

# Install all deps (incl. dev) from manifests first so this layer caches until
# a package*.json changes. npm ci needs every workspace manifest present.
COPY package.json package-lock.json tsconfig.base.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
COPY e2e/package.json ./e2e/
RUN npm ci

# esbuild bundles the server to dist/index.js; Vite builds the static web app.
COPY . .
RUN npm run build

# ---- Stage 2: production-only dependencies ----
# The server bundle keeps node packages external, so the runtime needs the
# production dependency tree (express, helmet, zod, …) — but none of the dev
# toolchain (esbuild, vite, vitest, playwright).
FROM node:24-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
COPY e2e/package.json ./e2e/
RUN npm ci --omit=dev

# ---- Stage 3: minimal runtime image ----
FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/concise.db \
    WEB_DIST_DIR=/app/web/dist

# Production node_modules, the compiled server, and the static web app.
# server/package.json carries "type": "module" so Node loads the ESM bundle.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY server/package.json ./server/package.json

# The bundle reads migrations from <dist>/migrations at startup (import.meta.dirname),
# but esbuild does not copy them — bring the .sql files alongside the bundle.
COPY --from=build /app/server/src/db/migrations ./server/dist/migrations

# Persist the SQLite database on a volume owned by the non-root runtime user so
# the app can create and write the DB file.
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3000

# The API exposes GET /api/health; use Node's global fetch (no curl in slim).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
