export type PromptProjectStoryEntityKind =
  | 'character'
  | 'organization'
  | 'location'
  | 'lorebook';

export type PromptProjectOutlineKind = 'outline' | 'act' | 'chapter';

export interface PromptProjectBasicInfo {
  id: string;
  title: string;
  logline: string;
  genres: string[];
  tags: string[];
}

export interface PromptProjectStoryEntity {
  type: 'story_entity';
  kind: PromptProjectStoryEntityKind;
  id: string;
  name: string;
  description: string;
  content: string;
  folderId: string | null;
  folderPath: string[];
  displayOrder: number;
  imagePrompt?: string | null;
  imagePromptPositive?: string | null;
  imagePromptNegative?: string | null;
}

export type PromptStoryEntityTreeNode =
  | {
      nodeType: 'folder';
      id: string;
      name: string;
      description: string;
      children: PromptStoryEntityTreeNode[];
    }
  | {
      nodeType: 'story_entity';
      entity: PromptProjectStoryEntity;
    };

export interface PromptProjectOutlineNode {
  id: string;
  kind: PromptProjectOutlineKind;
  name: string;
  description: string;
  content: string;
  parentId: string | null;
  position: number;
  actNumber?: number | null;
  chapterNumber?: number | null;
  manuscriptId?: string | null;
}

export interface PromptProjectOutlineTreeNode extends PromptProjectOutlineNode {
  children: PromptProjectOutlineTreeNode[];
}

export interface PromptProjectOutline {
  nodes: PromptProjectOutlineNode[];
  tree: PromptProjectOutlineTreeNode[];
}

export interface PromptProjectManuscript {
  id: string;
  chapterId: string;
  chapterName: string;
  actNumber?: number | null;
  chapterNumber?: number | null;
  content: string;
  wordCount: number;
}

export interface PromptProjectGuidelines {
  id: string;
  authorNote: string;
}

export interface PromptProjectTimelineEvent {
  id: string;
  trackId: string;
  trackName: string;
  name: string;
  description: string;
  content: string;
  startDate: Record<string, number>;
  endDate: Record<string, number> | null;
  tags: string[];
  formattedDate: string;
}

export interface PromptProjectTimelineTrack {
  id: string;
  parentId: string | null;
  position: number;
  color: string | null;
  name: string;
  description: string;
  content: string;
  events: PromptProjectTimelineEvent[];
  children: PromptProjectTimelineTrack[];
}

export interface PromptProjectTimeline {
  id: string;
  projectId: string;
  calendar: {
    mode?: 'fixed' | 'gregorian';
    units: Array<{
      name: string;
      label?: string;
      count?: number;
    }>;
  };
  tracks: PromptProjectTimelineTrack[];
  events: PromptProjectTimelineEvent[];
}

export interface PromptProjectLanguageBucket {
  basicInfo: PromptProjectBasicInfo;
  guidelines: PromptProjectGuidelines;
  storyEntities: PromptProjectStoryEntity[];
  storyEntityTree: PromptStoryEntityTreeNode[];
  outline: PromptProjectOutline;
  manuscripts: PromptProjectManuscript[];
  timeline: PromptProjectTimeline;
}

export type PromptProjectContentByLanguage = Record<string, PromptProjectLanguageBucket>;

export interface PromptProjectData {
  basicInfo: PromptProjectBasicInfo;
  guidelines: PromptProjectGuidelines;
  storyEntities: PromptProjectStoryEntity[];
  storyEntityTree: PromptStoryEntityTreeNode[];
  outline: PromptProjectOutline;
  manuscripts: PromptProjectManuscript[];
  timeline: PromptProjectTimeline;
  contentByLang: PromptProjectContentByLanguage;
}

interface PromptProjectSkeletonIds {
  basicInfo: string;
  guidelines: string;
  storyEntity: string;
  outlineRoot: string;
  outlineAct: string;
  outlineChapter: string;
  manuscript: string;
  timelineTrack: string;
  timelineChildTrack: string;
  timelineEvent: string;
}

export interface BuildPromptProjectDataOptions {
  languages?: string[];
}

const DEFAULT_LANGUAGE = 'English';

const PLACEHOLDER_IDS: PromptProjectSkeletonIds = {
  basicInfo: '[ placeholder-basic-info-id ]',
  guidelines: '[ placeholder-guidelines-id ]',
  storyEntity: '[ placeholder-story-entity-id ]',
  outlineRoot: '[ placeholder-outline-id ]',
  outlineAct: '[ placeholder-act-id ]',
  outlineChapter: '[ placeholder-chapter-id ]',
  manuscript: '[ placeholder-manuscript-id ]',
  timelineTrack: '[ placeholder-timeline-track-id ]',
  timelineChildTrack: '[ placeholder-timeline-track-child-id ]',
  timelineEvent: '[ placeholder-timeline-event-id ]',
};

function normalizeLanguages(languages?: string[]): string[] {
  const values = Array.isArray(languages)
    ? languages.map((value) => value.trim()).filter((value) => value.length > 0)
    : [];

  return values.length > 0 ? Array.from(new Set(values)) : [DEFAULT_LANGUAGE];
}

function buildBasicInfo(ids: PromptProjectSkeletonIds): PromptProjectBasicInfo {
  return {
    id: ids.basicInfo,
    title: '[ Placeholder for project title ]',
    logline: '[ Placeholder for project logline ]',
    genres: ['[ Placeholder genre ]'],
    tags: ['[ Placeholder tag ]'],
  };
}

function buildGuidelines(ids: PromptProjectSkeletonIds): PromptProjectGuidelines {
  return {
    id: ids.guidelines,
    authorNote: '[ Placeholder for author note / guidelines ]',
  };
}

function buildStoryEntities(ids: PromptProjectSkeletonIds): PromptProjectStoryEntity[] {
  return [
    {
      type: 'story_entity',
      kind: 'character',
      id: '[ placeholder-story-entity-id-2 ]',
      name: '[ Placeholder for nested entity name ]',
      description: '[ Placeholder for nested entity description ]',
      content: '[ Placeholder for nested entity content ]',
      folderId: '[ placeholder-folder-main-cast-id ]',
      folderPath: ['Characters', 'Main Cast'],
      displayOrder: 0,
      imagePrompt: '[ Placeholder for nested saved natural language prompt ]',
      imagePromptPositive: '[ Placeholder for nested saved positive tags ]',
      imagePromptNegative: '[ Placeholder for nested saved negative tags ]',
    },
    {
      type: 'story_entity',
      kind: 'character',
      id: ids.storyEntity,
      name: '[ Placeholder for entity name ]',
      description: '[ Placeholder for entity description ]',
      content: '[ Placeholder for entity content ]',
      folderId: '[ placeholder-folder-characters-id ]',
      folderPath: ['Characters'],
      displayOrder: 1,
      imagePrompt: '[ Placeholder for saved natural language prompt ]',
      imagePromptPositive: '[ Placeholder for saved positive tags ]',
      imagePromptNegative: '[ Placeholder for saved negative tags ]',
    },
    {
      type: 'story_entity',
      kind: 'location',
      id: '[ placeholder-story-entity-id-3 ]',
      name: '[ Placeholder for root location name ]',
      description: '[ Placeholder for root location description ]',
      content: '[ Placeholder for root location content ]',
      folderId: null,
      folderPath: [],
      displayOrder: 1,
      imagePrompt: '[ Placeholder for root location natural language prompt ]',
      imagePromptPositive: '[ Placeholder for root location positive tags ]',
      imagePromptNegative: '[ Placeholder for root location negative tags ]',
    },
  ];
}

function buildStoryEntityTree(ids: PromptProjectSkeletonIds): PromptStoryEntityTreeNode[] {
  const storyEntities = buildStoryEntities(ids);
  const [nestedCharacter, rootCharacter, rootLocation] = storyEntities;

  return [
    {
      nodeType: 'folder',
      id: '[ placeholder-folder-characters-id ]',
      name: 'Characters',
      description: '[ Placeholder for folder description ]',
      children: [
        {
          nodeType: 'folder',
          id: '[ placeholder-folder-main-cast-id ]',
          name: 'Main Cast',
          description: '[ Placeholder for nested folder description ]',
          children: [
            {
              nodeType: 'story_entity',
              entity: nestedCharacter,
            },
          ],
        },
        {
          nodeType: 'story_entity',
          entity: rootCharacter,
        },
      ],
    },
    {
      nodeType: 'story_entity',
      entity: rootLocation,
    },
  ];
}

function buildOutline(ids: PromptProjectSkeletonIds): PromptProjectOutline {
  const rootOutline: PromptProjectOutlineTreeNode = {
    id: ids.outlineRoot,
    kind: 'outline',
    name: '[ Placeholder for outline name ]',
    description: '[ Placeholder for outline description ]',
    content: '[ Placeholder for outline content ]',
    parentId: null,
    position: 0,
    children: [
      {
        id: ids.outlineAct,
        kind: 'act',
        name: '[ Placeholder for act name ]',
        description: '[ Placeholder for act description ]',
        content: '[ Placeholder for act content ]',
        parentId: ids.outlineRoot,
        position: 0,
        actNumber: 1,
        children: [
          {
            id: ids.outlineChapter,
            kind: 'chapter',
            name: '[ Placeholder for chapter name ]',
            description: '[ Placeholder for chapter description ]',
            content: '[ Placeholder for chapter content ]',
            parentId: ids.outlineAct,
            position: 0,
            actNumber: 1,
            chapterNumber: 1,
            manuscriptId: ids.manuscript,
            children: [],
          },
        ],
      },
    ],
  };

  return {
    nodes: [
      {
        id: ids.outlineRoot,
        kind: 'outline',
        name: '[ Placeholder for outline name ]',
        description: '[ Placeholder for outline description ]',
        content: '[ Placeholder for outline content ]',
        parentId: null,
        position: 0,
      },
      {
        id: ids.outlineAct,
        kind: 'act',
        name: '[ Placeholder for act name ]',
        description: '[ Placeholder for act description ]',
        content: '[ Placeholder for act content ]',
        parentId: ids.outlineRoot,
        position: 0,
        actNumber: 1,
      },
      {
        id: ids.outlineChapter,
        kind: 'chapter',
        name: '[ Placeholder for chapter name ]',
        description: '[ Placeholder for chapter description ]',
        content: '[ Placeholder for chapter content ]',
        parentId: ids.outlineAct,
        position: 0,
        actNumber: 1,
        chapterNumber: 1,
        manuscriptId: ids.manuscript,
      },
    ],
    tree: [rootOutline],
  };
}

function buildManuscripts(ids: PromptProjectSkeletonIds): PromptProjectManuscript[] {
  return [
    {
      id: ids.manuscript,
      chapterId: ids.outlineChapter,
      chapterName: '[ Placeholder for chapter name ]',
      actNumber: 1,
      chapterNumber: 1,
      content: '[ Placeholder for manuscript content ]',
      wordCount: 0,
    },
  ];
}

function buildTimeline(ids: PromptProjectSkeletonIds): PromptProjectTimeline {
  const event: PromptProjectTimelineEvent = {
    id: ids.timelineEvent,
    trackId: ids.timelineChildTrack,
    trackName: '[ Placeholder for child timeline track name ]',
    name: '[ Placeholder for timeline event name ]',
    description: '[ Placeholder for timeline event description ]',
    content: '[ Placeholder for timeline event content ]',
    startDate: { year: 1, month: 1, day: 1, hour: 1, minute: 1 },
    endDate: null,
    tags: ['[ Placeholder timeline tag ]'],
    formattedDate: '[ Placeholder formatted timeline date ]',
  };

  const childTrack: PromptProjectTimelineTrack = {
    id: ids.timelineChildTrack,
    parentId: ids.timelineTrack,
    position: 0,
    color: null,
    name: '[ Placeholder for child timeline track name ]',
    description: '[ Placeholder for child timeline track description ]',
    content: '[ Placeholder for child timeline track content ]',
    events: [event],
    children: [],
  };

  return {
    id: '[ placeholder-timeline-id ]',
    projectId: '[ placeholder-project-id ]',
    calendar: {
      mode: 'gregorian',
      units: [
        { name: 'year', label: 'Year', count: 12 },
        { name: 'month', label: 'Month', count: 31 },
        { name: 'day', label: 'Day', count: 24 },
        { name: 'hour', label: 'Hour', count: 60 },
        { name: 'minute', label: 'Minute' },
      ],
    },
    tracks: [
      {
        id: ids.timelineTrack,
        parentId: null,
        position: 0,
        color: null,
        name: '[ Placeholder for timeline track name ]',
        description: '[ Placeholder for timeline track description ]',
        content: '[ Placeholder for timeline track content ]',
        events: [],
        children: [childTrack],
      },
    ],
    events: [event],
  };
}

function buildLanguageBucket(ids: PromptProjectSkeletonIds): PromptProjectLanguageBucket {
  const basicInfo = buildBasicInfo(ids);
  const guidelines = buildGuidelines(ids);
  const storyEntities = buildStoryEntities(ids);
  const storyEntityTree = buildStoryEntityTree(ids);
  const outline = buildOutline(ids);
  const manuscripts = buildManuscripts(ids);
  const timeline = buildTimeline(ids);

  return {
    basicInfo,
    guidelines,
    storyEntities,
    storyEntityTree,
    outline,
    manuscripts,
    timeline,
  };
}

export function buildPromptProjectDataSkeleton(
  options: BuildPromptProjectDataOptions = {},
): PromptProjectData {
  const ids = PLACEHOLDER_IDS;
  const languages = normalizeLanguages(options.languages);
  const primaryLanguage = languages[0];
  const primaryBucket = buildLanguageBucket(ids);
  const contentByLang: PromptProjectContentByLanguage = {
    [primaryLanguage]: primaryBucket,
  };

  for (const language of languages.slice(1)) {
    contentByLang[language] = buildLanguageBucket(ids);
  }

  return {
    basicInfo: primaryBucket.basicInfo,
    guidelines: primaryBucket.guidelines,
    storyEntities: primaryBucket.storyEntities,
    storyEntityTree: primaryBucket.storyEntityTree,
    outline: primaryBucket.outline,
    manuscripts: primaryBucket.manuscripts,
    timeline: primaryBucket.timeline,
    contentByLang,
  };
}
