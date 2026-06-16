/**
 * Build the simplified project-object structure used for chat/agent context.
 *
 * Single source of truth — replaces the duplicated derivations in:
 * - store/unifiedObjectStore.ts useProjectObjects (hook)
 * - pages/UnifiedWorkspace/UnifiedWorkspace.tsx (inline builder)
 *
 * Pure: takes the project's objects (already fetched in the desired language)
 * and returns the nested structure. No React, no store access.
 */

import type {
  UnifiedObject,
  StoryEntityObject,
  OutlineObject,
  StoryEntityKind,
} from '../types/unifiedObject';
import type { TipTapDoc } from '../types/tiptap';
import { normalizeBasicInfoData } from '../utils/basicInfo';
import { normalizeDoc } from '../editor/manuscript/doc';
import { sortOutlineObjects } from './outlineHierarchy';

export interface SimplifiedProjectObjects {
  basicInfo: {
    id: string;
    title: string;
    logline: string;
    genres: string[];
    tags: string[];
  } | null;
  storyEntities: Array<{ id: string; kind: StoryEntityKind; name: string; description: string; content: TipTapDoc }>;
  characters: Array<{ id: string; name: string; description: string; content: TipTapDoc }>;
  organizations: Array<{ id: string; name: string; description: string; content: TipTapDoc }>;
  locations: Array<{ id: string; name: string; description: string; content: TipTapDoc }>;
  lorebook: Array<{ id: string; name: string; description: string; content: TipTapDoc }>;
  outline: {
    outlines: Array<{
      id: string;
      name: string;
      description: string;
      content: TipTapDoc;
      position: number;
      acts: Array<{
        id: string;
        name: string;
        description: string;
        content: TipTapDoc;
        position: number;
        parentId: string;
        chapters: Array<{
          id: string;
          name: string;
          description: string;
          content: TipTapDoc;
          position: number;
          parentId: string;
        }>;
      }>;
    }>;
  };
}

const EMPTY: SimplifiedProjectObjects = {
  basicInfo: null,
  storyEntities: [],
  characters: [],
  organizations: [],
  locations: [],
  lorebook: [],
  outline: { outlines: [] },
};

function dataOf(obj: UnifiedObject): Record<string, any> {
  return obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)
    ? (obj.data as Record<string, any>)
    : {};
}

function entityShape(entity: StoryEntityObject) {
  const d = dataOf(entity);
  return {
    id: entity.id,
    name: d.name || '',
    description: d.description || '',
    content: normalizeDoc(d.content),
  };
}

/**
 * @param objects The project's objects, already fetched in the target language.
 */
export function buildSimplifiedProjectObjects(objects: UnifiedObject[]): SimplifiedProjectObjects {
  if (objects.length === 0) {
    return EMPTY;
  }

  const basicInfoList = objects.filter((obj) => obj.type === 'basic_info');
  const storyEntities = objects
    .filter((obj): obj is StoryEntityObject => obj.type === 'story_entity')
    .sort((a, b) => (a.metadata.display_order ?? 0) - (b.metadata.display_order ?? 0));
  const outlineItems = objects.filter((obj): obj is OutlineObject => obj.type === 'outline');
  const outlines = outlineItems.filter((obj) => obj.kind === 'outline');
  const acts = outlineItems.filter((obj) => obj.kind === 'act');
  const chapters = outlineItems.filter((obj) => obj.kind === 'chapter');

  const basicInfo = basicInfoList.length > 0
    ? (() => {
        const data = normalizeBasicInfoData(dataOf(basicInfoList[0]));
        return {
          id: basicInfoList[0].id,
          title: data.title,
          logline: data.logline,
          genres: data.genres,
          tags: data.tags,
        };
      })()
    : null;

  const outline = {
    outlines: sortOutlineObjects(outlines).map((outlineObj) => {
      const d = dataOf(outlineObj);
      return {
        id: outlineObj.id,
        name: d.name || '',
        description: d.description || '',
        content: normalizeDoc(d.content),
        position: outlineObj.metadata.position || 0,
        acts: sortOutlineObjects(acts.filter((act) => act.metadata.parent_id === outlineObj.id)).map((act) => {
          const ad = dataOf(act);
          return {
            id: act.id,
            name: ad.name || '',
            description: ad.description || '',
            content: normalizeDoc(ad.content),
            position: act.metadata.position || 0,
            parentId: act.metadata.parent_id || '',
            chapters: sortOutlineObjects(chapters.filter((ch) => ch.metadata.parent_id === act.id)).map((chapter) => {
              const cd = dataOf(chapter);
              return {
                id: chapter.id,
                name: cd.name || '',
                description: cd.description || '',
                content: normalizeDoc(cd.content),
                position: chapter.metadata.position || 0,
                parentId: chapter.metadata.parent_id || '',
              };
            }),
          };
        }),
      };
    }),
  };

  return {
    basicInfo,
    storyEntities: storyEntities.map((entity) => ({ ...entityShape(entity), kind: entity.kind })),
    characters: storyEntities.filter((e) => e.kind === 'character').map(entityShape),
    organizations: storyEntities.filter((e) => e.kind === 'organization').map(entityShape),
    locations: storyEntities.filter((e) => e.kind === 'location').map(entityShape),
    lorebook: storyEntities.filter((e) => e.kind === 'lorebook').map(entityShape),
    outline,
  };
}
