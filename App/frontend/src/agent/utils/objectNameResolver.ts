import type { SimplifiedStoryObjects } from '../../store/unifiedObjectStore';

/** Generic act type for name resolution - only needs id, name, and chapters */
interface ActLike {
  id: string;
  name: string;
  chapters?: ChapterLike[];
}

/** Generic chapter type for name resolution - only needs id and name */
interface ChapterLike {
  id: string;
  name: string;
}

/**
 * Extracts all acts from SimplifiedStoryObjects.
 */
const getAllActs = (storyObjects: SimplifiedStoryObjects): ActLike[] => {
  const outline = storyObjects.outline;
  if (!outline) return [];
  return outline.outlines.flatMap((o) => o.acts || []);
};

/**
 * Parses a tool name like "update_character" into { action: "update", objectType: "character" }
 */
export const parseToolName = (
  toolName: string
): { action: string; objectType: string } | undefined => {
  if (!toolName) return undefined;

  // Handle patterns like: create_character, update_basic_info, delete_lorebook
  const patterns: Array<{ regex: RegExp; objectType: string }> = [
    { regex: /^(create|update|delete)_basic_info$/, objectType: 'basic_info' },
    { regex: /^(create|read|replace|patch|delete|translate)_story_entity$/, objectType: 'story_entity' },
    { regex: /^(create|update|delete)_act$/, objectType: 'act' },
    { regex: /^(create|update|delete)_chapter$/, objectType: 'chapter' },
    { regex: /^(update)_manuscript$/, objectType: 'manuscript' },
  ];

  for (const { regex, objectType } of patterns) {
    const match = toolName.match(regex);
    if (match) {
      return { action: match[1], objectType };
    }
  }

  return undefined;
};

/**
 * Resolves an object ID to its human-readable name using storyObjects.
 * Used to display friendly names instead of UUIDs in tool call previews.
 */
export const resolveStoryObjectName = (
  storyObjects: SimplifiedStoryObjects,
  type?: string,
  id?: string
): string | undefined => {
  if (!type || !id) return undefined;

  switch (type) {
    case 'basic_info':
      return storyObjects.basicInfo?.title || storyObjects.basicInfo?.logline;
    case 'story_entity':
      return storyObjects.storyEntities.find((item) => item.id === id)?.name;
    case 'act': {
      const acts = getAllActs(storyObjects);
      return findAct(acts, id)?.name;
    }
    case 'chapter': {
      const acts = getAllActs(storyObjects);
      const chapter = findChapter(acts, id);
      return chapter?.name;
    }
    case 'manuscript': {
      // Manuscripts are tied to chapters - resolve to chapter name
      const acts = getAllActs(storyObjects);
      const chapter = findChapter(acts, id);
      return chapter?.name ? `${chapter.name} (Manuscript)` : undefined;
    }
    default:
      return undefined;
  }
};

/**
 * Finds an act by ID from the acts array.
 */
const findAct = (acts: ActLike[] | undefined, id: string): ActLike | undefined =>
  acts?.find((act) => act.id === id);

/**
 * Finds a chapter by ID, searching through all acts.
 */
const findChapter = (acts: ActLike[] | undefined, id: string): ChapterLike | undefined => {
  if (!acts) return undefined;
  for (const act of acts) {
    const chapter = act.chapters?.find((entry: ChapterLike) => entry.id === id);
    if (chapter) {
      return chapter;
    }
  }
  return undefined;
};

/**
 * Field keys that typically contain object IDs that should be filtered from display.
 */
export const ID_FIELD_PATTERNS = [
  'id',
  'actId',
  'act_id',
  'chapterId',
  'chapter_id',
  'characterId',
  'character_id',
  'organizationId',
  'organization_id',
  'locationId',
  'location_id',
  'manuscriptId',
  'manuscript_id',
  'lorebookId',
  'lorebook_id',
];

/**
 * Checks if a field key is an ID field that should be filtered from display.
 */
export const isIdField = (key: string): boolean => {
  return ID_FIELD_PATTERNS.includes(key);
};
