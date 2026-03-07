#!/bin/sh
set -eu

python /app/docker/backend/wait_for_db.py
cd /app

exec python -m App.backend.scripts.run_storage_usage_reconciler
