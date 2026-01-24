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
import { OBJECT_TYPE_CONFIG } from '../../types/objectTypeConfig';
import { docToMarkdown } from '../../editor/manuscript/convert';

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
  // Story objects includes outline hierarchy (outline > act > chapter)
  const storyObjectTypes: ObjectType[] = ['character', 'organization', 'location', 'lorebook', 'outline', 'act', 'chapter'];

  // Chapter hierarchy types for manuscript mode display
  const chapterHierarchyTypes: ObjectType[] = ['outline', 'act', 'chapter', 'manuscript'];

  let types: ObjectType[];
  switch (mode) {
    case 'story-objects':
      types = storyObjectTypes;
      break;
    case 'manuscript':
      types = chapterHierarchyTypes;
      break;
    case 'all':
      // All unique types (storyObjectTypes already has outline/act/chapter, just add manuscript)
      types = [...storyObjectTypes, 'manuscript'];
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
    content: (data.content as string) || undefined,
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
    const flatStoryTypes: ObjectType[] = ['character', 'organization', 'location', 'lorebook'];

    flatStoryTypes.forEach(type => {
      const typeObjects = objects.filter(obj => obj.type === type);
      if (typeObjects.length > 0) {
        availableTypes.push(type);
        groups.push({
          id: `group-${type}`,
          label: OBJECT_TYPE_CONFIG[type]?.label || type,
          type,
          items: typeObjects
            .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0))
            .map(obj => objectToItem(obj, language)),
        });
      }
    });

    // Outline hierarchy: Outline > Act > Chapter
    const outlines = objects
      .filter(obj => obj.type === 'outline')
      .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0));
    const acts = objects
      .filter(obj => obj.type === 'act')
      .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0));
    const chapters = objects.filter(obj => obj.type === 'chapter');

    if (outlines.length > 0 || acts.length > 0 || chapters.length > 0) {
      // Build hierarchy: Outline > Act > Chapter
      const outlineChildGroups: ObjectPickerGroup[] = outlines.map(outline => {
        const outlineData = getObjectDataForLanguage(outline, language);
        const outlineActs = acts
          .filter(act => act.metadata?.outline_id === outline.id)
          .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0));

        // Create outline item
        const outlineItem: ObjectPickerItem = {
          id: outline.id,
          name: (outlineData.name as string) || 'Unnamed Outline',
          description: (outlineData.description as string) || undefined,
          content: (outlineData.content as string) || undefined,
          type: 'outline',
          order: outline.metadata?.order as number | undefined,
        };

        // Build act groups within this outline
        const actChildGroups: ObjectPickerGroup[] = outlineActs.map(act => {
          const actData = getObjectDataForLanguage(act, language);
          const actChapters = chapters
            .filter(ch => ch.metadata?.act_id === act.id)
            .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0));

          // Create act item
          const actItem: ObjectPickerItem = {
            id: act.id,
            name: (actData.name as string) || 'Unnamed Act',
            description: (actData.description as string) || undefined,
            content: (actData.content as string) || undefined,
            type: 'act',
            order: act.metadata?.order as number | undefined,
          };

          return {
            id: `outline-${outline.id}-act-${act.id}`,
            label: (actData.name as string) || 'Unnamed Act',
            type: 'act' as const,
            items: [actItem, ...actChapters.map(ch => objectToItem(ch, language))],
          };
        });

        return {
          id: `outline-${outline.id}`,
          label: (outlineData.name as string) || 'Unnamed Outline',
          type: 'outline' as ObjectType,
          items: [outlineItem],
          childGroups: actChildGroups,
        };
      });

      if (outlineChildGroups.length > 0) {
        availableTypes.push('outline', 'act', 'chapter');
        groups.push({
          id: 'group-outline',
          label: OBJECT_TYPE_CONFIG['outline']?.label || 'Outline',
          type: 'outline' as ObjectType,
          items: [],
          childGroups: outlineChildGroups,
        });
      }
    }
  }

  // Group manuscripts by outline hierarchy: Outline > Act > Chapter > Manuscript
  if (mode === 'manuscript' || mode === 'all') {
    const outlines = objects
      .filter(obj => obj.type === 'outline')
      .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0));
    const acts = objects
      .filter(obj => obj.type === 'act')
      .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0));
    const chapters = objects.filter(obj => obj.type === 'chapter');
    const manuscripts = objects.filter(obj => obj.type === 'manuscript');

    if (outlines.length > 0 || acts.length > 0 || chapters.length > 0) {
      // Build outline groups
      const outlineGroups: ObjectPickerGroup[] = outlines.map(outline => {
        const outlineData = getObjectDataForLanguage(outline, language);
        const outlineActs = acts
          .filter(act => act.metadata?.outline_id === outline.id)
          .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0));

        // Build act groups within this outline
        const actChildGroups: ObjectPickerGroup[] = outlineActs.map(act => {
          const actData = getObjectDataForLanguage(act, language);
          const actChapters = chapters
            .filter(ch => ch.metadata?.act_id === act.id)
            .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0));

          // Find manuscripts for each chapter - ONLY include if manuscript exists
          const items: ObjectPickerItem[] = actChapters
            .map(ch => {
              const chapterData = getObjectDataForLanguage(ch, language);
              const manuscript = manuscripts.find(m => m.metadata?.chapter_id === ch.id);

              // Skip chapters without manuscripts
              if (!manuscript) {
                return null;
              }

              const manuscriptData = getObjectDataForLanguage(manuscript, language);

              // Convert TipTap doc to markdown for content
              const manuscriptContent = manuscriptData?.doc
                ? docToMarkdown(manuscriptData.doc)
                : undefined;

              const item: ObjectPickerItem = {
                id: manuscript.id,
                name: (chapterData.name as string) || 'Unnamed Chapter',
                description: chapterData.description as string | undefined,
                content: manuscriptContent || undefined,
                type: 'manuscript' as ObjectType,
                parentId: ch.id,
                order: ch.metadata?.order as number | undefined,
                wordCount: manuscriptData?.wordCount as number | undefined,
              };
              return item;
            })
            .filter((item): item is ObjectPickerItem => item !== null);

          return {
            id: `manuscript-outline-${outline.id}-act-${act.id}`,
            label: (actData.name as string) || 'Unnamed Act',
            type: 'act' as const,
            items,
          };
        });

        return {
          id: `manuscript-outline-${outline.id}`,
          label: (outlineData.name as string) || 'Unnamed Outline',
          type: 'outline' as ObjectType,
          items: [],
          childGroups: actChildGroups,
        };
      });

      // Only add manuscripts group if there are manuscripts
      const hasManuscripts = outlineGroups.some(
        og => og.childGroups?.some(ag => ag.items.length > 0)
      );

      if (hasManuscripts) {
        groups.push({
          id: 'group-manuscripts',
          label: OBJECT_TYPE_CONFIG['manuscript']?.label || 'Manuscripts',
          type: 'manuscript',
          items: [],
          childGroups: outlineGroups,
        });
        availableTypes.push('manuscript');
      }
    }
  }

  // Sort groups by config order
  groups.sort((a, b) => {
    const orderA = OBJECT_TYPE_CONFIG[a.type as ObjectType]?.order ?? 999;
    const orderB = OBJECT_TYPE_CONFIG[b.type as ObjectType]?.order ?? 999;
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
