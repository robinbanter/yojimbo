# syntax=docker/dockerfile:1
# Yojimbo on the VPS: the server (tsx, as on the Mac) and the built web app in one container. nginx on :8080 serves
# packages/web/dist and proxies /api/* to the server on 127.0.0.1:8787 with the /api prefix stripped, exactly like
# the Vite dev proxy, so the page and the API share one origin. No keys are baked in: they come from env_file at run time.
# Build context is the repo root (see docker-compose.yml); Dockerfile.dockerignore beside this file keeps .env out.
FROM node:22-bookworm-slim
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends nginx-light curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@10.29.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile --prod=false
COPY packages/core packages/core
COPY packages/server packages/server
COPY packages/web packages/web
RUN pnpm --filter @yojimbo/core build && pnpm --filter @yojimbo/web build
COPY deploy/nginx.conf deploy/start.sh deploy/
RUN chmod +x deploy/start.sh && mkdir -p packages/server/data && chown -R node:node packages/server/data
USER node
EXPOSE 8080
CMD ["/app/deploy/start.sh"]
