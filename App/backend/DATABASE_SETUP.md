# Database Setup Guide

This guide explains how to set up and manage the PostgreSQL database for the Novel Buds application.

## Prerequisites

1. **PostgreSQL** installed and running (version 12 or higher recommended)
2. **Python 3.9+** installed
3. Required Python packages (install via pip):
   ```bash
   pip install sqlalchemy psycopg2-binary alembic python-dotenv
   ```

## Quick Start

### 1. Configure Database Connection

Edit the `.env` file in the backend directory:

```env
DB_USER=postgres
DB_PASSWORD=your_password_here
DB_HOST=localhost
DB_PORT=5432
DB_NAME=novel_buds
```

### 2. Create Database

First, create the PostgreSQL database:

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE novel_buds;

# Exit psql
\q
```

Or use the initialization script (if you have `sqlalchemy-utils` installed):

```bash
python init_db.py
```

### 3. Run Migrations

Initialize the database schema using Alembic:

```bash
alembic upgrade head
```

Fresh installs use the checked-in baseline migration. Add new revisions only for schema changes made after that baseline.

## Database Schema Overview

The database is designed with a user-centric architecture where all data is owned by users.

### Main Tables

1. **users** - User accounts
2. **user_settings** - User preferences and LLM provider settings
3. **projects** - Story projects
4. **basic_info** - Project basic information (title, logline, genres, tags)
5. **characters, organizations, locations, lorebook_entries** - Story elements
6. **outlines, acts, chapters** - Story structure
7. **story_object_versions** - Version history for all story objects
8. **chapter_contents, chapter_content_versions** - Chapter content with versions
9. **chats, chat_messages** - Chat conversations

### Multilingual Support

All story objects and chat messages support multiple languages through JSONB columns:

```json
{
  "English": {
    "name": "Character Name",
    "description": "Character description"
  },
  "Korean": {
    "name": "캐릭터 이름",
    "description": "캐릭터 설명"
  }
}
```

## Management Commands

### Database Commands (`db_commands.py`)

```bash
# Test database connection
python db_commands.py test

# Show database URL
python db_commands.py url

# Show all tables
python db_commands.py tables

# Apply migrations
python db_commands.py upgrade

# Rollback one migration
python db_commands.py downgrade

# Show current migration version
python db_commands.py current

# Show migration history
python db_commands.py history

# Reset database (⚠️ DANGER: drops all data!)
python db_commands.py reset
```

### Creating Migrations

```bash
# Auto-generate migration from model changes
python create_migration.py "description of changes"

# Create blank migration
python create_migration.py "custom migration" --no-autogenerate

# Or use alembic directly
alembic revision --autogenerate -m "description"
alembic revision -m "custom migration"
```

### Applying Migrations

```bash
# Apply all pending migrations
alembic upgrade head

# Apply specific number of migrations
alembic upgrade +2

# Upgrade to specific revision
alembic upgrade abc123

# Downgrade one revision
alembic downgrade -1

# Downgrade to specific revision
alembic downgrade abc123
```

## Common Tasks

### Adding a New Model

1. Edit `models/db_models.py` and add your new model class
2. Create migration:
   ```bash
   python create_migration.py "add new_model table"
   ```
3. Review the generated migration file in `alembic/versions/`
4. Apply migration:
   ```bash
   alembic upgrade head
   ```

### Modifying Existing Models

1. Edit the model in `models/db_models.py`
2. Create migration:
   ```bash
   python create_migration.py "modify existing_model"
   ```
3. Review and edit migration if needed
4. Apply migration:
   ```bash
   alembic upgrade head
   ```

### Rolling Back Changes

```bash
# Rollback last migration
alembic downgrade -1

# Rollback to specific version
alembic downgrade <revision_id>

# Show history to find revision IDs
alembic history
```

## Database Maintenance

### Backup

```bash
# Backup entire database
pg_dump -U postgres novel_buds > backup.sql

# Backup with compression
pg_dump -U postgres novel_buds | gzip > backup.sql.gz
```

### Restore

```bash
# Restore from backup
psql -U postgres novel_buds < backup.sql

# Restore from compressed backup
gunzip -c backup.sql.gz | psql -U postgres novel_buds
```

### Reset Database (Development Only)

```bash
# Using management script (safest, prompts for confirmation)
python db_commands.py reset

# Or manually
dropdb -U postgres novel_buds
createdb -U postgres novel_buds
alembic upgrade head
```

## Environment Variables

All database configuration is stored in `.env`:

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_USER` | PostgreSQL username | `postgres` |
| `DB_PASSWORD` | PostgreSQL password | _(required)_ |
| `DB_HOST` | Database host | `localhost` |
| `DB_PORT` | Database port | `5432` |
| `DB_NAME` | Database name | `novel_buds` |

## Troubleshooting

### Connection Refused

```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql  # Linux
brew services list  # macOS

# Start PostgreSQL
sudo systemctl start postgresql  # Linux
brew services start postgresql  # macOS
```

### Authentication Failed

1. Check `.env` credentials
2. Verify PostgreSQL user exists:
   ```sql
   psql -U postgres
   \du  -- list users
   ```
3. Check `pg_hba.conf` authentication settings

### Database Does Not Exist

```bash
# List databases
psql -U postgres -l

# Create database
createdb -U postgres novel_buds
```

### Migration Conflicts

```bash
# Show current state
alembic current

# Show what needs to be applied
alembic history

# If migrations are out of sync, stamp current version
alembic stamp head
```

## Development Tips

1. **Always create migrations** for schema changes - don't modify the database directly
2. **Review auto-generated migrations** before applying them
3. **Test migrations** with downgrade before deploying
4. **Backup before major migrations** in production
5. **Use transactions** in custom migration scripts

## Production Deployment

1. Set appropriate connection pool settings in `database.py`
2. Use connection pooling (PgBouncer) for high traffic
3. Enable SSL/TLS for database connections
4. Set up regular automated backups
5. Monitor database performance and slow queries
6. Use read replicas for read-heavy workloads

## Additional Resources

- [SQLAlchemy Documentation](https://docs.sqlalchemy.org/)
- [Alembic Documentation](https://alembic.sqlalchemy.org/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
