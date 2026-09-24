# syntax=docker/dockerfile:1.7
# Flowboard images, all built from this one Dockerfile:
#
#   --target api   backend: REST API, MCP server (/api/mcp), realtime socket, jobs, agent plugins
#   --target web   nginx: the built web app + reverse proxy to the api (one origin for everything)
#   --target app   all-in-one: api that also serves the web app (default; simplest single-container deploy)
#
# docker-compose.yml runs db + api + web (+ optional MinIO).

ARG NODE_IMAGE=node:24-alpine

# ---- Build: web app (Vite) + compiled API (SWC) ----
FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json ./
# A lockfile generated on Windows/macOS can miss Linux-only optional packages; npm ci then
# refuses, so fall back to a lockfile-guided install.
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY tsconfig*.json ./
COPY scripts ./scripts
COPY packages ./packages
COPY apps ./apps
RUN npm run build

# ---- Production dependencies only ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN (npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund) && npm cache clean --force

# ---- api: backend + MCP server ----
FROM ${NODE_IMAGE} AS api
RUN apk add --no-cache tini
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    UPLOAD_DIR=/data/uploads
WORKDIR /app
RUN mkdir -p /data/uploads && chown -R node:node /data
COPY --chown=node:node package.json ./
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /src/build ./
# Agent plugin sources (skills, hooks, rules) — bundles are generated from these at request time.
COPY --chown=node:node integrations ./integrations
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1
# tini forwards signals so Nest shuts down gracefully (closes sockets, DB pool, job worker).
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "apps/server/src/main.js"]

# ---- web: nginx serving the UI and proxying /api, the socket and OAuth discovery ----
FROM nginxinc/nginx-unprivileged:1.29-alpine AS web
ENV API_UPSTREAM=api:3000
COPY deploy/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /src/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:8080/" >/dev/null || exit 1

# ---- app (default): all-in-one — the api also serves the web app ----
FROM api AS app
ENV WEB_DIST=/app/apps/web/dist
COPY --from=build --chown=node:node /src/apps/web/dist ./apps/web/dist
