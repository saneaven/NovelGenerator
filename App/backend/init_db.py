"""
Database initialization script

This script creates the database and runs initial migrations.
Usage:
    python init_db.py
"""

import sys
from database import engine, Base
from models import db_models
from sqlalchemy import text


def create_database():
    """Create the database if it doesn't exist"""
    from sqlalchemy_utils import database_exists, create_database as create_db

    try:
        if not database_exists(engine.url):
            print(f"Creating database: {engine.url.database}")
            create_db(engine.url)
            print("Database created successfully!")
        else:
            print(f"Database {engine.url.database} already exists.")
    except ImportError:
        print("Note: sqlalchemy-utils not installed. Skipping database creation check.")
        print("You may need to create the database manually:")
        print(f"  CREATE DATABASE {engine.url.database};")


def init_tables():
    """Create all tables"""
    print("\nCreating database tables...")
    Base.metadata.create_all(bind=engine)
    print("All tables created successfully!")


def verify_connection():
    """Verify database connection"""
    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT version()"))
            version = result.fetchone()[0]
            print(f"\nPostgreSQL version: {version}")
            print("Database connection successful!")
            return True
    except Exception as e:
        print(f"\nError connecting to database: {e}")
        print("\nPlease ensure:")
        print("1. PostgreSQL is running")
        print("2. Database credentials in .env are correct")
        print("3. Database exists or you have permissions to create it")
        return False


def show_tables():
    """Show all created tables"""
    from sqlalchemy import inspect

    inspector = inspect(engine)
    tables = inspector.get_table_names()

    print(f"\nCreated tables ({len(tables)}):")
    for table in sorted(tables):
        print(f"  - {table}")


def main():
    """Main initialization function"""
    print("=" * 60)
    print("Novel Buds - Database Initialization")
    print("=" * 60)

    # Verify connection first
    if not verify_connection():
        sys.exit(1)

    # Try to create database (if sqlalchemy-utils is installed)
    create_database()

    # Create tables
    init_tables()

    # Show created tables
    show_tables()

    print("\n" + "=" * 60)
    print("Database initialization complete!")
    print("=" * 60)
    print("\nNext steps:")
    print("1. Run migrations: alembic upgrade head")
    print("2. Create a test user account")
    print("3. Start the backend server: uvicorn main:app --reload")


if __name__ == "__main__":
    main()
