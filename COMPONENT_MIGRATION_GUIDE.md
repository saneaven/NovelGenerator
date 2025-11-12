# Component Migration Guide - Old to New System

## Quick Reference

### Before (Old System) vs After (New System)

| Aspect | Old System | New System |
|--------|-----------|------------|
| **Import** | `import { useStoryObjectStore }` | `import { useUnifiedObjectStore }` |
| **Hook** | `useLanguageAwareData()` | Direct access: `object.data.*` |
| **Data Access** | `displayData.name` | `character.data.name` |
| **Language Switch** | Creates new version | `switchLanguage()` - no version |
| **Update** | Complex merge logic | Simple `updateObject()` |
| **Loading** | Manual state management | Built-in `store.loading[id]` |

---

## Pattern 1: Basic Object Display

### ❌ OLD WAY
```typescript
import { useStoryObjectStore } from '../store/storyObjectStore';
import { useLanguageAwareData } from '../hooks/useLanguageAwareData';

function CharacterCard({ character, projectId }) {
  const currentLanguage = useSettingsStore(state => state.primaryLanguage);

  // Complex overlay logic
  const displayData = useLanguageAwareData(
    projectId,
    'character',
    character.id,
    currentLanguage,
    character
  );

  return (
    <div>
      <h3>{displayData.name}</h3>
      <p>{displayData.description}</p>
    </div>
  );
}
```

### ✅ NEW WAY
```typescript
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { CharacterObject } from '../types/unifiedObject';

function CharacterCard({ characterId }: { characterId: string }) {
  const store = useUnifiedObjectStore();
  const character = store.objects[characterId] as CharacterObject;

  // Direct access - data already in correct language!
  return (
    <div>
      <h3>{character.data.name}</h3>
      <p>{character.data.description}</p>
    </div>
  );
}
```

**Key Changes:**
- ✅ No `useLanguageAwareData` hook
- ✅ Direct `character.data.*` access
- ✅ Data already in correct language from API

---

## Pattern 2: Fetching Objects

### ❌ OLD WAY
```typescript
const store = useStoryObjectStore();

useEffect(() => {
  // Fetch character
  store.fetchCharacter(projectId, characterId);

  // Fetch versions separately
  store.fetchVersions(projectId, 'character', characterId);
}, [projectId, characterId]);

// Wait for both to complete
const character = store.characters[characterId];
const versions = store.versionCache[projectId]?.character?.[characterId]?.versions;
```

### ✅ NEW WAY
```typescript
const store = useUnifiedObjectStore();

useEffect(() => {
  // Single fetch - gets everything
  store.fetchObject('character', characterId);
}, [characterId]);

// Object includes version info
const character = store.objects[characterId];
const loading = store.loading[characterId];
const error = store.errors[characterId];

// Fetch versions only when needed
const versions = await store.getVersions('character', characterId);
```

**Key Changes:**
- ✅ Unified `fetchObject()` for all types
- ✅ Built-in loading/error states
- ✅ Version info included in object
- ✅ Versions fetched on-demand

---

## Pattern 3: Updating Objects

### ❌ OLD WAY
```typescript
const store = useStoryObjectStore();

const handleUpdate = async () => {
  await store.updateCharacter(projectId, characterId, {
    name: newName,
    description: newDescription,
  }, currentLanguage);

  // Manually refresh versions
  await store.fetchVersions(projectId, 'character', characterId);

  // Sync flat fields (complex)
  store.syncFlatFieldsWithLanguage(/* ... */);
};
```

### ✅ NEW WAY
```typescript
const store = useUnifiedObjectStore();

const handleUpdate = async () => {
  await store.updateObject('character', characterId, {
    data: {
      name: newName,
      description: newDescription,
    },
    language: character.languages.active,
    create_new_version: true, // Optional: control versioning
  });

  // Object automatically refreshed - no manual sync needed!
};
```

**Key Changes:**
- ✅ Unified `updateObject()` for all types
- ✅ Explicit version control
- ✅ Auto-refresh after update
- ✅ No sync needed

---

## Pattern 4: Language Switching

### ❌ OLD WAY
```typescript
const handleLanguageSwitch = async (newLanguage: string) => {
  // This created a NEW VERSION just to switch language!
  const versions = store.getVersions(projectId, 'character', characterId);
  const versionWithLanguage = versions.find(v =>
    v.data[newLanguage] !== undefined
  );

  if (versionWithLanguage) {
    // Activate version to switch language
    await store.activateVersion(projectId, 'character', characterId, versionWithLanguage.id);
  }

  // Manual UI updates...
};
```

### ✅ NEW WAY
```typescript
const handleLanguageSwitch = async (newLanguage: string) => {
  // Clean switch - NO version created!
  await store.switchLanguage('character', characterId, newLanguage);

  // Object auto-refreshed in new language
};
```

**With LanguageSwitcher Component:**
```typescript
import { LanguageSwitcher } from '../components/LanguageSwitcher';

<LanguageSwitcher
  object={character}
  onLanguageChange={(lang) => store.switchLanguage('character', characterId, lang)}
/>
```

**Key Changes:**
- ✅ Simple `switchLanguage()` call
- ✅ No version pollution
- ✅ Instant UI update
- ✅ Built-in component available

---

## Pattern 5: Adding Translations

### ❌ OLD WAY
```typescript
// Manual version creation with merged data
const currentVersion = store.getActiveVersion(projectId, 'character', characterId);
const mergedData = {
  ...currentVersion.data,
  [targetLanguage]: translatedData
};

await store.createVersion(projectId, 'character', characterId, {
  data: mergedData,
  user_request: 'Translation'
});

// Manual cache update
store.addTranslatedDataToItem(/* complex params */);
```

### ✅ NEW WAY
```typescript
await store.addTranslation('character', characterId, {
  language: targetLanguage,
  data: {
    name: translatedName,
    description: translatedDescription,
  },
  user_request: 'AI Translation',
});

// Translation cache automatically updated!
```

**Key Changes:**
- ✅ Simple `addTranslation()` call
- ✅ No manual merging
- ✅ Auto-cache update

---

## Pattern 6: Version History

### ❌ OLD WAY
```typescript
const versions = store.versionCache[projectId]?.character?.[characterId]?.versions;

// Check cache freshness
const cached = store.versionCache[projectId]?.character?.[characterId];
if (!cached || Date.now() - cached.timestamp > 5 * 60 * 1000) {
  await store.fetchVersions(projectId, 'character', characterId);
}

// Revert to version
await store.activateVersion(projectId, 'character', characterId, versionId);

// Manually update flat fields from version data
const version = versions.find(v => v.id === versionId);
const firstLang = Object.keys(version.data)[0];
character.name = version.data[firstLang].name;
character.description = version.data[firstLang].description;
```

### ✅ NEW WAY
```typescript
// Fetch versions (no caching issues)
const versions = await store.getVersions('character', characterId);

// Revert to version
await store.activateVersion('character', characterId, versionId);

// Translation cache automatically rebuilt from version!
// Object auto-refreshed - nothing manual needed
```

**Key Changes:**
- ✅ No cache staleness
- ✅ Simple version operations
- ✅ Auto-rebuild translation cache
- ✅ Clean data flow

---

## Pattern 7: Novel Editor Auto-Save

### ❌ OLD WAY
```typescript
const debouncedSave = useMemo(
  () => debounce(async (content: string) => {
    // Creates NEW VERSION on every save!
    await store.updateChapterContent(projectId, chapterId, {
      content,
      wordCount: content.split(' ').length,
    }, currentLanguage);

    // Version history polluted with typing events
  }, 1000),
  [projectId, chapterId]
);
```

### ✅ NEW WAY
```typescript
const debouncedSave = useMemo(
  () => debounce(async (content: string) => {
    // In-place update - NO new version during typing!
    await store.updateObject('chapter_content', chapterId, {
      data: {
        content,
        wordCount: content.split(' ').length,
      },
      language: currentLanguage,
      create_new_version: false, // KEY: in-place update
    });
  }, 1000),
  [chapterId]
);

// Manual save button creates version
const handleManualSave = async () => {
  await store.updateObject('chapter_content', chapterId, {
    data: { content, wordCount },
    language: currentLanguage,
    create_new_version: true, // Create version snapshot
  });
};
```

**Key Changes:**
- ✅ `create_new_version` flag controls versioning
- ✅ No version spam during typing
- ✅ Manual saves create proper snapshots

---

## Pattern 8: Loading & Error States

### ❌ OLD WAY
```typescript
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);

const fetchData = async () => {
  setLoading(true);
  setError(null);

  try {
    await store.fetchCharacter(projectId, characterId);
  } catch (err) {
    setError(err.message);
  } finally {
    setLoading(false);
  }
};
```

### ✅ NEW WAY
```typescript
// Built-in loading and error states!
const store = useUnifiedObjectStore();
const loading = store.loading[characterId];
const error = store.errors[characterId];

useEffect(() => {
  store.fetchObject('character', characterId);
}, [characterId]);

// Render based on states
if (loading) return <LoadingSpinner />;
if (error) return <ErrorMessage error={error} />;
```

**Key Changes:**
- ✅ No manual state management
- ✅ Per-object loading/error tracking
- ✅ Automatic state updates

---

## Migration Checklist

When migrating a component:

- [ ] Replace `useStoryObjectStore` with `useUnifiedObjectStore`
- [ ] Remove `useLanguageAwareData` hook
- [ ] Change `displayData.*` to `object.data.*`
- [ ] Update fetch calls to `store.fetchObject(type, id)`
- [ ] Update update calls to `store.updateObject(type, id, request)`
- [ ] Replace language switch logic with `store.switchLanguage()`
- [ ] Add `LanguageSwitcher` component if needed
- [ ] Use built-in `store.loading[id]` and `store.errors[id]`
- [ ] Remove manual version cache management
- [ ] Remove `syncFlatFieldsWithLanguage` calls
- [ ] Test all object types (basic_info, character, chapter, etc.)

---

## Complete Example Migration

### Before: BasicInfoManager.tsx (Old)

```typescript
import { useStoryObjectStore } from '../store/storyObjectStore';
import { useLanguageAwareData } from '../hooks/useLanguageAwareData';

export function BasicInfoManager({ projectId, basicInfoId }) {
  const store = useStoryObjectStore();
  const settingsStore = useSettingsStore();
  const basicInfo = store.basicInfo[basicInfoId];
  const currentLanguage = settingsStore.primaryLanguage;

  const displayData = useLanguageAwareData(
    projectId,
    'basicInfo',
    basicInfoId,
    currentLanguage,
    basicInfo
  );

  const [title, setTitle] = useState(displayData?.title || '');
  const [logline, setLogline] = useState(displayData?.logline || '');

  useEffect(() => {
    store.fetchBasicInfo(projectId);
    store.fetchVersions(projectId, 'basicInfo', basicInfoId);
  }, [projectId, basicInfoId]);

  const handleSave = async () => {
    await store.updateBasicInfo(projectId, basicInfoId, {
      title,
      logline,
      genre,
    }, currentLanguage);

    await store.fetchVersions(projectId, 'basicInfo', basicInfoId);
  };

  return (
    <div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} />
      <input value={logline} onChange={(e) => setLogline(e.target.value)} />
      <button onClick={handleSave}>Save</button>
    </div>
  );
}
```

### After: BasicInfoManager.tsx (New)

```typescript
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { BasicInfoObject } from '../types/unifiedObject';

export function BasicInfoManager({ basicInfoId }: { basicInfoId: string }) {
  const store = useUnifiedObjectStore();
  const basicInfo = store.objects[basicInfoId] as BasicInfoObject;

  const [editedData, setEditedData] = useState({
    title: '',
    logline: '',
    genre: '',
  });

  useEffect(() => {
    store.fetchObject('basic_info', basicInfoId);
  }, [basicInfoId]);

  useEffect(() => {
    if (basicInfo?.data) {
      setEditedData(basicInfo.data);
    }
  }, [basicInfo?.data]);

  const handleSave = async () => {
    await store.updateObject('basic_info', basicInfoId, {
      data: editedData,
      language: basicInfo.languages.active,
      create_new_version: true,
    });
  };

  if (!basicInfo) return <div>Loading...</div>;

  return (
    <div>
      <LanguageSwitcher
        object={basicInfo}
        onLanguageChange={(lang) =>
          store.switchLanguage('basic_info', basicInfoId, lang)
        }
      />

      <input
        value={editedData.title}
        onChange={(e) => setEditedData(prev => ({...prev, title: e.target.value}))}
      />
      <input
        value={editedData.logline}
        onChange={(e) => setEditedData(prev => ({...prev, logline: e.target.value}))}
      />
      <button onClick={handleSave}>Save</button>
    </div>
  );
}
```

**Lines of Code:**
- Old: ~80 lines
- New: ~50 lines
- Reduction: 37.5%

---

## Testing Your Migration

After migrating a component, test:

1. **Basic Display**: Object data shows correctly
2. **Language Switching**: Switches without creating version
3. **Editing**: Updates save correctly
4. **Version Creation**: New versions created when expected
5. **In-place Updates**: Work for chapter content
6. **Error Handling**: Loading/error states work
7. **Performance**: No unnecessary re-renders

---

## Need Help?

- See [CharacterEditorExample.tsx](App/frontend/src/components/examples/CharacterEditorExample.tsx) for complete reference
- Read [MULTILINGUAL_SYSTEM_REDESIGN.md](MULTILINGUAL_SYSTEM_REDESIGN.md) for architecture details
- Check [unifiedObjectStore.ts](App/frontend/src/store/unifiedObjectStore.ts) for API reference
