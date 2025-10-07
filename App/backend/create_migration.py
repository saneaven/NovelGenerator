"""
Helper script to create Alembic migrations

This script provides an easy way to create new migrations.
"""

import subprocess
import sys


def create_migration(message: str, autogenerate: bool = True):
    """
    Create a new Alembic migration

    Args:
        message: Description of the migration
        autogenerate: If True, auto-generate migration from model changes
    """
    cmd = ["alembic", "revision"]

    if autogenerate:
        cmd.append("--autogenerate")

    cmd.extend(["-m", message])

    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode == 0:
        print("\n✓ Migration created successfully!")
        print(result.stdout)
    else:
        print("\n✗ Error creating migration:")
        print(result.stderr)
        sys.exit(1)


def main():
    """Main function"""
    if len(sys.argv) < 2:
        print("Usage: python create_migration.py <message> [--no-autogenerate]")
        print("\nExamples:")
        print("  python create_migration.py 'initial migration'")
        print("  python create_migration.py 'add user table' --no-autogenerate")
        sys.exit(1)

    message = sys.argv[1]
    autogenerate = "--no-autogenerate" not in sys.argv

    create_migration(message, autogenerate)


if __name__ == "__main__":
    main()
