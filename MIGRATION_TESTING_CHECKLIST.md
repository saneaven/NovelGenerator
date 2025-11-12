# Migration Testing Checklist

## Overview
This document tracks the testing status for components migrated to the new unified translation system.

---

## Migrated Components Status

### ✅ BasicInfoManager.tsx
**Status**: Migrated
**Location**: `App/frontend/src/components/BasicInfoManager.tsx`

**Migration Changes:**
- ✅ Replaced `useStoryObjectStore` with `useUnifiedObjectStore`
- ✅ Removed `useLanguageAwareData` hook
- ✅ Changed `displayData.*` to `basicInfo.data.*`
- ✅ Added `LanguageSwitcher` component
- ✅ Updated save logic with `create_new_version` flag
- ✅ Using built-in `store.loading[id]` and `store.errors[id]`

**Testing Checklist:**
- [ ] **Basic Display**: Title, logline, genre display correctly
- [ ] **Data Loading**: Object loads from API correctly
- [ ] **Language Switching**:
  - [ ] LanguageSwitcher shows available languages
  - [ ] Switching language updates display without creating version
  - [ ] No version count increase after language switch
- [ ] **Editing**:
  - [ ] Edit mode activates correctly
  - [ ] Form fields populate with current data
  - [ ] Changes saved correctly
- [ ] **Version Creation**:
  - [ ] Manual save creates new version
  - [ ] Version number increments
  - [ ] Version appears in history
- [ ] **Translation Management**:
  - [ ] Add Translation button appears when secondary language not available
  - [ ] Translation creates new language entry
  - [ ] New language appears in LanguageSwitcher
- [ ] **Error Handling**:
  - [ ] Loading spinner shows while fetching
  - [ ] Error message displays on fetch failure
  - [ ] Retry button works
- [ ] **AI Edit**:
  - [ ] AI Edit modal opens
  - [ ] AI results apply correctly
  - [ ] New version created after AI edit
- [ ] **Version History**:
  - [ ] Version History modal opens
  - [ ] All versions listed correctly
  - [ ] Version restore works
  - [ ] Translation cache rebuilds after restore

---

### ✅ NovelEditorPanel.tsx
**Status**: Migrated (with auto-save)
**Location**: `App/frontend/src/pages/noveleditor/components/NovelEditorPanel.tsx`
**Backup**: `NovelEditorPanel.old.tsx`

**Migration Changes:**
- ✅ Uses `useUnifiedObjectStore` for chapter content
- ✅ Auto-save with debouncing (2 seconds)
- ✅ Manual save button creates version snapshots
- ✅ Periodic snapshots every 5 minutes
- ✅ `create_new_version: false` for auto-save (in-place updates)
- ✅ `create_new_version: true` for manual save (version snapshots)
- ✅ Added `LanguageSwitcher` component
- ✅ Direct data access: `chapterContent.data.content`

**Testing Checklist:**
- [ ] **Basic Display**:
  - [ ] Chapter content loads correctly
  - [ ] Word count displays and updates
  - [ ] Loading state shows while fetching
- [ ] **Auto-Save**:
  - [ ] Content saves automatically after 2 seconds of inactivity
  - [ ] Save status shows "Auto-saving..." during save
  - [ ] Auto-save does NOT create new version
  - [ ] Version number stays the same after auto-save
  - [ ] Multiple auto-saves don't create version spam
- [ ] **Manual Save**:
  - [ ] Save button enabled when unsaved changes exist
  - [ ] Manual save creates new version
  - [ ] Version number increments after manual save
  - [ ] Save status updates correctly
- [ ] **Periodic Snapshots**:
  - [ ] Snapshot created every 5 minutes if changes exist
  - [ ] Snapshot creates new version
  - [ ] Last snapshot time displays correctly
- [ ] **Language Switching**:
  - [ ] LanguageSwitcher shows available languages
  - [ ] Switching language saves current changes first
  - [ ] Language switch loads correct content
  - [ ] No new version created on language switch
- [ ] **Translation**:
  - [ ] Add Translation button appears for secondary language
  - [ ] Translation creates new language entry
  - [ ] Translated content displays correctly
- [ ] **Editor Behavior**:
  - [ ] Typing is smooth (no lag)
  - [ ] Content doesn't reload during user editing
  - [ ] Cursor position preserved during auto-save
  - [ ] No content loss during language switches
- [ ] **Error Handling**:
  - [ ] Loading spinner shows while fetching
  - [ ] Error message displays on save failure
  - [ ] Auto-save failures logged but don't interrupt editing
  - [ ] Manual save failures show alert
- [ ] **Performance**:
  - [ ] No unnecessary re-renders
  - [ ] Debouncing works correctly
  - [ ] Timeout cleanup on unmount

---

## Testing Scenarios

### Scenario 1: Basic Info Editing Flow
1. Navigate to Basic Info page
2. Verify data loads correctly
3. Click Edit button
4. Modify title, logline, genre
5. Click Save
6. **Expected**: New version created, version number increments
7. Open Version History
8. **Expected**: New version appears in list

### Scenario 2: Basic Info Language Switching
1. Load Basic Info with English content
2. Use LanguageSwitcher to switch to Korean (if available)
3. **Expected**:
   - Content switches to Korean
   - No new version created
   - Version count stays the same
4. Switch back to English
5. **Expected**: Original English content displays

### Scenario 3: Basic Info Translation
1. Load Basic Info in English
2. Set secondary language to Korean in settings
3. Click "Add Korean" button
4. **Expected**:
   - Translation created
   - Korean appears in LanguageSwitcher
   - Can switch between English and Korean

### Scenario 4: Chapter Auto-Save
1. Open a chapter in Novel Editor
2. Start typing
3. Wait 2 seconds without typing
4. **Expected**:
   - "Auto-saving..." appears
   - Content saved to backend
   - Version number DOES NOT increase
   - Can verify in database: ObjectVersion count stays same
5. Continue typing and wait another 2 seconds
6. **Expected**: Another auto-save, still no version increase

### Scenario 5: Chapter Manual Save
1. Open a chapter in Novel Editor
2. Type some content
3. Click "Save Snapshot" button
4. **Expected**:
   - "Saving..." appears
   - Content saved to backend
   - Version number INCREASES
   - New version appears in version history
5. Verify in database: New ObjectVersion row created

### Scenario 6: Chapter Language Switching
1. Open a chapter with English content
2. Type some changes (but don't save manually)
3. Switch to Korean using LanguageSwitcher
4. **Expected**:
   - Changes auto-saved first
   - Korean content loads (or translation created)
   - No new version from language switch itself
   - Version count correct

### Scenario 7: Version History Restoration
1. Make several edits to a basic info or chapter
2. Create multiple versions (manual saves)
3. Open Version History modal
4. Select an older version
5. Click Restore
6. **Expected**:
   - Content reverts to old version
   - Translation cache rebuilt
   - All languages from that version available
   - Current language preserved if available

---

## Backend API Testing

### Test with curl/Postman:

1. **Get Object**
```bash
GET /api/v1/objects/chapter_content/{id}?language=English
# Should return object with data in English
```

2. **Update Object (Auto-save)**
```bash
PUT /api/v1/objects/chapter_content/{id}
{
  "data": {"content": "New content", "wordCount": 2},
  "language": "English",
  "user_request": "Auto-save",
  "create_new_version": false  // IN-PLACE UPDATE
}
# Should NOT create new version
```

3. **Update Object (Manual save)**
```bash
PUT /api/v1/objects/chapter_content/{id}
{
  "data": {"content": "Snapshot content", "wordCount": 2},
  "language": "English",
  "user_request": "Manual Save",
  "create_new_version": true  // CREATE VERSION
}
# Should create new version
```

4. **Switch Language**
```bash
PATCH /api/v1/objects/chapter_content/{id}/active-language
{
  "language": "Korean"
}
# Should switch active language without creating version
```

5. **Add Translation**
```bash
POST /api/v1/objects/chapter_content/{id}/translations
{
  "language": "Korean",
  "data": {"content": "한국어 내용", "wordCount": 3},
  "user_request": "Translation"
}
# Should add Korean translation
```

---

## Database Verification

After each test, verify database state:

```sql
-- Check version count
SELECT COUNT(*) FROM object_versions
WHERE object_id = '{id}';

-- Check active version
SELECT v.version_number, v.created_at
FROM object_versions v
JOIN active_versions av ON v.id = av.active_version_id
WHERE av.object_id = '{id}';

-- Check translation cache
SELECT language, is_active
FROM object_translations
WHERE object_id = '{id}';

-- Verify no version created on language switch
-- (version count should stay same after PATCH /active-language)
```

---

## Known Issues / Notes

1. **TODO in NovelEditorPanel**: Need to get chapter content ID from chapter object
   - Currently using placeholder in useEffect (lines 84-89)
   - Need to implement API endpoint or include in chapter data

2. **Missing Features**: The new NovelEditorPanel is simplified
   - Old version had: AI Edit Modal, Retranslate Modal, Complex translation workflow
   - These can be re-added later using new unified system patterns

3. **ChapterSidebar**: New NovelEditorPanel doesn't include ChapterSidebar component
   - Need to integrate if required

---

## Next Steps

1. ✅ BasicInfoManager migrated
2. ✅ NovelEditorPanel migrated with auto-save
3. ⏳ Manual testing in development environment
4. ⏳ Fix any issues found
5. ⏳ Migrate remaining components:
   - NameDescriptionManager
   - Act/Chapter editors
   - Other components using old system
6. ⏳ Delete obsolete files:
   - useLanguageAwareData.ts
   - storyObjectTranslation.ts
   - Old store methods
7. ⏳ Run backend integration tests
8. ⏳ Execute database migration

---

## Success Criteria

- [x] Components compile without errors
- [ ] All tests pass
- [ ] No version spam during typing
- [ ] Language switching works smoothly
- [ ] Translation cache stays in sync
- [ ] Version history accurate
- [ ] Performance is acceptable
- [ ] No data loss
