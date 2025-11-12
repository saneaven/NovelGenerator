# Obsolete Code Cleanup Plan

## Overview
This document tracks code files that are obsolete after migrating to the new unified translation system and should be deleted or migrated.

---

## Files to Delete (Safe to Remove)

### ✅ Ready to Delete

#### 1. **useLanguageAwareData.ts**
- **Path**: `App/frontend/src/hooks/useLanguageAwareData.ts`
- **Status**: ❌ Obsolete - No longer used
- **Reason**: Replaced by direct data access pattern (`object.data.*`)
- **Usage Check**: ✅ Not imported anywhere (verified with grep)
- **Action**: DELETE

#### 2. **storyObjectTranslation.ts**
- **Path**: `App/frontend/src/utils/storyObjectTranslation.ts`
- **Status**: ⚠️ Still in use by NameDescriptionManager.tsx
- **Reason**: Old translation utilities, replaced by unified API
- **Usage Check**: ❌ Still imported by 1 file
- **Action**: MIGRATE NameDescriptionManager first, then DELETE

#### 3. **NovelEditorPanel.old.tsx**
- **Path**: `App/frontend/src/pages/noveleditor/components/NovelEditorPanel.old.tsx`
- **Status**: ⚠️ Backup file (created during migration)
- **Reason**: Old implementation using novelStore and storyObjectStore
- **Action**: KEEP until new NovelEditorPanel is tested, then DELETE

---

## Components Needing Migration

### 🔴 Not Yet Migrated

#### 1. **NameDescriptionManager.tsx**
- **Path**: `App/frontend/src/components/NameDescriptionManager.tsx`
- **Current System**: Uses old stores and hooks
- **Imports to Replace**:
  - `useStoryObjectStore` → `useUnifiedObjectStore`
  - `useLanguageAwareData` → Remove (direct access)
  - `translateStoryObject` → `store.addTranslation()`
  - `getDisplayDataForItem` → Direct `item.data.*` access
- **Priority**: HIGH
- **Used For**: Character, Organization, Location, Lorebook items

#### 2. **Act/Chapter Editors** (if they exist separately)
- **Status**: Need to search for components
- **Pattern**: Should use unified store
- **Priority**: MEDIUM

#### 3. **Other StoryObject Components**
- **Action**: Need to search for all components using `useStoryObjectStore`

---

## Store Code to Clean Up

### Files to Check

#### 1. **storyObjectStore.ts**
- **Path**: `App/frontend/src/store/storyObjectStore.ts`
- **Status**: ⚠️ May still be needed for some features
- **Action**:
  1. Find all imports of `useStoryObjectStore`
  2. Migrate those components to `useUnifiedObjectStore`
  3. After all migrations, delete this file

#### 2. **novelStore.ts**
- **Path**: `App/frontend/src/store/novelStore.ts`
- **Status**: ⚠️ Used by old NovelEditorPanel
- **Action**: Delete after NovelEditorPanel.old.tsx is deleted

---

## Search for Remaining Old System Usage

### Components Using Old Stores

```bash
# Find all files importing useStoryObjectStore
grep -r "useStoryObjectStore" --include="*.tsx" --include="*.ts" App/frontend/src/

# Find all files importing useNovelStore
grep -r "useNovelStore" --include="*.tsx" --include="*.ts" App/frontend/src/

# Find all files importing useLanguageAwareData
grep -r "useLanguageAwareData" --include="*.tsx" --include="*.ts" App/frontend/src/
```

---

## Migration Priority

### Phase 1: High Priority (Blocking cleanup)
1. ✅ **BasicInfoManager.tsx** - COMPLETED
2. ✅ **NovelEditorPanel.tsx** - COMPLETED
3. 🔴 **NameDescriptionManager.tsx** - TODO (blocks storyObjectTranslation.ts deletion)

### Phase 2: Medium Priority
4. Search for and migrate other components using old stores
5. Test all migrated components thoroughly
6. Verify no imports of obsolete code

### Phase 3: Final Cleanup
7. Delete `useLanguageAwareData.ts`
8. Delete `storyObjectTranslation.ts`
9. Delete `NovelEditorPanel.old.tsx`
10. Delete `storyObjectStore.ts` (if no longer used)
11. Delete `novelStore.ts` (if no longer used)
12. Remove old version cache logic from any remaining code

---

## Verification Checklist

Before deleting each file:

- [ ] Grep for all imports of the file
- [ ] Verify no files import it
- [ ] Check if used in any test files
- [ ] Ensure all functionality replaced by new system
- [ ] Run TypeScript compilation (`npx tsc --noEmit`)
- [ ] Test affected components

---

## Commands for Cleanup

### Step 1: Find All Old Store Usage

```bash
# Find useStoryObjectStore imports
grep -r "from '../store/storyObjectStore'" App/frontend/src/ --include="*.tsx" --include="*.ts"

# Find useNovelStore imports
grep -r "from '../store/novelStore'" App/frontend/src/ --include="*.tsx" --include="*.ts"

# Find useLanguageAwareData imports
grep -r "from '../hooks/useLanguageAwareData'" App/frontend/src/ --include="*.tsx" --include="*.ts"

# Find storyObjectTranslation imports
grep -r "from '../utils/storyObjectTranslation'" App/frontend/src/ --include="*.tsx" --include="*.ts"
```

### Step 2: After All Migrations Complete

```bash
# Delete obsolete files (ONLY AFTER VERIFICATION)
rm App/frontend/src/hooks/useLanguageAwareData.ts
rm App/frontend/src/utils/storyObjectTranslation.ts
rm App/frontend/src/pages/noveleditor/components/NovelEditorPanel.old.tsx
# rm App/frontend/src/store/storyObjectStore.ts  # Only if fully replaced
# rm App/frontend/src/store/novelStore.ts  # Only if fully replaced
```

### Step 3: Verify TypeScript Compilation

```bash
cd App/frontend
npx tsc --noEmit
# Should complete with no errors
```

---

## Notes

1. **Keep Backups**: Before deleting, ensure git commits are made
2. **Test Incrementally**: Test after each component migration
3. **Version Control**: Use git branches for migrations
4. **Rollback Plan**: Keep .old.tsx files until thoroughly tested

---

## Current Status Summary

✅ **Completed**:
- BasicInfoManager.tsx migrated
- NovelEditorPanel.tsx migrated with auto-save
- TypeScript compilation verified

⏳ **In Progress**:
- Identifying all components needing migration
- NameDescriptionManager.tsx migration (next step)

🔴 **Not Started**:
- Other component migrations
- File deletions
- Old store cleanup

---

## Next Steps

1. Search for all files using `useStoryObjectStore`
2. Create migration plan for each component
3. Migrate NameDescriptionManager.tsx
4. Migrate remaining components
5. Delete obsolete files after verification
6. Update documentation
