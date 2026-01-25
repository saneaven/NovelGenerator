#!/bin/sh
set -eu

python /app/docker/backend/wait_for_db.py

cd /app/App/backend
alembic upgrade head
cd /app

APP_MODULE="${APP_MODULE:-App.backend.main:app}"
HOST="${UVICORN_HOST:-0.0.0.0}"
PORT="${UVICORN_PORT:-8000}"
RELOAD="${UVICORN_RELOAD:-0}"

RELOAD_ARGS=""
if [ "$RELOAD" = "1" ] || [ "$RELOAD" = "true" ]; then
  RELOAD_ARGS="--reload"
fi

exec python -m uvicorn "$APP_MODULE" --host "$HOST" --port "$PORT" $RELOAD_ARGS
