export type PromptProjectStoryEntityKind =
  | 'character'
  | 'organization'
  | 'location'
  | 'lorebook';

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
      children: PromptStoryEntityTreeNode[];
    }
  | {
      nodeType: 'story_entity';
      entity: PromptProjectStoryEntity;
    };

export interface PromptProjectChapter {
  id: string;
  name: string;
  description: string;
  content: string;
  order: number;
  actId: string;
  manuscriptId: string;
}

export interface PromptProjectAct {
  id: string;
  name: string;
  description: string;
  content: string;
  order: number;
  outlineId: string;
  chapters: PromptProjectChapter[];
}

export interface PromptProjectOutlineItem {
  id: string;
  name: string;
  description: string;
  content: string;
  order: number;
  acts: PromptProjectAct[];
}

export interface PromptProjectOutline {
  outlines: PromptProjectOutlineItem[];
}

export interface PromptProjectManuscript {
  id: string;
  chapterId: string;
  chapterName: string;
  content: string;
  wordCount: number;
}

export interface PromptProjectGuidelines {
  id: string;
  authorNote: string;
}

export interface PromptProjectLanguageBucket {
  basicInfo: PromptProjectBasicInfo;
  guidelines: PromptProjectGuidelines;
  storyEntities: PromptProjectStoryEntity[];
  storyEntityTree: PromptStoryEntityTreeNode[];
  outline: PromptProjectOutline;
  manuscripts: PromptProjectManuscript[];
}

export type PromptProjectContentByLanguage = Record<string, PromptProjectLanguageBucket>;

export interface PromptProjectData {
  basicInfo: PromptProjectBasicInfo;
  guidelines: PromptProjectGuidelines;
  storyEntities: PromptProjectStoryEntity[];
  storyEntityTree: PromptStoryEntityTreeNode[];
  outline: PromptProjectOutline;
  manuscripts: PromptProjectManuscript[];
  contentByLang: PromptProjectContentByLanguage;
}

interface PromptProjectSkeletonIds {
  basicInfo: string;
  guidelines: string;
  storyEntity: string;
  outline: string;
  act: string;
  chapter: string;
  manuscript: string;
}

export interface BuildPromptProjectDataOptions {
  languages?: string[];
}

const DEFAULT_LANGUAGE = 'English';

const PLACEHOLDER_IDS: PromptProjectSkeletonIds = {
  basicInfo: '[ placeholder-basic-info-id ]',
  guidelines: '[ placeholder-guidelines-id ]',
  storyEntity: '[ placeholder-story-entity-id ]',
  outline: '[ placeholder-outline-id ]',
  act: '[ placeholder-act-id ]',
  chapter: '[ placeholder-chapter-id ]',
  manuscript: '[ placeholder-manuscript-id ]',
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
      children: [
        {
          nodeType: 'folder',
          id: '[ placeholder-folder-main-cast-id ]',
          name: 'Main Cast',
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
  return {
    outlines: [
      {
        id: ids.outline,
        name: '[ Placeholder for outline name ]',
        description: '[ Placeholder for outline description ]',
        content: '[ Placeholder for outline content ]',
        order: 0,
        acts: [
          {
            id: ids.act,
            name: '[ Placeholder for act name ]',
            description: '[ Placeholder for act description ]',
            content: '[ Placeholder for act content ]',
            order: 0,
            outlineId: ids.outline,
            chapters: [
              {
                id: ids.chapter,
                name: '[ Placeholder for chapter name ]',
                description: '[ Placeholder for chapter description ]',
                content: '[ Placeholder for chapter content ]',
                order: 0,
                actId: ids.act,
                manuscriptId: ids.manuscript,
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildManuscripts(ids: PromptProjectSkeletonIds): PromptProjectManuscript[] {
  return [
    {
      id: ids.manuscript,
      chapterId: ids.chapter,
      chapterName: '[ Placeholder for chapter name ]',
      content: '[ Placeholder for manuscript content ]',
      wordCount: 0,
    },
  ];
}

function buildLanguageBucket(ids: PromptProjectSkeletonIds): PromptProjectLanguageBucket {
  const basicInfo = buildBasicInfo(ids);
  const guidelines = buildGuidelines(ids);
  const storyEntities = buildStoryEntities(ids);
  const storyEntityTree = buildStoryEntityTree(ids);
  const outline = buildOutline(ids);
  const manuscripts = buildManuscripts(ids);

  return {
    basicInfo,
    guidelines,
    storyEntities,
    storyEntityTree,
    outline,
    manuscripts,
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
    contentByLang,
  };
}
