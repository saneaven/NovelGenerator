export type PromptProjectObjectType =
  | 'basic_info'
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

export interface PromptProjectObject {
  type: PromptProjectObjectType;
  id: string;
  name: string;
  description: string;
  content: string;
  imagePrompt?: string | null;
  imagePromptPositive?: string | null;
  imagePromptNegative?: string | null;
}

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
  objects: PromptProjectObject[];
  outline: PromptProjectOutline;
  manuscripts: PromptProjectManuscript[];
}

export type PromptProjectContentByLanguage = Record<string, PromptProjectLanguageBucket>;

export interface PromptProjectData {
  basicInfo: PromptProjectBasicInfo;
  objects: PromptProjectObject[];
  outline: PromptProjectOutline;
  manuscripts: PromptProjectManuscript[];
  guidelines: PromptProjectGuidelines;
  contentByLang: PromptProjectContentByLanguage;
}

interface PromptProjectSkeletonIds {
  basicInfo: string;
  guidelines: string;
  character: string;
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
  character: '[ placeholder-character-id ]',
  outline: '[ placeholder-outline-id ]',
  act: '[ placeholder-act-id ]',
  chapter: '[ placeholder-chapter-id ]',
  manuscript: '[ placeholder-manuscript-id ]',
};

function normalizeLanguages(languages?: string[]): string[] {
  const values = Array.isArray(languages)
    ? languages
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
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

function buildObjects(
  ids: PromptProjectSkeletonIds,
  basicInfo: PromptProjectBasicInfo,
): PromptProjectObject[] {
  return [
    {
      type: 'basic_info',
      id: ids.basicInfo,
      name: basicInfo.title,
      description: basicInfo.logline,
      content: '[ Placeholder for basic info summary ]',
      imagePrompt: null,
      imagePromptPositive: null,
      imagePromptNegative: null,
    },
    {
      type: 'character',
      id: ids.character,
      name: '[ Placeholder for character name ]',
      description: '[ Placeholder for character description ]',
      content: '[ Placeholder for character content ]',
      imagePrompt: '[ Placeholder for saved natural language prompt ]',
      imagePromptPositive: '[ Placeholder for saved positive tags ]',
      imagePromptNegative: '[ Placeholder for saved negative tags ]',
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

function buildGuidelines(ids: PromptProjectSkeletonIds): PromptProjectGuidelines {
  return {
    id: ids.guidelines,
    authorNote: '[ Placeholder for author note / guidelines ]',
  };
}

function buildLanguageBucket(
  ids: PromptProjectSkeletonIds,
): PromptProjectLanguageBucket {
  const basicInfo = buildBasicInfo(ids);

  return {
    basicInfo,
    objects: buildObjects(ids, basicInfo),
    outline: buildOutline(ids),
    manuscripts: buildManuscripts(ids),
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
    objects: primaryBucket.objects,
    outline: primaryBucket.outline,
    manuscripts: primaryBucket.manuscripts,
    guidelines: buildGuidelines(ids),
    contentByLang,
  };
}
