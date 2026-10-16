# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
# A failing test fails the build, so a broken commit never replaces a working container.
RUN npm test && npm prune --omit=dev
# The commit this image is built from, for the version on the pages. Komodo builds
# from a full git clone, so .git is in the context; it stays in this stage.
RUN apk add --no-cache git \
 && git config --global --add safe.directory /app \
 && (git rev-parse HEAD > BUILD || echo dev > BUILD) \
 && rm -rf .git

FROM node:24-alpine
RUN apk add --no-cache tzdata
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/BUILD ./BUILD
COPY package.json ./
COPY src ./src
COPY public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "src/server.js"]
