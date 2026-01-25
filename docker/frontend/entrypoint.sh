#!/bin/sh
set -eu

cd /app/App/frontend

MODE="${FRONTEND_MODE:-dev}"

if [ ! -d node_modules ] || [ -z "$(ls -A node_modules 2>/dev/null)" ]; then
  npm ci
fi

if [ "$MODE" = "prod" ]; then
  npm exec -- vite build
  exec npm run preview -- --host 0.0.0.0 --port 5173
fi

exec npm run dev -- --host 0.0.0.0 --port 5173
