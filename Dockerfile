# syntax=docker/dockerfile:1.7

# ---------- Build stage ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- Runtime stage ----------
FROM nginx:1.27-alpine AS runtime

ARG GIT_SHA=unknown
ARG GIT_REF=unknown
ARG BUILD_TIME=unknown

LABEL org.opencontainers.image.title="ind-ulb-dashboard" \
      org.opencontainers.image.source="https://github.com/xrvk/ind-ulb-dashboard" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.ref.name="${GIT_REF}" \
      org.opencontainers.image.created="${BUILD_TIME}" \
      org.opencontainers.image.licenses="MIT"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Emit /version.json so a running container can be compared to the registry.
RUN printf '{"sha":"%s","ref":"%s","builtAt":"%s"}\n' \
      "$GIT_SHA" "$GIT_REF" "$BUILD_TIME" \
      > /usr/share/nginx/html/version.json

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
