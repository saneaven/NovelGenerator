# Migration 002: Move Advanced Settings to Function Configs

## Overview

This migration moves the global `enable_prefill` and `enable_thinking` settings into per-function `advanced` settings within the `function_configs` JSONB field.

## What Changed

### Before (Migration 001):
```json
{
  "enable_prefill": false,  // Global setting
  "enable_thinking": false, // Global setting
  "function_configs": {
    "chat": {
      "provider": "copilot",
      "model": "gpt-4o-mini",
      "temperature": 0.7
    },
    "translation": {...},
    "storyObjectEdit": {...},
    "chapterGen": {...}
  }
}
```

### After (Migration 002):
```json
{
  "function_configs": {
    "chat": {
      "provider": "copilot",
      "model": "gpt-4o-mini",
      "temperature": 0.7,
      "advanced": {
        "enablePrefill": false,
        "enableThinking": false
      }
    },
    "translation": {...},
    "storyEdit": {...},
    "chapterGen": {
      ...,
      "advanced": {
        "enablePrefill": true,   // Default enabled for chapter generation
        "enableThinking": false
      }
    }
  }
}
```

## Running the Migration

### Method 1: Using Alembic CLI

```bash
cd App/backend

# Check current migration version
alembic current

# Run the migration
alembic upgrade head

# Verify the migration
alembic current
```

### Method 2: Using Python Script

```python
from alembic import command
from alembic.config import Config

# Create Alembic config
alembic_cfg = Config("alembic.ini")

# Run upgrade
command.upgrade(alembic_cfg, "head")
```

### Method 3: Direct SQL (Not Recommended)

If you need to run the migration manually, you can execute the SQL from the migration file directly in your PostgreSQL database.

## Data Migration Details

1. **Existing Users**: All existing `enable_prefill` and `enable_thinking` values will be copied to ALL function configs
2. **Special Case**: `chapterGen` function gets `enablePrefill: true` by default (others get the global value)
3. **Column Removal**: After data migration, `enable_prefill` and `enable_thinking` columns are dropped
4. **Default Values**: New users will get the updated defaults with `advanced` settings

## Rollback

If you need to rollback this migration:

```bash
alembic downgrade -1
```

This will:
1. Restore `enable_prefill` and `enable_thinking` columns
2. Copy values from `chat` function's advanced settings to global columns
3. Remove `advanced` objects from all function configs

## Testing

After migration, verify:

1. Check database schema:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'user_settings';
```

2. Check sample data:
```sql
SELECT
  id,
  function_configs->'chat'->'advanced' as chat_advanced,
  function_configs->'chapterGen'->'advanced' as chaptergen_advanced
FROM user_settings
LIMIT 1;
```

Expected output should show `advanced` objects with `enablePrefill` and `enableThinking` fields.

## Notes

- This migration is **backward compatible** with the rollback feature
- Existing user data is preserved during migration
- Frontend and backend code have been updated to use the new structure
- No action required from users - settings will be automatically migrated
