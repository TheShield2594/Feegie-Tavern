# syntax=docker/dockerfile:1
#
# Cozy Cove — browser build, served as static files.
#
# Two stages so the runtime image carries no toolchain: the build stage needs
# node and ~200 MB of dev dependencies, the runtime stage needs a static file
# server and the contents of dist/.
#
# This is the browser-only target. When the multiplayer server lands it becomes
# a second service alongside this one rather than a change to this file — the
# client stays a pile of static files either way.

# --- build -----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first: this layer is rebuilt only when the lockfile changes, so
# editing source does not re-download node_modules on every image build.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY tools ./tools
COPY public ./public

# `npm run build` is `tsc --noEmit && vite build`, so a type error fails the
# image build rather than shipping a broken bundle.
RUN npm run build

# --- runtime ---------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# nginx:alpine already drops to an unprivileged user for its workers.
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
