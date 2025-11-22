"""
Database management commands

Provides common database operations via CLI.
Usage: python db_commands.py <command>
"""

import subprocess
import sys
from database import engine, Base, DATABASE_URL
from models import db_models
from sqlalchemy import text, inspect, MetaData


def upgrade():
    """Apply all pending migrations"""
    print("Applying migrations...")
    result = subprocess.run(["alembic", "upgrade", "head"], capture_output=True, text=True)
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
    result = subprocess.run(["alembic", "downgrade", f"-{steps}"], capture_output=True, text=True)
    if result.returncode == 0:
        print("✓ Downgrade successful!")
        print(result.stdout)
    else:
        print("✗ Error downgrading:")
        print(result.stderr)
        sys.exit(1)


def current():
    """Show current migration version"""
    result = subprocess.run(["alembic", "current"], capture_output=True, text=True)
    print(result.stdout)


def history():
    """Show migration history"""
    result = subprocess.run(["alembic", "history", "--verbose"], capture_output=True, text=True)
    print(result.stdout)


def reset():
    """Reset database (drop all tables and recreate)"""
    confirm = input("⚠️  This will DROP ALL TABLES! Are you sure? (yes/no): ")
    if confirm.lower() != "yes":
        print("Aborted.")
        return

    print("Dropping all tables...")
    
    try:
        # Try aggressive schema drop for PostgreSQL (handles all dependencies/leftovers)
        with engine.connect() as conn:
            conn.execute(text("DROP SCHEMA public CASCADE;"))
            conn.execute(text("CREATE SCHEMA public;"))
            conn.execute(text("GRANT ALL ON SCHEMA public TO postgres;"))
            conn.execute(text("GRANT ALL ON SCHEMA public TO public;"))
            conn.commit()
        print("✓ Schema reset successfully (PostgreSQL optimized)")
    except Exception as e:
        print(f"Note: Schema reset failed ({e}), falling back to table drop...")
        # Reflect all tables to ensure we drop everything, including orphan tables
        meta = MetaData()
        meta.reflect(bind=engine)
        meta.drop_all(bind=engine)
        print("✓ All tables dropped")

    print("\nCreating all tables...")
    Base.metadata.create_all(bind=engine)
    print("✓ All tables created")

    print("\nStamping database with head revision...")
    result = subprocess.run(["alembic", "stamp", "head"], capture_output=True, text=True)
    if result.returncode == 0:
        print("✓ Database reset complete!")
    else:
        print("✗ Error stamping database:")
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
