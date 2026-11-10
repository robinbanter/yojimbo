#!/bin/sh
# nginx in the background, the server in the foreground: if the server exits, the container exits and restarts.
set -e
nginx -c /app/deploy/nginx.conf
cd /app/packages/server
exec ./node_modules/.bin/tsx src/index.ts
