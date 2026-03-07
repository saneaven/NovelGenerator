"""Periodic storage usage reconcile worker."""

from __future__ import annotations

import logging
import os
import time

from ..database import SessionLocal
from ..services.storage_usage_service import (
    release_reconcile_advisory_lock,
    run_storage_usage_reconcile_cycle,
    try_acquire_reconcile_advisory_lock,
)


logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() not in {"0", "false", "off", "no"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not str(raw).strip():
        return default
    return int(raw)


def main() -> int:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

    enabled = _env_bool("STORAGE_USAGE_RECONCILER_ENABLED", True)
    if not enabled:
        logger.info("Storage usage reconciler disabled")
        return 0

    interval_seconds = max(_env_int("STORAGE_USAGE_RECONCILER_INTERVAL_SECONDS", 300), 1)
    batch_size = max(_env_int("STORAGE_USAGE_RECONCILER_BATCH_SIZE", 100), 1)
    stale_after_seconds = max(_env_int("STORAGE_USAGE_RECONCILER_STALE_AFTER_SECONDS", 86400), 1)
    advisory_lock_key = _env_int("STORAGE_USAGE_RECONCILER_ADVISORY_LOCK_KEY", 84512001)
    run_once = _env_bool("STORAGE_USAGE_RECONCILER_RUN_ONCE", False)

    while True:
        db = SessionLocal()
        acquired = False
        try:
            acquired = try_acquire_reconcile_advisory_lock(db, lock_key=advisory_lock_key)
            if not acquired:
                logger.info("Storage usage reconciler lock busy; skipping cycle")
            else:
                result = run_storage_usage_reconcile_cycle(
                    session_factory=SessionLocal,
                    batch_size=batch_size,
                    stale_after_seconds=stale_after_seconds,
                )
                logger.info(
                    "Storage usage reconcile cycle finished scanned=%s reconciled=%s drifted=%s failed=%s",
                    result.scanned_projects,
                    result.reconciled_projects,
                    result.drifted_projects,
                    result.failed_projects,
                )
        finally:
            if acquired:
                try:
                    release_reconcile_advisory_lock(db, lock_key=advisory_lock_key)
                except Exception:  # noqa: BLE001
                    logger.exception("Failed to release storage usage reconcile advisory lock")
            db.close()

        if run_once:
            return 0
        time.sleep(interval_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
