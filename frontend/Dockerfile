# syntax=docker/dockerfile:1
#
# SpeakEdge SPA/PWA — standalone frontend image (Vite build served by Nginx).
#
#   BUILD CONTEXT IS THE `frontend/` FOLDER, not the repo root:
#     docker build -t speakedge-web ./frontend
#     docker run -p 8080:80 -e BACKEND_URL=http://api:8000 speakedge-web
#
# The React app calls the API with RELATIVE paths (/api/v1, /media) — see
# src/lib/api.ts. So this Nginx both serves the static bundle and reverse-proxies
# /api and /media to the backend container. That keeps everything same-origin:
# no CORS config, no VITE_API_BASE, no code change when the backend host moves.

# ---------- Stage 1: build ----------
FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./
# `npm run build` == `tsc -b && vite build`, so a type error fails the image build.
RUN npm run build

# ---------- Stage 2: serve ----------
FROM nginx:1.27-alpine AS runtime

# Where /api and /media are proxied. Override per environment (compose service
# name, k8s service DNS, internal load balancer…). The nginx entrypoint runs
# envsubst over /etc/nginx/templates/*.template at container start; the FILTER
# keeps it to this one variable so nginx's own $host/$uri survive untouched.
ENV BACKEND_URL=http://backend:8000 \
    NGINX_ENVSUBST_FILTER=^BACKEND_URL$

COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --quiet --spider http://127.0.0.1/nginx-health || exit 1
