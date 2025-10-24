"""
Script to run Alembic database migrations

Usage:
    python run_migration.py              # Upgrade to latest
    python run_migration.py --current    # Show current version
    python run_migration.py --downgrade  # Rollback one version
"""

import sys
import os
from alembic import command
from alembic.config import Config


def get_alembic_config():
    """Get Alembic configuration"""
    # Get the directory of this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    alembic_ini = os.path.join(script_dir, "alembic.ini")

    if not os.path.exists(alembic_ini):
        raise FileNotFoundError(f"alembic.ini not found at {alembic_ini}")

    return Config(alembic_ini)


def show_current():
    """Show current migration version"""
    alembic_cfg = get_alembic_config()
    command.current(alembic_cfg, verbose=True)


def upgrade():
    """Upgrade to the latest migration"""
    alembic_cfg = get_alembic_config()
    print("Running database migrations...")
    command.upgrade(alembic_cfg, "head")
    print("\n✅ Migration completed successfully!")
    print("\nCurrent version:")
    command.current(alembic_cfg)


def downgrade():
    """Downgrade one migration"""
    alembic_cfg = get_alembic_config()
    print("Rolling back one migration...")
    command.downgrade(alembic_cfg, "-1")
    print("\n✅ Rollback completed successfully!")
    print("\nCurrent version:")
    command.current(alembic_cfg)


def main():
    """Main entry point"""
    if len(sys.argv) > 1:
        arg = sys.argv[1].lower()
        if arg in ['--current', '-c']:
            show_current()
        elif arg in ['--downgrade', '--rollback', '-d']:
            downgrade()
        elif arg in ['--help', '-h']:
            print(__doc__)
        else:
            print(f"Unknown argument: {arg}")
            print(__doc__)
    else:
        upgrade()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
