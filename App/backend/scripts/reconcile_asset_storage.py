"""Reconcile local asset storage (assets table ↔ files on disk).

This script is intended for ops/dev use when `ASSET_STORAGE_BACKEND=local`.

Capabilities:
- Detect orphan files on disk (not referenced by any Asset row) and optionally delete them.
- Recalculate file_size from the actual files on disk.

Run (docker-compose example):
  docker compose exec backend python -m App.backend.scripts.reconcile_asset_storage --dry-run --recalc-sizes
  docker compose exec backend python -m App.backend.scripts.reconcile_asset_storage --apply --delete-orphans --recalc-sizes
"""

from __future__ import annotations

import argparse
from pathlib import Path

from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.db_models import Asset
from ..services.storage_service import storage_service


def _iter_storage_files(base_path: Path) -> set[str]:
    files: set[str] = set()
    for root in ("originals",):
        root_path = base_path / root
        if not root_path.exists():
            continue
        for p in root_path.rglob("*"):
            if not p.is_file():
                continue
            rel = p.relative_to(base_path).as_posix()
            files.add(rel)
    return files


def _collect_referenced_paths(db: Session) -> set[str]:
    referenced: set[str] = set()
    for (file_path,) in db.query(Asset.file_path).all():
        if isinstance(file_path, str) and file_path:
            referenced.add(file_path.replace("\\", "/"))
    return referenced


def _recalc_sizes(db: Session, base_path: Path, *, apply: bool) -> dict[str, int]:
    updated_assets = 0
    updated_fields = 0
    missing_files = 0

    assets = db.query(Asset).all()
    for asset in assets:
        changed = False

        file_rel = getattr(asset, "file_path", None)
        if isinstance(file_rel, str) and file_rel:
            full = base_path / file_rel
            if full.exists() and full.is_file():
                size = int(full.stat().st_size)
                if getattr(asset, "file_size", None) != size:
                    asset.file_size = size  # type: ignore[assignment]
                    changed = True
                    updated_fields += 1
            else:
                missing_files += 1
                if getattr(asset, "file_size", None) not in (None, 0):
                    asset.file_size = 0  # type: ignore[assignment]
                    changed = True
                    updated_fields += 1

        if changed:
            updated_assets += 1

    if apply:
        db.commit()
    else:
        db.rollback()

    return {
        "updated_assets": updated_assets,
        "updated_fields": updated_fields,
        "missing_files": missing_files,
    }


def _delete_orphans(base_path: Path, orphan_paths: set[str], *, apply: bool) -> dict[str, int]:
    deleted = 0
    missing = 0

    for rel in sorted(orphan_paths):
        full = base_path / rel
        if not full.exists():
            missing += 1
            continue
        if apply:
            full.unlink(missing_ok=True)
        deleted += 1

    return {"deleted": deleted, "missing": missing}


def main() -> int:
    parser = argparse.ArgumentParser(description="Reconcile asset storage (DB ↔ disk)")
    parser.add_argument("--apply", action="store_true", help="Apply changes (default: dry-run)")
    parser.add_argument("--delete-orphans", action="store_true", help="Delete orphan files on disk")
    parser.add_argument("--recalc-sizes", action="store_true", help="Recalculate file_size from disk")
    args = parser.parse_args()

    if storage_service.backend_name != "local":
        raise SystemExit(
            "reconcile_asset_storage only supports local asset storage. "
            "Set ASSET_STORAGE_BACKEND=local before running this script."
        )

    base_path = storage_service.base_path
    if base_path is None:
        raise SystemExit("Local asset storage base path is not configured.")
    base_path.mkdir(parents=True, exist_ok=True)

    print(f"Storage base: {base_path}")
    print(f"Mode: {'APPLY' if args.apply else 'DRY-RUN'}")

    db: Session = SessionLocal()
    try:
        referenced = _collect_referenced_paths(db)
        on_disk = _iter_storage_files(base_path)

        orphan_paths = on_disk - referenced
        missing_paths = referenced - on_disk

        print(f"Referenced paths (DB): {len(referenced)}")
        print(f"Files on disk: {len(on_disk)}")
        print(f"Orphan files: {len(orphan_paths)}")
        print(f"Missing files (referenced but not found): {len(missing_paths)}")

        if args.recalc_sizes:
            stats = _recalc_sizes(db, base_path, apply=args.apply)
            print(
                "Recalc sizes:",
                f"updated_assets={stats['updated_assets']}",
                f"updated_fields={stats['updated_fields']}",
                f"missing_files_seen={stats['missing_files']}",
            )

        if args.delete_orphans:
            stats = _delete_orphans(base_path, orphan_paths, apply=args.apply)
            print("Delete orphans:", f"deleted={stats['deleted']}", f"missing={stats['missing']}")

        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
