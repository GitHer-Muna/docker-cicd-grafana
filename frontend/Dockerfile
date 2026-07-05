# ─────────────────────────────────────────────────────────────────────
# Stage 1 — Build the Vite React app
# ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies (cached layer — only invalidated when package files change)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ─────────────────────────────────────────────────────────────────────
# Stage 2 — Serve with Nginx
# ─────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

# Copy built assets from stage 1
COPY --from=build /app/dist /usr/share/nginx/html

# Copy SPA-aware Nginx configuration
COPY frontend-nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
