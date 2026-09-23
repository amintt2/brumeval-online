# syntax=docker/dockerfile:1
# Brumeval Online — image de production (voir docs/DEPLOIEMENT.md).
#   docker build -t brumeval .
#   docker run -d -p 3000:3000 -v brumeval-data:/app/server/data brumeval

# ---- 1. compilation du client (Vite) -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --no-audit --no-fund
COPY shared shared
COPY client client
# [accounts] version of the launcher installers linked by the website (client/vite.config.js)
COPY launcher/package.json launcher/package.json
RUN npm run build

# ---- 2. dépendances d'exécution du serveur seulement (ws) ----------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace server --no-audit --no-fund

# ---- 3. image finale -----------------------------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/server/data \
    STATIC_DIR=/app/client/dist
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY package.json ./
COPY server/package.json server/
COPY server/src server/src
COPY shared shared
COPY --from=build /app/client/dist client/dist
RUN mkdir -p /app/server/data && chown -R node:node /app/server/data
USER node
VOLUME ["/app/server/data"]
EXPOSE 3000
# /health répond 200 tant que le serveur tourne (statut « ok » ou « degraded » selon le p95 du tick)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1
# node reçoit directement SIGTERM (docker stop) : sauvegarde des comptes puis arrêt propre
STOPSIGNAL SIGTERM
CMD ["node", "server/src/index.js"]
