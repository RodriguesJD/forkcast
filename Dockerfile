# Stage 1: build the static site. --platform=$BUILDPLATFORM runs node natively on the CI
# runner (amd64) even when the target image is arm64; the output is plain files either way.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
COPY public/ public/
COPY src/ src/
RUN npm run build

# Stage 2: serve dist/ with nginx. This is the only stage that is actually arm64.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
