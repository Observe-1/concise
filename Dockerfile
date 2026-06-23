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

# gosu lets the entrypoint drop from root to the requested PUID/PGID cleanly
# (exec, no extra process) on NAS platforms. ~2 MB; nothing else is added.
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/* \
  && gosu nobody true

# BACKUP_DIR sits under the same /data volume as the database, so automatic and
# manual backups persist across container rebuilds (see BACKUP.md). For disaster
# recovery still copy the volume off-host periodically.
#
# PUID/PGID/UMASK make the container NAS-friendly (Unraid, Synology, TrueNAS):
# the entrypoint runs the app as that host user so files on a bind-mounted /data
# are owned correctly. Defaults match the image's built-in `node` user (1000);
# on Unraid set PUID=99 / PGID=100. TZ only affects log readability — all of
# Concise's own date logic is UTC (see lib/dates.ts).
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/concise.db \
    BACKUP_DIR=/data/backups \
    WEB_DIST_DIR=/app/web/dist \
    PUID=1000 \
    PGID=1000 \
    TZ=Etc/UTC

# Production node_modules, the compiled server, and the static web app.
# server/package.json carries "type": "module" so Node loads the ESM bundle.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY server/package.json ./server/package.json

# The bundle reads migrations from <dist>/migrations at startup (import.meta.dirname),
# but esbuild does not copy them — bring the .sql files alongside the bundle.
COPY --from=build /app/server/src/db/migrations ./server/dist/migrations

# Privilege-dropping entrypoint (PUID/PGID). Strip any CRLF in case the script
# was checked out on Windows, then make it executable.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
  && chmod +x /usr/local/bin/docker-entrypoint.sh

# Seed /data owned by the default runtime user; the entrypoint re-chowns it to
# PUID/PGID at startup when those differ (e.g. Unraid's 99:100).
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

# NOTE: the image starts as root so the entrypoint can chown /data and drop to
# PUID/PGID via gosu. It never runs the app as root — see docker-entrypoint.sh.
# The hardened docker-compose stack pins `user:` so the entrypoint skips the
# drop and runs unprivileged from the start.
EXPOSE 3000

# The API exposes GET /api/health; use Node's global fetch (no curl in slim).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/dist/index.js"]
