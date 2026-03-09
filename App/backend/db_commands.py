"""
Database management commands

Provides common database operations via CLI.
Usage: python db_commands.py <command>
"""

import subprocess
import sys
from pathlib import Path

from sqlalchemy import inspect, text

from database import DATABASE_URL, engine


BACKEND_DIR = Path(__file__).resolve().parent


def _run_alembic(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["alembic", *args],
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
    )


def upgrade():
    """Apply all pending migrations"""
    print("Applying migrations...")
    result = _run_alembic("upgrade", "head")
    if result.returncode == 0:
        print("✓ Migrations applied successfully!")
        print(result.stdout)
    else:
        print("✗ Error applying migrations:")
        print(result.stderr)
        sys.exit(1)


def downgrade(steps: int = 1):
    """Downgrade migrations"""
    print(f"Downgrading {steps} migration(s)...")
    result = _run_alembic("downgrade", f"-{steps}")
    if result.returncode == 0:
        print("✓ Downgrade successful!")
        print(result.stdout)
    else:
        print("✗ Error downgrading:")
        print(result.stderr)
        sys.exit(1)


def current():
    """Show current migration version"""
    result = _run_alembic("current")
    print(result.stdout)


def history():
    """Show migration history"""
    result = _run_alembic("history", "--verbose")
    print(result.stdout)


def reset():
    """Reset database (drop all tables and recreate)"""
    confirm = input("⚠️  This will DROP ALL TABLES! Are you sure? (yes/no): ")
    if confirm.lower() != "yes":
        print("Aborted.")
        return

    print("Dropping all tables...")

    try:
        with engine.connect() as conn:
            conn.execute(text("DROP SCHEMA public CASCADE;"))
            conn.execute(text("CREATE SCHEMA public;"))
            conn.execute(text("GRANT ALL ON SCHEMA public TO postgres;"))
            conn.execute(text("GRANT ALL ON SCHEMA public TO public;"))
            conn.commit()
        print("✓ Schema reset successfully")
    except Exception as e:
        print(f"✗ Schema reset failed: {e}")
        sys.exit(1)

    print("\nRebuilding schema from baseline...")
    result = _run_alembic("upgrade", "head")
    if result.returncode == 0:
        print("✓ Database reset complete!")
    else:
        print("✗ Error rebuilding schema:")
        print(result.stderr)


def show_tables():
    """Show all tables in the database"""
    inspector = inspect(engine)
    tables = inspector.get_table_names()

    print(f"\nDatabase: {engine.url.database}")
    print(f"Tables ({len(tables)}):\n")

    for table in sorted(tables):
        columns = inspector.get_columns(table)
        print(f"  {table}")
        for col in columns:
            col_type = str(col['type'])
            nullable = "" if col['nullable'] else " NOT NULL"
            print(f"    - {col['name']}: {col_type}{nullable}")
        print()


def test_connection():
    """Test database connection"""
    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT version()"))
            row = result.fetchone()
            version = row[0] if row else "Unknown"
            print(f"✓ Connected to PostgreSQL")
            print(f"  Database: {engine.url.database}")
            print(f"  Host: {engine.url.host}")
            print(f"  Version: {version[:50]}...")
            return True
    except Exception as e:
        print(f"✗ Connection failed: {e}")
        return False


def show_url():
    """Show database URL (with password masked)"""
    url = str(DATABASE_URL)
    # Mask password
    if '@' in url and ':' in url:
        parts = url.split('@')
        auth_parts = parts[0].split(':')
        if len(auth_parts) >= 3:
            masked = auth_parts[0] + ':' + auth_parts[1] + ':****@' + '@'.join(parts[1:])
        else:
            masked = url
    else:
        masked = url

    print(f"Database URL: {masked}")


def main():
    """Main CLI handler"""
    commands = {
        'upgrade': ('Apply all pending migrations', upgrade),
        'downgrade': ('Downgrade one migration', lambda: downgrade(1)),
        'current': ('Show current migration version', current),
        'history': ('Show migration history', history),
        'reset': ('Reset database (drop and recreate all tables)', reset),
        'tables': ('Show all tables', show_tables),
        'test': ('Test database connection', test_connection),
        'url': ('Show database URL', show_url),
    }

    if len(sys.argv) < 2 or sys.argv[1] not in commands:
        print("Database Management Commands")
        print("=" * 60)
        print("\nUsage: python db_commands.py <command>\n")
        print("Available commands:")
        for cmd, (desc, _) in commands.items():
            print(f"  {cmd:12} - {desc}")
        print()
        sys.exit(1)

    command = sys.argv[1]
    _, func = commands[command]
    func()


if __name__ == "__main__":
    main()
