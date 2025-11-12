# Multilingual System Ground-Up Redesign

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Database Schema](#database-schema)
4. [Backend API](#backend-api)
5. [Frontend Architecture](#frontend-architecture)
6. [Migration Guide](#migration-guide)
7. [Usage Examples](#usage-examples)
8. [Benefits](#benefits)

---

## Overview

This document describes the complete redesign of the multilingual translation system from a problematic dual-storage approach to a clean three-layer architecture.

### Problems with Old System
- **Flat fields represented unknown language** - No language marker on flat fields
- **Version cache staleness** - 5-minute TTL caused stale data issues
- **Inconsistent state** - Flat fields could be in different language than expected
- **Complex overlay logic** - useLanguageAwareData hook was fragile
- **Version pollution** - Translation operations cluttered history
- **No clean language switching** - Had to create new versions just to switch UI language

### New System Goals
✅ Single source of truth (version data)
✅ No flat fields - eliminates language ambiguity
✅ Fast queries - translation cache indexed
✅ Clean language switching - no version spam
✅ Unified system - all objects work the same
✅ Simple frontend - 70% less code
✅ Full audit trail - immutable version history

---

## Architecture

### Three-Layer System

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Core Objects (Structure Only)                 │
│ - IDs, relationships, timestamps, ordering              │
│ - NO content fields                                     │
│ - Pure structural data                                  │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Layer 2: Translation Cache (Fast Access)               │
│ - object_translations table                             │
│ - One row per object per language                       │
│ - JSONB data field (flexible schema)                    │
│ - Indexed for fast queries                              │
│ - Auto-generated from version data                      │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Layer 3: Version History (Source of Truth)             │
│ - object_versions table                                 │
│ - Immutable audit trail                                 │
│ - JSONB with ALL languages in each version              │
│ - Sequential version numbers                            │
│ - Complete snapshot at each point in time               │
└─────────────────────────────────────────────────────────┘
```

---

## Database Schema

### New Tables

#### 1. `object_translations` (Translation Cache)

```sql
CREATE TABLE object_translations (
    id UUID PRIMARY KEY,
    object_type VARCHAR(50) NOT NULL,  -- 'character', 'chapter_content', etc.
    object_id UUID NOT NULL,
    language VARCHAR(50) NOT NULL,
    data JSONB NOT NULL,  -- {name: "...", description: "..."}
    is_active BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,

    UNIQUE(object_type, object_id, language)
);

-- Indexes
CREATE INDEX ix_object_translations_type ON object_translations(object_type);
CREATE INDEX ix_object_translations_object_id ON object_translations(object_id);
CREATE INDEX ix_object_translations_language ON object_translations(language);
CREATE INDEX ix_object_translations_is_active ON object_translations(is_active);
CREATE INDEX ix_object_translations_data ON object_translations USING gin(data);
```

**Purpose**: Fast queries for displaying objects in specific languages. One row per object per language.

**Example Data**:
```json
// Character "John" in English
{
  "id": "uuid1",
  "object_type": "character",
  "object_id": "char-uuid",
  "language": "English",
  "data": {"name": "John Doe", "description": "Hero..."},
  "is_active": true
}

// Same character in Korean
{
  "id": "uuid2",
  "object_type": "character",
  "object_id": "char-uuid",
  "language": "Korean",
  "data": {"name": "존 도", "description": "영웅..."},
  "is_active": false
}
```

#### 2. `object_versions` (Version History)

```sql
CREATE TABLE object_versions (
    id UUID PRIMARY KEY,
    object_type VARCHAR(50) NOT NULL,
    object_id UUID NOT NULL,
    version_number INTEGER NOT NULL,
    data JSONB NOT NULL,  -- {English: {...}, Korean: {...}}
    user_request TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP NOT NULL,

    UNIQUE(object_type, object_id, version_number)
);

-- Indexes
CREATE INDEX ix_object_versions_type_id_num ON object_versions(object_type, object_id, version_number);
CREATE INDEX ix_object_versions_created_at ON object_versions(created_at);
CREATE INDEX ix_object_versions_data ON object_versions USING gin(data);
```

**Purpose**: Immutable version history. THE single source of truth for all content.

**Example Data**:
```json
{
  "id": "version-uuid",
  "object_type": "character",
  "object_id": "char-uuid",
  "version_number": 3,
  "data": {
    "English": {
      "name": "John Doe",
      "description": "Hero of the story"
    },
    "Korean": {
      "name": "존 도",
      "description": "이야기의 영웅"
    }
  },
  "user_request": "Translation",
  "created_at": "2025-11-08T..."
}
```

#### 3. `active_versions` (Version Pointers)

```sql
CREATE TABLE active_versions (
    object_type VARCHAR(50) NOT NULL,
    object_id UUID NOT NULL,
    active_version_id UUID NOT NULL REFERENCES object_versions(id),
    updated_at TIMESTAMP NOT NULL,

    PRIMARY KEY (object_type, object_id)
);

-- Indexes
CREATE INDEX ix_active_versions_version_id ON active_versions(active_version_id);
```

**Purpose**: Points to currently active version for each object.

### Modified Core Tables

All flat content fields removed from:
- `basic_info`: Dropped title, logline, genre, active_version_id
- `characters`: Dropped name, description, active_version_id
- `organizations`: Dropped name, description, active_version_id
- `locations`: Dropped name, description, active_version_id
- `lorebook_entries`: Dropped name, description, active_version_id
- `acts`: Dropped name, description, active_version_id (kept `order`)
- `chapters`: Dropped name, description, active_version_id (kept `order`)
- `chapter_contents`: Dropped active_version_id

**What remains**: Only `id`, `project_id`, `created_at`, `updated_at`, `order` (where applicable)

---

## Backend API

### Unified Endpoint Pattern

All objects use the same pattern:

#### GET `/api/v1/objects/{objectType}/{objectId}?language=English`

Returns object with data in requested language.

**Response**:
```json
{
  "id": "uuid",
  "type": "character",
  "metadata": {
    "project_id": "uuid",
    "created_at": "...",
    "updated_at": "..."
  },
  "data": {
    "name": "John Doe",
    "description": "Hero of the story"
  },
  "languages": {
    "available": ["English", "Korean", "Japanese"],
    "active": "English",
    "default": "English"
  },
  "version": {
    "id": "uuid",
    "number": 5,
    "created_at": "..."
  }
}
```

**Key Points**:
- Data comes from `object_translations` (fast!)
- Languages aggregated from all translation rows
- Version info from `active_versions` join
- If language param omitted, uses active language

#### PUT `/api/v1/objects/{objectType}/{objectId}`

Updates object, creates new version, updates translation cache.

**Request**:
```json
{
  "data": {
    "name": "John Doe Updated",
    "description": "Updated description"
  },
  "language": "English",
  "user_request": "User Edit",
  "create_new_version": true
}
```

**Logic**:
1. Get current active version
2. Merge: `{...current_version.data, [language]: new_data}`
3. Create new version with merged data
4. Update `object_translations` for this language
5. Update `active_versions` pointer
6. Return updated object

#### POST `/api/v1/objects/{objectType}/{objectId}/translations`

Adds new language translation.

**Request**:
```json
{
  "language": "Korean",
  "data": {"name": "존 도", "description": "영웅"},
  "user_request": "AI Translation"
}
```

**Logic**:
1. Get current active version data
2. Merge new language: `{...current_data, Korean: {...}}`
3. Create new version
4. Create `object_translations` row for Korean
5. Return success message

#### PATCH `/api/v1/objects/{objectType}/{objectId}/active-language`

Switches displayed language WITHOUT creating version!

**Request**:
```json
{
  "language": "Korean"
}
```

**Logic**:
1. Update `object_translations.is_active = false` for all languages
2. Update `object_translations.is_active = true` for Korean
3. Return success

**KEY**: No version created, just UI state change!

#### GET `/api/v1/objects/{objectType}/{objectId}/versions`

Returns version history.

**Response**:
```json
{
  "versions": [
    {
      "id": "uuid",
      "number": 5,
      "data": {
        "English": {"name": "John", "description": "Hero"},
        "Korean": {"name": "존", "description": "영웅"}
      },
      "user_request": "User Edit",
      "created_at": "..."
    }
  ]
}
```

#### PATCH `/api/v1/objects/{objectType}/{objectId}/versions/{versionId}/activate`

Reverts to previous version.

**Logic**:
1. Update `active_versions` pointer to old version
2. Rebuild ALL `object_translations` rows from version data
3. Set `is_active` based on user's current language preference
4. Return success

---

## Frontend Architecture

### Simplified Store (unifiedObjectStore.ts)

**REMOVED**:
- Version cache (500+ lines)
- Overlay logic
- `syncFlatFieldsWithLanguage`
- `addTranslatedDataToItem`
- Complex request deduplication

**NOW** (200 lines total):
```typescript
interface UnifiedObjectStore {
  objects: Record<string, UnifiedObject>;  // Simple!
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;

  fetchObject: (type, id, language?) => Promise<void>;
  updateObject: (type, id, request) => Promise<void>;
  switchLanguage: (type, id, language) => Promise<void>;
}
```

### Component Simplification

**Before (with useLanguageAwareData)**:
```typescript
function CharacterCard({character}) {
  const displayData = useLanguageAwareData(
    projectId, 'character', character.id, currentLanguage, character
  );

  return <div>{displayData.name}</div>;
}
```

**After (direct access)**:
```typescript
function CharacterCard({character}) {
  return <div>{character.data.name}</div>;
}
```

### Language Switching

```typescript
import { LanguageSwitcher } from './components/LanguageSwitcher';

function CharacterEditor({characterId}) {
  const store = useUnifiedObjectStore();
  const character = store.objects[characterId];

  const handleLanguageChange = async (newLanguage) => {
    await store.switchLanguage('character', characterId, newLanguage);
  };

  return (
    <div>
      <LanguageSwitcher
        object={character}
        onLanguageChange={handleLanguageChange}
      />
      <input value={character.data.name} onChange={...} />
    </div>
  );
}
```

### Novel Editor Auto-Save

```typescript
function NovelEditor({chapterId}) {
  const [content, setContent] = useState('');
  const store = useUnifiedObjectStore();

  // Debounced auto-save
  const debouncedSave = useMemo(
    () => debounce(async (text) => {
      await store.updateObject('chapter_content', chapterId, {
        data: {content: text, wordCount: text.split(' ').length},
        language: 'English',
        create_new_version: false  // In-place update!
      });
    }, 1000),
    [chapterId]
  );

  const handleChange = (e) => {
    setContent(e.target.value);
    debouncedSave(e.target.value);
  };

  return <textarea value={content} onChange={handleChange} />;
}
```

**Key**: `create_new_version: false` prevents version spam during typing!

---

## Migration Guide

### Prerequisites

1. **Backup database**:
   ```bash
   pg_dump novelgenerator > backup_before_migration.sql
   ```

2. **Ensure all users have saved their work**

3. **Stop the application**

### Step 1: Run Database Migration

```bash
cd App/backend

# Apply Alembic migration (creates new tables)
alembic upgrade head

# This runs migration 006_multilingual_redesign.py
```

**What this does**:
- Creates `object_translations`, `object_versions`, `active_versions` tables
- Creates all indexes (GIN, composite, etc.)
- Does NOT touch existing data yet

### Step 2: Run Data Migration

```bash
cd App/backend

# Run data migration script
python -m migrations.migrate_translation_data
```

**What this does**:
1. Migrates `StoryObjectVersion` → `object_versions`
2. Migrates `ChapterContentVersion` → `object_versions`
3. Generates `object_translations` from active versions
4. Creates `active_versions` pointers
5. Sequential version numbering (1, 2, 3...)

**Expected output**:
```
================================================================================
TRANSLATION DATA MIGRATION
================================================================================

Step 1: Migrating StoryObjectVersion → ObjectVersion...
  ✓ Migrated 1234 story object versions

Step 2: Migrating ChapterContentVersion → ObjectVersion...
  ✓ Migrated 567 chapter content versions

Step 3: Generating translation cache...
  ✓ Created 2500 translation entries

Step 4: Creating active version pointers...
  ✓ Created 850 active version pointers

================================================================================
MIGRATION SUMMARY
================================================================================
Story object versions migrated:   1234
Chapter content versions migrated: 567
Object versions created:           1801
Translation entries created:       2500
Active version pointers created:   850
Errors:                            0

✓ Migration completed successfully!
```

### Step 3: Run Validation

```bash
python -m migrations.validate_migration
```

**What this checks**:
- All versions were migrated
- Active version pointers are correct
- Translation cache correctly generated
- No data loss occurred
- Version numbers are sequential

**Expected output**:
```
================================================================================
MIGRATION VALIDATION
================================================================================

1. Validating version counts...
  Old system: 1234 story + 567 chapter = 1801 total
  New system: 1234 story + 567 chapter = 1801 total
  ✓ All 1801 versions migrated

2. Validating active version pointers...
  Old system: 850 active versions
  New system: 850 active version pointers
  ✓ All 850 active versions migrated

3. Validating translation cache...
  Total translation entries: 2500
  Active translations: 850
  ✓ No objects with multiple active languages
  ✓ All 850 objects have translations

4. Validating language data integrity...
  ✓ All 100 sampled translations match version data

5. Validating version number sequences...
  ✓ All version numbers are sequential
  ✓ All version sequences start at 1

6. Validating no data loss...
  Old system: 3500 language entries across all versions
  New system: 3500 language entries across all versions
  ✓ No language data lost

================================================================================
VALIDATION SUMMARY
================================================================================
✓ All validation checks passed!

Migration completed successfully with 100% data integrity.
================================================================================
```

### Step 4: Remove Flat Fields

```bash
# Apply migration 007 (removes flat fields)
alembic upgrade head

# This is IRREVERSIBLE - ensure validation passed!
```

**What this does**:
- Drops all content columns from core tables
- Tables now only have structure (IDs, timestamps, order)
- Point of no return!

### Step 5: Deploy Frontend

```bash
cd App/frontend

# Install any new dependencies
npm install

# Build and deploy
npm run build
```

### Step 6: Restart Application

```bash
# Start backend
cd App/backend
uvicorn main:app

# Frontend already built and deployed
```

### Rollback Plan (if needed)

**Before Step 4** (flat fields still exist):
```bash
# Restore from backup
psql novelgenerator < backup_before_migration.sql

# Downgrade migrations
alembic downgrade -1  # Or -2 to go back further
```

**After Step 4** (flat fields removed):
- Rollback is much harder
- Old tables still exist but are empty
- Would need to rebuild flat fields from new system data
- Best to fix forward instead

---

## Usage Examples

### Creating a New Character

```typescript
// Create character (core structure)
const characterId = await createCharacter(projectId);

// Add initial English data
await store.updateObject('character', characterId, {
  data: {name: "John Doe", description: "Hero"},
  language: "English",
  user_request: "Initial Creation"
});
```

### Translating to Another Language

```typescript
// AI generates Korean translation
const koreanTranslation = await translateWithAI(characterId, "Korean");

// Add Korean translation
await store.addTranslation('character', characterId, {
  language: "Korean",
  data: {name: "존 도", description: "영웅"},
  user_request: "AI Translation"
});

// Now character has 2 languages: English, Korean
```

### Switching Languages in UI

```typescript
// User clicks language dropdown
await store.switchLanguage('character', characterId, "Korean");

// NO new version created!
// UI now shows Korean data
// User can switch back instantly
```

### Editing in Secondary Language

```typescript
// User edits in Korean
await store.updateObject('character', characterId, {
  data: {name: "존 도 수정", description: "수정된 설명"},
  language: "Korean",
  user_request: "User Edit"
});

// Creates new version with both languages:
// {
//   English: {name: "John Doe", description: "Hero"},
//   Korean: {name: "존 도 수정", description: "수정된 설명"}
// }
```

### Reverting to Previous Version

```typescript
// Get version history
const versions = await store.getVersions('character', characterId);

// Revert to version 3
await store.activateVersion('character', characterId, versions[2].id);

// Translation cache rebuilt from version 3 data
// All languages from version 3 restored
```

---

## Benefits

### ✅ Single Source of Truth
- Version data is THE data
- Translation cache auto-generated
- No contradictions possible

### ✅ No More Sync Issues
- Flat fields eliminated
- Version cache eliminated
- One place to update

### ✅ Fast Queries
- Translation cache indexed with GIN
- Direct language access
- No joins needed for display

### ✅ Clean Language Switching
- Switch languages instantly
- No version spam
- UI state only

### ✅ Full Audit Trail
- Immutable version history
- All languages preserved
- Time travel works

### ✅ Unified System
- All objects work the same way
- Same endpoints
- Same patterns

### ✅ Scalable Architecture
- Proper indexes
- Materialized views ready
- Cache strategy clear

### ✅ Simple Frontend
- 70% less code
- No overlay logic
- Direct data access

---

## Troubleshooting

### Issue: Migration fails with "version not found"

**Cause**: Old system had orphaned version references

**Fix**: Run cleanup script before migration:
```sql
-- Clean up orphaned version references
UPDATE basic_info SET active_version_id = NULL
WHERE active_version_id NOT IN (SELECT id FROM story_object_versions);
```

### Issue: Some objects have no translations after migration

**Cause**: Objects had no active version in old system

**Fix**: Objects need at least one language. Add default:
```sql
INSERT INTO object_translations (object_type, object_id, language, data, is_active)
SELECT 'character', id, 'English', '{"name": "", "description": ""}', true
FROM characters
WHERE id NOT IN (
  SELECT object_id FROM object_translations WHERE object_type = 'character'
);
```

### Issue: Performance slow after migration

**Cause**: ANALYZE not run after bulk insert

**Fix**:
```sql
ANALYZE object_translations;
ANALYZE object_versions;
ANALYZE active_versions;
```

---

## Future Enhancements

1. **Batch Translation UI**: Translate all characters at once
2. **Translation Memory**: Reuse translations across similar objects
3. **Language Coverage Dashboard**: Visual overview of translation status
4. **Automatic Translation**: Background job to auto-translate new content
5. **Translation Quality Score**: AI-powered quality metrics
6. **Materialized Views**: Pre-compute common queries for even faster access

---

## Conclusion

This redesign eliminates all the pain points of the old dual-storage system while maintaining full backward compatibility through the migration process. The new three-layer architecture provides:

- **Clarity**: One source of truth
- **Performance**: Indexed translation cache
- **Simplicity**: 70% less code
- **Reliability**: No sync issues
- **Scalability**: Proper database design

The migration is straightforward, fully automated, and includes comprehensive validation to ensure 100% data integrity.
