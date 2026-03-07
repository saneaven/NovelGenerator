"""Reconcile logical storage usage aggregates.

Examples:
  python -m App.backend.scripts.reconcile_storage_usage --scope dirty
  python -m App.backend.scripts.reconcile_storage_usage --scope dirty --apply
  python -m App.backend.scripts.reconcile_storage_usage --scope user --user-id <uuid> --apply
"""

from __future__ import annotations

import argparse
from uuid import UUID

from ..database import SessionLocal
from ..services.storage_usage_service import run_storage_usage_reconcile_batch


def _parse_uuid(value: str | None, *, flag: str) -> UUID | None:
    if not value:
        return None
    try:
        return UUID(value)
    except ValueError as exc:
        raise SystemExit(f"Invalid {flag} UUID") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description="Reconcile project storage usage aggregates")
    parser.add_argument("--scope", required=True, choices=["dirty", "stale", "all", "user", "project"])
    parser.add_argument("--user-id")
    parser.add_argument("--project-id")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--apply", action="store_true", help="Apply reconciled values")
    parser.add_argument("--stale-after-seconds", type=int, default=None)
    args = parser.parse_args()

    result = run_storage_usage_reconcile_batch(
        session_factory=SessionLocal,
        scope=args.scope,
        apply=bool(args.apply),
        limit=args.limit,
        stale_after_seconds=args.stale_after_seconds,
        user_id=_parse_uuid(args.user_id, flag="--user-id"),
        project_id=_parse_uuid(args.project_id, flag="--project-id"),
    )

    print(f"scope: {result.scope}")
    print(f"applied: {result.applied}")
    print(f"scanned_projects: {result.scanned_projects}")
    print(f"reconciled_projects: {result.reconciled_projects}")
    print(f"drifted_projects: {result.drifted_projects}")
    print(f"failed_projects: {result.failed_projects}")
    for item in result.results:
        print(
            "project:",
            str(item.project_id),
            f"status={item.status}",
            f"before={item.before.total_bytes}",
            f"after={item.after.total_bytes}",
            f"drift={item.drift_bytes}",
            f"needs_reconcile_after={item.needs_reconcile_after}",
            *([f"error={item.error}"] if item.error else []),
        )
    return 0 if result.failed_projects == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
