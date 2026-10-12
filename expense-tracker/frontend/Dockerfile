FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- test/lint image ----
FROM build AS dev

# ---- runtime: unprivileged nginx on 8080 ----
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
ENV BACKEND_HOST=backend BACKEND_PORT=8000
# The official image renders /etc/nginx/templates/*.template with envsubst at start-up.
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8080/nginx-health || exit 1
