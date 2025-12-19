/**
 * Hook for fetching and organizing data for the ObjectPicker component
 */

import { useMemo, useEffect, useState } from 'react';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import type { ObjectType, UnifiedObject } from '../../types/unifiedObject';
import type {
  ObjectPickerMode,
  ObjectPickerGroup,
  ObjectPickerItem,
  UseObjectPickerDataOptions,
  UseObjectPickerDataResult,
} from './types';
import { CATEGORY_CONFIG } from './types';

/**
 * Helper to get data for a specific language from an object.
 * Falls back to first available language if requested language not found.
 */
function getObjectDataForLanguage(obj: UnifiedObject, language: string): Record<string, unknown> {
  if (obj.data[language]) {
    return obj.data[language];
  }
  const availableLanguages = Object.keys(obj.data);
  if (availableLanguages.length > 0) {
    return obj.data[availableLanguages[0]];
  }
  return {};
}

/**
 * Get the types to fetch based on mode
 */
function getTypesForMode(mode: ObjectPickerMode, excludeTypes: ObjectType[]): ObjectType[] {
  // Story objects now includes act and chapter (novel structure)
  const storyTypes: ObjectType[] = ['basic_info', 'character', 'organization', 'location', 'lorebook', 'act', 'chapter'];

  // Chapter hierarchy types for manuscript mode display
  const chapterHierarchyTypes: ObjectType[] = ['act', 'chapter', 'manuscript'];

  let types: ObjectType[];
  switch (mode) {
    case 'story-objects':
      types = storyTypes;
      break;
    case 'manuscript':
      types = chapterHierarchyTypes;
      break;
    case 'all':
      // All unique types (storyTypes already has act/chapter, just add manuscript)
      types = [...storyTypes, 'manuscript'];
      break;
  }

  return types.filter(t => !excludeTypes.includes(t));
}

/**
 * Convert a UnifiedObject to an ObjectPickerItem
 */
function objectToItem(obj: UnifiedObject, language: string): ObjectPickerItem {
  const data = getObjectDataForLanguage(obj, language);

  return {
    id: obj.id,
    name: (data.name as string) || (data.title as string) || obj.id,
    description: (data.description as string) || (data.logline as string) || undefined,
    type: obj.type,
    parentId: (obj.metadata?.act_id as string) || (obj.metadata?.chapter_id as string) || undefined,
    order: obj.metadata?.order as number | undefined,
    wordCount: (data.wordCount as number) || undefined,
  };
}

/**
 * Build groups from objects based on mode
 */
function buildGroups(
  objects: UnifiedObject[],
  language: string,
  mode: ObjectPickerMode
): { groups: ObjectPickerGroup[]; availableTypes: ObjectType[] } {
  const groups: ObjectPickerGroup[] = [];
  const availableTypes: ObjectType[] = [];

  // Group story objects by type
  if (mode === 'story-objects' || mode === 'all') {
    // Flat groups for basic story objects
    const flatStoryTypes: ObjectType[] = ['basic_info', 'character', 'organization', 'location', 'lorebook'];

    flatStoryTypes.forEach(type => {
      const typeObjects = objects.filter(obj => obj.type === type);
      if (typeObjects.length > 0) {
        availableTypes.push(type);
        groups.push({
          id: `group-${type}`,
          label: CATEGORY_CONFIG[type]?.label || type,
          type,
          items: typeObjects
            .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0))
            .map(obj => objectToItem(obj, language)),
        });
      }
    });

    // Outline group with Act > Chapter hierarchy
    const acts = objects
      .filter(obj => obj.type === 'act')
      .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0));
    const chapters = objects.filter(obj => obj.type === 'chapter');

    if (acts.length > 0 || chapters.length > 0) {
      const outlineChildGroups: ObjectPickerGroup[] = acts.map(act => {
        const actData = getObjectDataForLanguage(act, language);
        const actChapters = chapters
          .filter(ch => ch.metadata?.act_id === act.id)
          .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0));

        return {
          id: `act-${act.id}`,
          label: (actData.name as string) || 'Unnamed Act',
          type: 'act' as const,
          items: actChapters.map(ch => objectToItem(ch, language)),
        };
      });

      if (outlineChildGroups.length > 0) {
        availableTypes.push('act', 'chapter');
        groups.push({
          id: 'group-outline',
          label: CATEGORY_CONFIG['outline']?.label || 'Outline',
          type: 'act',
          items: [],
          childGroups: outlineChildGroups,
        });
      }
    }
  }

  // Group manuscripts by act (for manuscript mode)
  if (mode === 'manuscript' || mode === 'all') {
    const acts = objects
      .filter(obj => obj.type === 'act')
      .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0));
    const chapters = objects.filter(obj => obj.type === 'chapter');
    const manuscripts = objects.filter(obj => obj.type === 'manuscript');

    if (acts.length > 0 || chapters.length > 0) {
      const childGroups: ObjectPickerGroup[] = acts.map(act => {
        const actData = getObjectDataForLanguage(act, language);
        const actChapters = chapters
          .filter(ch => ch.metadata?.act_id === act.id)
          .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0));

        // Find manuscripts for each chapter - ONLY include if manuscript exists
        const items: ObjectPickerItem[] = actChapters
          .map(ch => {
            const chapterData = getObjectDataForLanguage(ch, language);
            const manuscript = manuscripts.find(m => m.metadata?.chapter_id === ch.id);

            // Skip chapters without manuscripts - do NOT use chapter ID as fallback!
            if (!manuscript) {
              return null;
            }

            const manuscriptData = getObjectDataForLanguage(manuscript, language);

            const item: ObjectPickerItem = {
              id: manuscript.id,
              name: (chapterData.name as string) || 'Unnamed Chapter',
              description: chapterData.description as string | undefined,
              type: 'manuscript' as ObjectType,
              parentId: ch.id,
              order: ch.metadata?.order as number | undefined,
              wordCount: manuscriptData?.wordCount as number | undefined,
            };
            return item;
          })
          .filter((item): item is ObjectPickerItem => item !== null);

        return {
          id: `act-${act.id}`,
          label: (actData.name as string) || 'Unnamed Act',
          type: 'act' as const,
          items,
        };
      });

      // Only add manuscripts group if there are manuscripts
      if (childGroups.some(g => g.items.length > 0)) {
        groups.push({
          id: 'group-manuscripts',
          label: CATEGORY_CONFIG['manuscript']?.label || 'Manuscripts',
          type: 'manuscript',
          items: [],
          childGroups,
        });
        availableTypes.push('manuscript');
      }
    }
  }

  // Sort groups by config order
  groups.sort((a, b) => {
    const orderA = CATEGORY_CONFIG[a.type]?.order ?? 999;
    const orderB = CATEGORY_CONFIG[b.type]?.order ?? 999;
    return orderA - orderB;
  });

  return { groups, availableTypes };
}

/**
 * Hook to fetch and organize data for ObjectPicker
 */
export function useObjectPickerData({
  projectId,
  language,
  mode,
  excludeTypes = [],
}: UseObjectPickerDataOptions): UseObjectPickerDataResult {
  const store = useUnifiedObjectStore();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch required object types based on mode
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const typesToFetch = getTypesForMode(mode, excludeTypes);
        await Promise.all(
          typesToFetch.map(type => store.listObjects(type, projectId))
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load objects');
      } finally {
        setIsLoading(false);
      }
    };

    if (projectId) {
      fetchData();
    }
  }, [projectId, mode, JSON.stringify(excludeTypes)]);

  // Build groups from store data
  const { groups, availableTypes } = useMemo(() => {
    const allObjects = Object.values(store.objects) as UnifiedObject[];
    const projectObjects = allObjects.filter(
      obj => obj.metadata?.project_id === projectId
    );

    // Filter by mode and excludeTypes
    const typesToInclude = getTypesForMode(mode, excludeTypes);
    const filteredObjects = projectObjects.filter(
      obj => typesToInclude.includes(obj.type)
    );

    return buildGroups(filteredObjects, language, mode);
  }, [store.objects, projectId, language, mode, JSON.stringify(excludeTypes)]);

  return { groups, availableTypes, isLoading, error };
}

export default useObjectPickerData;
