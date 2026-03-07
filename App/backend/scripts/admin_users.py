"""Admin user management CLI.

Use this to bootstrap the first admin and manage per-user storage quotas.

Examples (docker-compose):
  docker compose exec backend python -m App.backend.scripts.admin_users show --email you@example.com
  docker compose exec backend python -m App.backend.scripts.admin_users grant --email you@example.com
  docker compose exec backend python -m App.backend.scripts.admin_users revoke --email you@example.com
  docker compose exec backend python -m App.backend.scripts.admin_users set-quota --email you@example.com --bytes 1048576000
  docker compose exec backend python -m App.backend.scripts.admin_users clear-quota --email you@example.com
"""

from __future__ import annotations

import argparse
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.db_models import User


def _find_user(db: Session, *, email: str | None, username: str | None, user_id: str | None) -> User:
    query = db.query(User)

    if user_id:
        try:
            uid = UUID(user_id)
        except Exception:
            raise SystemExit("Invalid --user-id UUID")
        user = query.filter(User.id == uid).first()
    elif email:
        user = query.filter(User.email == email).first()
    elif username:
        user = query.filter(User.username == username).first()
    else:
        raise SystemExit("Provide one of: --email, --username, --user-id")

    if not user:
        raise SystemExit("User not found")
    return user


def _print_user(user: User) -> None:
    print("user_id:", str(user.id))
    print("email:", user.email)
    print("username:", user.username)
    print("is_admin:", bool(getattr(user, "is_admin", False)))
    print("storage_quota_bytes:", getattr(user, "storage_quota_bytes", None))


def main() -> int:
    parser = argparse.ArgumentParser(description="Admin user management")
    sub = parser.add_subparsers(dest="cmd", required=True)

    def add_ident(p: argparse.ArgumentParser) -> None:
        p.add_argument("--email")
        p.add_argument("--username")
        p.add_argument("--user-id")

    p_show = sub.add_parser("show", help="Show user fields")
    add_ident(p_show)

    p_grant = sub.add_parser("grant", help="Grant admin role")
    add_ident(p_grant)

    p_revoke = sub.add_parser("revoke", help="Revoke admin role")
    add_ident(p_revoke)

    p_set_quota = sub.add_parser("set-quota", help="Set per-user storage quota override")
    add_ident(p_set_quota)
    p_set_quota.add_argument("--bytes", type=int, required=True)

    p_clear_quota = sub.add_parser("clear-quota", help="Clear per-user storage quota override")
    add_ident(p_clear_quota)

    args = parser.parse_args()

    db: Session = SessionLocal()
    try:
        user = _find_user(db, email=args.email, username=args.username, user_id=args.user_id)

        if args.cmd == "show":
            _print_user(user)
            return 0

        if args.cmd == "grant":
            user.is_admin = True
            db.commit()
            db.refresh(user)
            _print_user(user)
            return 0

        if args.cmd == "revoke":
            if not user.is_admin:
                _print_user(user)
                return 0

            admin_count = db.query(func.count(User.id)).filter(User.is_admin == True).scalar()  # noqa: E712
            if int(admin_count or 0) <= 1:
                raise SystemExit("Refusing to revoke the last admin")

            user.is_admin = False
            db.commit()
            db.refresh(user)
            _print_user(user)
            return 0

        if args.cmd == "set-quota":
            if args.bytes < 0:
                raise SystemExit("--bytes must be >= 0")
            user.storage_quota_bytes = int(args.bytes)
            db.commit()
            db.refresh(user)
            _print_user(user)
            return 0

        if args.cmd == "clear-quota":
            user.storage_quota_bytes = None
            db.commit()
            db.refresh(user)
            _print_user(user)
            return 0

        raise SystemExit("Unknown command")
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())

