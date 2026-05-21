FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libjemalloc2 \
    && rm -rf /var/lib/apt/lists/*

ENV LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libjemalloc.so.2

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN python -m pip install --upgrade pip && \
    python -m pip install -r /app/requirements.txt

COPY App /app/App
COPY docker/backend/entrypoint.sh /app/docker/backend/entrypoint.sh
COPY docker/backend/reconciler_entrypoint.sh /app/docker/backend/reconciler_entrypoint.sh
COPY docker/backend/wait_for_db.py /app/docker/backend/wait_for_db.py

RUN chmod +x /app/docker/backend/entrypoint.sh /app/docker/backend/reconciler_entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/docker/backend/entrypoint.sh"]
