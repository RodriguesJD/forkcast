# Stage 1: build the client bundle and the server bundle. --platform=$BUILDPLATFORM runs node
# natively on the CI runner (amd64) even when the target image is arm64; both outputs are plain
# JavaScript, so nothing here is architecture-specific.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.app.json tsconfig.node.json tsconfig.server.json vite.config.ts index.html ./
COPY public/ public/
COPY src/ src/
COPY server/ server/
RUN npm run build

# Stage 2: the runtime image, the only stage that is really arm64. One Node process serves the
# client from dist/ and the API; SQLite is Node's built-in module, so there is no node_modules.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    FORKCAST_DATA_DIR=/data \
    FORKCAST_DIST_DIR=/app/dist \
    FORKCAST_REQUIRE_MOUNT=1
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
# /data is the persistent volume (docker-compose.yml). Owned by `node` so the volume is
# initialised writable for the unprivileged user the server runs as. Deliberately no VOLUME
# instruction: that would make Docker silently attach an anonymous volume when none is given,
# which is exactly the case FORKCAST_REQUIRE_MOUNT exists to refuse.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "--no-warnings=ExperimentalWarning", "dist-server/index.js"]
