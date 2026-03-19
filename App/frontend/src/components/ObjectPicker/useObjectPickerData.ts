/**
 * Hook for fetching and organizing data for the ObjectPicker component.
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
import { buildBasicInfoSummary, normalizeBasicInfoData } from '../../utils/basicInfo';
import {
  getStoryEntityFolderDescription,
  getStoryEntityFolderName,
  type StoryEntityFolder,
} from '../../types/storyEntityFolder';
import { getProjectStoryEntityFolders } from '../../utils/storyEntityTree';

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

function getTypesForMode(mode: ObjectPickerMode, excludeTypes: ObjectType[]): ObjectType[] {
  let types: ObjectType[];
  switch (mode) {
    case 'story-entities':
      types = ['story_entity'];
      break;
    case 'manuscript':
      types = ['outline', 'manuscript'];
      break;
    case 'all':
      types = ['story_entity', 'outline', 'manuscript'];
      break;
    case 'translation':
      types = ['basic_info', 'guidelines', 'story_entity', 'outline', 'manuscript'];
      break;
    default:
      types = ['story_entity'];
      break;
  }
  return types.filter((type) => !excludeTypes.includes(type));
}

function objectToItem(obj: UnifiedObject, language: string): ObjectPickerItem {
  const data = getObjectDataForLanguage(obj, language);
  const fallbackName = OBJECT_TYPE_CONFIG[obj.type]?.label || obj.id;

  let name = (data.name as string) || (data.title as string) || fallbackName;
  let description = (data.description as string) || (data.logline as string) || undefined;
  let content = (data.content as string) || undefined;

  if (obj.type === 'basic_info') {
    const basicInfo = normalizeBasicInfoData(data);
    name = basicInfo.title || fallbackName;
    description = basicInfo.logline || undefined;
    content = buildBasicInfoSummary(basicInfo) || undefined;
  } else if (obj.type === 'guidelines') {
    const authorNote = (data as { authorNote?: string }).authorNote;
    name = fallbackName;
    content = authorNote || undefined;
  }

  return {
    id: obj.id,
    name,
    description,
    content,
    type: obj.type,
    kind: obj.type === 'outline' ? obj.kind as 'outline' | 'act' | 'chapter' | undefined : undefined,
    parentId: (obj.metadata?.parent_id as string) || (obj.metadata?.chapter_id as string) || undefined,
    order: (obj.metadata?.display_order as number | undefined) ?? (obj.metadata?.position as number | undefined),
    wordCount: (data.wordCount as number) || undefined,
    metadata: {
      ...obj.metadata,
      kind: obj.kind,
    },
  };
}

function buildFolderNodeMap(
  folders: StoryEntityFolder[],
  language?: string,
): Map<string, ObjectPickerGroup> {
  const map = new Map<string, ObjectPickerGroup>();

  for (const folder of folders) {
    map.set(folder.id, {
      id: `story-entity-folder-${folder.id}`,
      label: getStoryEntityFolderName(folder, language),
      description: getStoryEntityFolderDescription(folder, language) || undefined,
      type: 'story_entity',
      order: folder.metadata.display_order ?? 0,
      items: [],
      childGroups: [],
    });
  }

  return map;
}

function buildStoryEntityGroups(
  entities: UnifiedObject[],
  folders: StoryEntityFolder[],
  language: string,
  mode: ObjectPickerMode,
): ObjectPickerGroup[] {
  const sortedFolders = [...folders].sort((a, b) => {
    const orderA = a.metadata.display_order ?? 0;
    const orderB = b.metadata.display_order ?? 0;
    if (orderA === orderB) {
      return getStoryEntityFolderName(a, language).localeCompare(getStoryEntityFolderName(b, language));
    }
    return orderA - orderB;
  });
  const sortedEntities = [...entities].sort((a, b) => {
    const orderA = a.metadata?.display_order ?? 0;
    const orderB = b.metadata?.display_order ?? 0;
    if (orderA === orderB) {
      return objectToItem(a, language).name.localeCompare(objectToItem(b, language).name);
    }
    return orderA - orderB;
  });

  const folderMap = buildFolderNodeMap(sortedFolders, language);
  const rootItems: ObjectPickerItem[] = [];
  const rootGroups: ObjectPickerGroup[] = [];

  for (const entity of sortedEntities) {
    const item = objectToItem(entity, language);
    const folderId = (entity.metadata?.folder_id as string | null | undefined) ?? null;
    if (folderId && folderMap.has(folderId)) {
      folderMap.get(folderId)?.items.push(item);
    } else {
      rootItems.push(item);
    }
  }

  // In translation mode, add folders as selectable items (like acts in outlines)
  if (mode === 'translation') {
    for (const folder of sortedFolders) {
      const group = folderMap.get(folder.id);
      if (!group) continue;
      group.items.unshift({
        id: folder.id,
        name: getStoryEntityFolderName(folder, language),
        description: getStoryEntityFolderDescription(folder, language),
        type: 'story_entity_folder',
        order: folder.metadata.display_order ?? 0,
      });
    }
  }

  for (const folder of sortedFolders) {
    const group = folderMap.get(folder.id);
    if (!group) continue;
    const parentId = (folder.metadata.parent_id as string | null | undefined) ?? null;
    if (parentId && folderMap.has(parentId)) {
      folderMap.get(parentId)?.childGroups?.push(group);
    } else {
      rootGroups.push(group);
    }
  }

  if (rootItems.length === 0 && rootGroups.length === 0) {
    return [];
  }

  return [
    {
      id: 'group-story-entities',
      label: OBJECT_TYPE_CONFIG.story_entity.label,
      type: 'story_entity',
      items: rootItems,
      childGroups: rootGroups,
    },
  ];
}

function buildMetaGroups(
  objects: UnifiedObject[],
  language: string,
  mode: ObjectPickerMode,
): { groups: ObjectPickerGroup[]; availableTypes: ObjectType[] } {
  const groups: ObjectPickerGroup[] = [];
  const availableTypes: ObjectType[] = [];

  if (mode !== 'translation') {
    return { groups, availableTypes };
  }

  for (const type of ['basic_info', 'guidelines'] as const) {
    const items = objects
      .filter((obj) => obj.type === type)
      .map((obj) => objectToItem(obj, language));
    if (items.length === 0) continue;
    availableTypes.push(type);
    groups.push({
      id: `group-${type}`,
      label: OBJECT_TYPE_CONFIG[type].label,
      type,
      items,
    });
  }

  return { groups, availableTypes };
}

function buildOutlineGroups(
  objects: UnifiedObject[],
  language: string,
  includeManuscripts: boolean,
): { groups: ObjectPickerGroup[]; availableTypes: ObjectType[] } {
  const groups: ObjectPickerGroup[] = [];
  const availableTypes: ObjectType[] = [];

  const outlineItems = objects
    .filter((obj): obj is UnifiedObject => obj.type === 'outline')
    .sort((a, b) => (a.metadata?.position || 0) - (b.metadata?.position || 0));
  const outlines = outlineItems.filter((obj) => obj.kind === 'outline');
  const acts = outlineItems.filter((obj) => obj.kind === 'act');
  const chapters = outlineItems.filter((obj) => obj.kind === 'chapter');
  const manuscripts = objects.filter((obj) => obj.type === 'manuscript');

  if (outlines.length === 0 && acts.length === 0 && chapters.length === 0) {
    return { groups, availableTypes };
  }

  if (!includeManuscripts) {
    const outlineGroups: ObjectPickerGroup[] = outlines.map((outline) => {
      const outlineData = getObjectDataForLanguage(outline, language);
      const outlineActs = acts
        .filter((act) => act.metadata?.parent_id === outline.id)
        .sort((a, b) => (a.metadata?.position || 0) - (b.metadata?.position || 0));

      return {
        id: `outline-${outline.id}`,
        label: (outlineData.name as string) || 'Unnamed Outline',
        type: 'outline' as const,
        kind: 'outline' as const,
        order: outline.metadata?.position as number | undefined,
        items: [objectToItem(outline, language)],
        childGroups: outlineActs.map((act) => {
          const actData = getObjectDataForLanguage(act, language);
          const actChapters = chapters
            .filter((chapter) => chapter.metadata?.parent_id === act.id)
            .sort((a, b) => (a.metadata?.position || 0) - (b.metadata?.position || 0));
          return {
            id: `outline-${outline.id}-act-${act.id}`,
            label: (actData.name as string) || 'Unnamed Act',
            type: 'outline' as const,
            kind: 'act' as const,
            order: act.metadata?.position as number | undefined,
            items: [objectToItem(act, language), ...actChapters.map((chapter) => objectToItem(chapter, language))],
          };
        }),
      };
    });

    groups.push({
      id: 'group-outline',
      label: OBJECT_TYPE_CONFIG.outline.label,
      type: 'outline',
      items: [],
      childGroups: outlineGroups,
    });
    availableTypes.push('outline');
    return { groups, availableTypes };
  }

  const manuscriptOutlineGroups: ObjectPickerGroup[] = outlines.map((outline) => {
    const outlineData = getObjectDataForLanguage(outline, language);
    const outlineActs = acts
      .filter((act) => act.metadata?.parent_id === outline.id)
      .sort((a, b) => (a.metadata?.position || 0) - (b.metadata?.position || 0));

    return {
      id: `manuscript-outline-${outline.id}`,
      label: (outlineData.name as string) || 'Unnamed Outline',
      type: 'outline' as const,
      kind: 'outline' as const,
      order: outline.metadata?.position as number | undefined,
      items: [],
      childGroups: outlineActs.map<ObjectPickerGroup>((act) => {
        const actData = getObjectDataForLanguage(act, language);
        const actChapters = chapters
          .filter((chapter) => chapter.metadata?.parent_id === act.id)
          .sort((a, b) => (a.metadata?.position || 0) - (b.metadata?.position || 0));

        const items: ObjectPickerItem[] = [];
        actChapters.forEach((chapter) => {
            const chapterData = getObjectDataForLanguage(chapter, language);
            const manuscript = manuscripts.find((item) => item.metadata?.chapter_id === chapter.id);
            if (!manuscript) return;
            const manuscriptData = getObjectDataForLanguage(manuscript, language);
            items.push({
              id: manuscript.id,
              name: (chapterData.name as string) || 'Unnamed Chapter',
              description: chapterData.description as string | undefined,
              content: manuscriptData.doc ? docToMarkdown(manuscriptData.doc, { stripImages: true }) : undefined,
              type: 'manuscript' as const,
              parentId: chapter.id,
              order: chapter.metadata?.position as number | undefined,
              wordCount: manuscriptData.wordCount as number | undefined,
            });
          });

        return {
          id: `manuscript-outline-${outline.id}-act-${act.id}`,
          label: (actData.name as string) || 'Unnamed Act',
          type: 'outline' as const,
          kind: 'act' as const,
          order: act.metadata?.position as number | undefined,
          items,
        };
      }),
    };
  });

  if (manuscriptOutlineGroups.some((group) => group.childGroups?.some((child) => child.items.length > 0))) {
    groups.push({
      id: 'group-manuscripts',
      label: OBJECT_TYPE_CONFIG.manuscript.label,
      type: 'manuscript',
      items: [],
      childGroups: manuscriptOutlineGroups,
    });
    availableTypes.push('manuscript');
  }

  return { groups, availableTypes };
}

function buildGroups(
  objects: UnifiedObject[],
  folders: StoryEntityFolder[],
  language: string,
  mode: ObjectPickerMode,
): { groups: ObjectPickerGroup[]; availableTypes: ObjectType[] } {
  const groups: ObjectPickerGroup[] = [];
  const availableTypes: ObjectType[] = [];

  const meta = buildMetaGroups(objects, language, mode);
  groups.push(...meta.groups);
  availableTypes.push(...meta.availableTypes);

  if (mode === 'story-entities' || mode === 'all' || mode === 'translation') {
    const entityGroups = buildStoryEntityGroups(
      objects.filter((obj) => obj.type === 'story_entity'),
      folders,
      language,
      mode,
    );
    if (entityGroups.length > 0) {
      groups.push(...entityGroups);
      availableTypes.push('story_entity');
    }
  }

  if (mode === 'all' || mode === 'translation') {
    const outline = buildOutlineGroups(objects, language, false);
    groups.push(...outline.groups);
    availableTypes.push(...outline.availableTypes);
  }

  if (mode === 'manuscript' || mode === 'all' || mode === 'translation') {
    const manuscriptGroups = buildOutlineGroups(objects, language, true);
    groups.push(...manuscriptGroups.groups);
    availableTypes.push(...manuscriptGroups.availableTypes);
  }

  groups.sort((a, b) => {
    const orderA = OBJECT_TYPE_CONFIG[a.type]?.order ?? 999;
    const orderB = OBJECT_TYPE_CONFIG[b.type]?.order ?? 999;
    return orderA - orderB;
  });

  return { groups, availableTypes: [...new Set(availableTypes)] };
}

export function useObjectPickerData({
  projectId,
  language,
  mode,
  excludeTypes = [],
}: UseObjectPickerDataOptions): UseObjectPickerDataResult {
  const objectStore = useUnifiedObjectStore();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const typesToFetch = getTypesForMode(mode, excludeTypes);
        await Promise.all(
          typesToFetch.map((type) => (
            type === 'story_entity'
              ? objectStore.refreshStoryEntityTree(projectId)
              : objectStore.listObjects(type, projectId)
          )),
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
  }, [projectId, mode, language, JSON.stringify(excludeTypes)]);

  const { groups, availableTypes } = useMemo(() => {
    const projectObjects = (Object.values(objectStore.objects) as UnifiedObject[]).filter(
      (obj) => obj.metadata?.project_id === projectId,
    );
    const typesToInclude = getTypesForMode(mode, excludeTypes);
    const filteredObjects = projectObjects.filter((obj) => typesToInclude.includes(obj.type));
    const folders = getProjectStoryEntityFolders(objectStore.objects, projectId);
    return buildGroups(filteredObjects, folders, language, mode);
  }, [objectStore.objects, projectId, language, mode, JSON.stringify(excludeTypes)]);

  return { groups, availableTypes, isLoading, error };
}

export default useObjectPickerData;
