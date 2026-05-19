# Stage 1: Build frontend
FROM node:22-alpine AS frontend-build
# git is required so vite.config.ts can resolve the version via `git describe`.
RUN apk add --no-cache git
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
# Copy the repo's .git so `git describe --tags --always --dirty` works in
# vite.config.ts. This guarantees the navbar always shows the deployed SHA,
# regardless of whether the caller set the APP_VERSION build arg.
COPY .git ./.git
RUN rm -f public/img && mkdir -p public/img
# Optional explicit override (e.g. CI passes a release tag). If empty, the
# version is resolved from the in-container .git via `git describe`, so the
# navbar always shows a real SHA regardless of how the build was invoked.
ARG APP_VERSION=
RUN APP_VERSION="${APP_VERSION:-$(git describe --tags --always --dirty)}" \
    && echo "Building with APP_VERSION=${APP_VERSION}" \
    && VITE_APP_VERSION="${APP_VERSION}" npm run build

# Stage 2: nginx
FROM nginx:alpine
RUN apk add --no-cache openssl
COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
