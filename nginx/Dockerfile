# Stage 1: Build frontend
FROM node:22-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN rm -f public/img && mkdir -p public/img
RUN npm run build

# Stage 2: nginx
FROM nginx:alpine
RUN apk add --no-cache openssl
COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
