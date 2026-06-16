/**
 * Hook for organizing object data for the ObjectPicker component.
 *
 * Reads objects via TanStack Query collections fetched in MARKDOWN format, so
 * `data.content` is already rendered markdown text (replacing the old
 * getRichTextMarkdown cache). Story entities + folders come from the story-tree
 * query. Outline ordering/numbering use the single-source domain helpers.
 */

import { useMemo } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { AnyObjectType, ObjectType, UnifiedObject } from '../../types/unifiedObject';
import type { CalendarConfig, TimelineTrack } from '../../types/timeline';
import { getAnyObjectTypeOrder } from '../../types/timeline';
import type {
  ObjectPickerMode,
  ObjectPickerGroup,
  ObjectPickerItem,
  UseObjectPickerDataOptions,
  UseObjectPickerDataResult,
} from './types';
import { OBJECT_TYPE_CONFIG } from '../../types/objectTypeConfig';
import { buildBasicInfoSummary, normalizeBasicInfoData } from '../../utils/basicInfo';
import { formatDate } from '../../utils/timelineCalendar';
import { buildTimelineFromObjects } from '../../utils/timelineView';
import { useTimelineStore } from '../../store/timelineStore';
import {
  getStoryEntityFolderDescription,
  getStoryEntityFolderName,
  type StoryEntityFolder,
} from '../../types/storyEntityFolder';
import { docToPlainText } from '../../editor/manuscript/doc';
import { compareOutlineOrder, buildOutlineNumbering } from '../../domain/outlineHierarchy';
import { useObjectCollectionQuery } from '../../data/objects/useObjectCollectionQuery';
import { useStoryEntityTreeQuery } from '../../data/objects/useStoryEntityTreeQuery';

const EMPTY_OBJECT_TYPES: ObjectType[] = [];

function dataOf(obj: UnifiedObject): Record<string, unknown> {
  return obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)
    ? (obj.data as Record<string, unknown>)
    : {};
}

export function getTypesForMode(mode: ObjectPickerMode, excludeTypes: ObjectType[]): AnyObjectType[] {
  let types: AnyObjectType[];
  switch (mode) {
    case 'story-entities':
      types = ['story_entity'];
      break;
    case 'manuscript':
      types = ['outline', 'manuscript'];
      break;
    case 'all':
      types = ['story_entity', 'outline', 'manuscript', 'timeline_track', 'timeline_event'];
      break;
    case 'translation':
      types = ['basic_info', 'guidelines', 'story_entity', 'outline', 'manuscript', 'timeline_track', 'timeline_event'];
      break;
    default:
      types = ['story_entity'];
      break;
  }
  return types.filter((type) => !excludeTypes.includes(type as ObjectType));
}

function getDisplayName(rawName: unknown, fallbackName: string): string {
  if (typeof rawName === 'string' && rawName.trim().length > 0) {
    return rawName;
  }
  return fallbackName;
}

function getOutlineObjectName(obj: UnifiedObject, fallbackName: string): string {
  return getDisplayName(dataOf(obj).name, fallbackName);
}

function formatActDisplayName(baseName: string, actNumber: number | undefined, t: TFunction): string {
  if (actNumber === undefined) {
    return baseName;
  }
  return `${t('objectPicker.actPrefix')} ${actNumber} ${baseName}`;
}

function formatChapterDisplayName(baseName: string, chapterNumber: number | undefined, t: TFunction): string {
  if (chapterNumber === undefined) {
    return baseName;
  }
  return `${t('objectPicker.chapterPrefix')} ${chapterNumber} ${baseName}`;
}

function objectToItem(obj: UnifiedObject): ObjectPickerItem {
  const data = dataOf(obj);
  const fallbackName = OBJECT_TYPE_CONFIG[obj.type]?.label || obj.id;

  let name = (data.name as string) || (data.title as string) || fallbackName;
  let description = (data.description as string) || (data.logline as string) || undefined;
  let content = typeof data.content === 'string' ? data.content : undefined;

  if (obj.type === 'basic_info') {
    const basicInfo = normalizeBasicInfoData(data);
    name = basicInfo.title || fallbackName;
    description = basicInfo.logline || undefined;
    content = buildBasicInfoSummary(basicInfo) || undefined;
  } else if (obj.type === 'guidelines') {
    name = fallbackName;
    content = typeof (data as { authorNote?: unknown }).authorNote === 'string'
      ? (data as { authorNote?: string }).authorNote
      : undefined;
  }

  return {
    id: obj.id,
    name,
    description,
    content,
    type: obj.type,
    kind: obj.type === 'outline' ? (obj.kind as 'outline' | 'act' | 'chapter' | undefined) : undefined,
    parentId: (obj.metadata?.parent_id as string) || (obj.metadata?.chapter_id as string) || undefined,
    order: (obj.metadata?.display_order as number | undefined) ?? (obj.metadata?.position as number | undefined),
    wordCount: (data.wordCount as number) || undefined,
    metadata: {
      ...obj.metadata,
      kind: obj.kind,
    },
  };
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function timelineContentToText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return toNonEmptyString(value);
  }
  if (value && typeof value === 'object') {
    const text = docToPlainText(value);
    return text.length > 0 ? text : undefined;
  }
  return undefined;
}

function formatTimelineEventDate(
  startDate: Record<string, number>,
  endDate: Record<string, number> | null | undefined,
  calendar: CalendarConfig | null,
): string | undefined {
  if (!calendar) return undefined;
  const start = formatDate(startDate, calendar);
  if (!endDate) return start;
  const end = formatDate(endDate, calendar);
  return end === start ? start : `${start} - ${end}`;
}

export function buildTimelineEventGroups(
  tracks: TimelineTrack[],
  calendar: CalendarConfig | null,
  _language: string,
  _mode: ObjectPickerMode,
  t: TFunction,
): ObjectPickerGroup[] {
  if (tracks.length === 0) return [];

  const untitledTrack = t('timeline.untitledTrack', 'Untitled Track');
  const untitledEvent = t('timeline.untitledEvent', 'Untitled Event');

  const buildTrackGroup = (track: TimelineTrack): ObjectPickerGroup => {
    const trackData = track.data;
    const trackName = toNonEmptyString(trackData.name) || untitledTrack;
    return {
      id: `timeline-track-${track.id}`,
      label: trackName,
      description: toNonEmptyString(trackData.description),
      type: 'timeline_track',
      order: track.position,
      items: [
        {
          id: track.id,
          name: trackName,
          description: toNonEmptyString(trackData.description),
          content: timelineContentToText(trackData.content),
          type: 'timeline_track' as const,
          parentId: track.parentId ?? undefined,
          order: track.position,
          isGroupParent: true,
          metadata: {
            trackId: track.id,
            trackName,
          },
        },
        ...track.events.map((event) => {
          const eventData = event.data;
          const eventDescription = toNonEmptyString(eventData.description);
          const formattedDate = formatTimelineEventDate(event.startDate, event.endDate, calendar);
          return {
            id: event.id,
            name: toNonEmptyString(eventData.name) || untitledEvent,
            description: eventDescription || formattedDate,
            content: timelineContentToText(eventData.content),
            type: 'timeline_event' as const,
            parentId: track.id,
            metadata: {
              trackId: track.id,
              trackName,
              formattedDate,
              description: eventDescription,
              startDate: event.startDate,
              endDate: event.endDate,
              tags: event.tags,
            },
          };
        }),
      ],
      childGroups: track.children.map(buildTrackGroup),
    };
  };

  return [
    {
      id: 'group-timeline-events',
      label: t('timeline.title', 'Timeline'),
      type: 'timeline_track',
      items: [],
      childGroups: tracks.map(buildTrackGroup),
    },
  ];
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
      return objectToItem(a).name.localeCompare(objectToItem(b).name);
    }
    return orderA - orderB;
  });

  const folderMap = buildFolderNodeMap(sortedFolders, language);
  const rootItems: ObjectPickerItem[] = [];
  const rootGroups: ObjectPickerGroup[] = [];

  for (const entity of sortedEntities) {
    const item = objectToItem(entity);
    const folderId = (entity.metadata?.folder_id as string | null | undefined) ?? null;
    if (folderId && folderMap.has(folderId)) {
      folderMap.get(folderId)?.items.push(item);
    } else {
      rootItems.push(item);
    }
  }

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
        isGroupParent: true,
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
      .map((obj) => objectToItem(obj));
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
  includeManuscripts: boolean,
  t: TFunction,
  mode: ObjectPickerMode = 'all',
): { groups: ObjectPickerGroup[]; availableTypes: ObjectType[] } {
  const groups: ObjectPickerGroup[] = [];
  const availableTypes: ObjectType[] = [];

  const outlineItems = objects
    .filter((obj): obj is UnifiedObject => obj.type === 'outline')
    .sort(compareOutlineOrder);
  const outlines = outlineItems.filter((obj) => obj.kind === 'outline');
  const acts = outlineItems.filter((obj) => obj.kind === 'act');
  const chapters = outlineItems.filter((obj) => obj.kind === 'chapter');
  const manuscripts = objects.filter((obj) => obj.type === 'manuscript');
  const { actNumberById, chapterNumberById } = buildOutlineNumbering(outlineItems);
  const untitledOutline = t('outline.untitledOutline');
  const untitledAct = t('outline.untitledAct');
  const untitledChapter = t('outline.untitledChapter');

  if (outlines.length === 0 && acts.length === 0 && chapters.length === 0) {
    return { groups, availableTypes };
  }

  const markStructural = mode === 'all' || mode === 'manuscript';

  if (!includeManuscripts) {
    const outlineGroups: ObjectPickerGroup[] = outlines.map((outline) => {
      const outlineLabel = getOutlineObjectName(outline, untitledOutline);
      const outlineItem = {
        ...objectToItem(outline),
        name: outlineLabel,
        ...(markStructural ? { isStructural: true } : {}),
        isGroupParent: true,
      };
      const outlineActs = acts
        .filter((act) => act.metadata?.parent_id === outline.id)
        .sort(compareOutlineOrder);

      return {
        id: `outline-${outline.id}`,
        label: outlineLabel,
        type: 'outline' as const,
        kind: 'outline' as const,
        order: outline.metadata?.position as number | undefined,
        items: [outlineItem],
        childGroups: outlineActs.map((act) => {
          const actName = formatActDisplayName(
            getOutlineObjectName(act, untitledAct),
            actNumberById.get(act.id),
            t,
          );
          const actChapters = chapters
            .filter((chapter) => chapter.metadata?.parent_id === act.id)
            .sort(compareOutlineOrder);

          const actItem = {
            ...objectToItem(act),
            name: actName,
            ...(markStructural ? { isStructural: true } : {}),
            isGroupParent: true,
          };
          const chapterItems = actChapters.map((chapter) => ({
            ...objectToItem(chapter),
            name: formatChapterDisplayName(
              getOutlineObjectName(chapter, untitledChapter),
              chapterNumberById.get(chapter.id),
              t,
            ),
          }));

          return {
            id: `outline-${outline.id}-act-${act.id}`,
            label: actName,
            type: 'outline' as const,
            kind: 'act' as const,
            order: act.metadata?.position as number | undefined,
            items: [actItem, ...chapterItems],
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

  const manuscriptsByChapterId = new Map<string, UnifiedObject>();
  manuscripts.forEach((manuscript) => {
    const chapterId = manuscript.metadata?.chapter_id as string | undefined;
    if (chapterId) {
      manuscriptsByChapterId.set(chapterId, manuscript);
    }
  });

  const manuscriptOutlineGroups: ObjectPickerGroup[] = outlines.map((outline) => {
    const outlineLabel = getOutlineObjectName(outline, untitledOutline);
    const outlineActs = acts
      .filter((act) => act.metadata?.parent_id === outline.id)
      .sort(compareOutlineOrder);

    return {
      id: `manuscript-outline-${outline.id}`,
      label: outlineLabel,
      type: 'outline' as const,
      kind: 'outline' as const,
      order: outline.metadata?.position as number | undefined,
      items: [],
      childGroups: outlineActs.map<ObjectPickerGroup>((act) => {
        const actName = formatActDisplayName(
          getOutlineObjectName(act, untitledAct),
          actNumberById.get(act.id),
          t,
        );
        const actChapters = chapters
          .filter((chapter) => chapter.metadata?.parent_id === act.id)
          .sort(compareOutlineOrder);

        const items: ObjectPickerItem[] = [];
        actChapters.forEach((chapter) => {
          const chapterData = dataOf(chapter);
          const manuscript = manuscriptsByChapterId.get(chapter.id);
          if (!manuscript) return;
          const manuscriptData = dataOf(manuscript);
          items.push({
            id: manuscript.id,
            name: formatChapterDisplayName(
              getDisplayName(chapterData.name, untitledChapter),
              chapterNumberById.get(chapter.id),
              t,
            ),
            description: chapterData.description as string | undefined,
            content: typeof manuscriptData.content === 'string' ? manuscriptData.content : undefined,
            type: 'manuscript' as const,
            parentId: chapter.id,
            order: chapter.metadata?.position as number | undefined,
            wordCount: manuscriptData.wordCount as number | undefined,
            metadata: {
              ...manuscript.metadata,
            },
          });
        });

        return {
          id: `manuscript-outline-${outline.id}-act-${act.id}`,
          label: actName,
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
  timelineTracks: TimelineTrack[],
  timelineCalendar: CalendarConfig | null,
  language: string,
  mode: ObjectPickerMode,
  t: TFunction,
): { groups: ObjectPickerGroup[]; availableTypes: AnyObjectType[] } {
  const groups: ObjectPickerGroup[] = [];
  const availableTypes: AnyObjectType[] = [];

  const meta = buildMetaGroups(objects, mode);
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
    const outline = buildOutlineGroups(objects, false, t, mode);
    groups.push(...outline.groups);
    availableTypes.push(...outline.availableTypes);
  }

  if (mode === 'manuscript' || mode === 'all' || mode === 'translation') {
    const manuscriptGroups = buildOutlineGroups(objects, true, t, mode);
    groups.push(...manuscriptGroups.groups);
    availableTypes.push(...manuscriptGroups.availableTypes);
  }

  if (mode === 'all' || mode === 'translation') {
    const timelineGroups = buildTimelineEventGroups(timelineTracks, timelineCalendar, language, mode, t);
    if (timelineGroups.length > 0) {
      groups.push(...timelineGroups);
      availableTypes.push('timeline_track', 'timeline_event');
    }
  }

  groups.sort((a, b) => {
    const orderA = getAnyObjectTypeOrder(a.type);
    const orderB = getAnyObjectTypeOrder(b.type);
    return orderA - orderB;
  });

  return { groups, availableTypes: [...new Set(availableTypes)] };
}

export function useObjectPickerData({
  projectId,
  language,
  mode,
  excludeTypes = EMPTY_OBJECT_TYPES,
}: UseObjectPickerDataOptions): UseObjectPickerDataResult {
  const { t } = useTranslation();

  // Fetch in markdown so data.content holds rendered markdown text for items.
  const basicInfo = useObjectCollectionQuery(projectId, 'basic_info', language, 'markdown');
  const guidelines = useObjectCollectionQuery(projectId, 'guidelines', language, 'markdown');
  const outline = useObjectCollectionQuery(projectId, 'outline', language, 'markdown');
  const manuscript = useObjectCollectionQuery(projectId, 'manuscript', language, 'markdown');
  const tracks = useObjectCollectionQuery(projectId, 'timeline_track', language, 'markdown');
  const events = useObjectCollectionQuery(projectId, 'timeline_event', language, 'markdown');
  const tree = useStoryEntityTreeQuery(projectId, language, 'markdown');

  const timelineConfig = useTimelineStore((state) => (projectId ? state.configByProject[projectId] : null));

  const folders = useMemo<StoryEntityFolder[]>(
    () => ((tree.data?.folders ?? []) as unknown as StoryEntityFolder[]),
    [tree.data],
  );

  const objects = useMemo<UnifiedObject[]>(
    () => [
      ...(basicInfo.data ?? []),
      ...(guidelines.data ?? []),
      ...(outline.data ?? []),
      ...(manuscript.data ?? []),
      ...(tracks.data ?? []),
      ...(events.data ?? []),
      ...(tree.data?.entities ?? []),
    ],
    [basicInfo.data, guidelines.data, outline.data, manuscript.data, tracks.data, events.data, tree.data],
  );

  const timeline = useMemo(() => {
    if (!projectId) return null;
    const record: Record<string, UnifiedObject> = {};
    for (const obj of [...(tracks.data ?? []), ...(events.data ?? [])]) record[obj.id] = obj;
    return buildTimelineFromObjects(projectId, record, timelineConfig);
  }, [projectId, tracks.data, events.data, timelineConfig]);

  const typesToInclude = useMemo(() => getTypesForMode(mode, excludeTypes), [mode, excludeTypes]);

  const isLoading =
    basicInfo.isLoading
    || guidelines.isLoading
    || outline.isLoading
    || manuscript.isLoading
    || tracks.isLoading
    || events.isLoading
    || tree.isLoading;

  const { groups, availableTypes } = useMemo(() => {
    const filteredObjects = objects.filter(
      (obj) => obj.metadata?.project_id === projectId && typesToInclude.includes(obj.type),
    );
    return buildGroups(filteredObjects, folders, timeline?.tracks ?? [], timeline?.calendar ?? null, language, mode, t);
  }, [objects, folders, projectId, language, mode, t, timeline, typesToInclude]);

  return { groups, availableTypes, isLoading, error: null };
}

export default useObjectPickerData;
