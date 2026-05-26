/**
 * Preview Data Builder for Prompt Preview feature.
 * Builds TemplateData for rendering prompt previews with configurable context modes.
 */

import { useSettingsStore } from '../../../store/settingsStore';
import { useDisplayLanguageStore } from '../../../store/displayLanguageStore';
import { useProjectStore } from '../../../store/projectStore';
import { useVariableStore } from '../../../store/variableStore';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { type PromptType, type ConfigData, type VariablesData } from '../../../templateEngine/schema';
import { buildPromptProjectDataSkeleton, type PromptProjectData } from '../../../templateEngine/projectShape';
import type { TaskType } from '../../../types/scenarios';
import { setNestedValue } from './promptTypeFields';

type TemplateData = any;

export interface PreviewDataOptions {
  taskType: TaskType;
  taskSubtype: string;
  injectedInputKey?: 'userMessage' | 'agentMessage' | 'subAgentMessage' | null;
  showProjectContext: boolean;
  includeAllFilteredIds: boolean;
  projectId: string | null;
  configOverrides?: Partial<ConfigData>;
  promptTypeOverrides?: Record<string, any>;
  variableOverrides?: Record<string, any>;
}

interface FilteredIds {
  contextObjectIds: string[];
  objectIds: string[];
  targetIds: string[];
  contextIds: string[];
  selectedEntityIds: string[];
}

const PREVIEW_BASIC_INFO = {
  id: '[ placeholder-basic-info-id ]',
  title: '[ Placeholder for project title ]',
  logline: '[ Placeholder for project logline ]',
  genres: ['[ Placeholder genre ]'],
  tags: ['[ Placeholder tag ]'],
};

const PREVIEW_GUIDELINES = {
  id: '[ placeholder-guidelines-id ]',
  authorNote: '[ Placeholder for author note / guidelines ]',
};

const PREVIEW_STORY_ENTITY = {
  id: '[ placeholder-story-entity-id ]',
  type: 'story_entity' as const,
  kind: 'character' as const,
  name: '[ Placeholder for entity name ]',
  description: '[ Placeholder for entity description ]',
  content: '[ Placeholder for entity content ]',
  folderId: '[ placeholder-folder-characters-id ]',
  folderPath: ['Characters'],
  displayOrder: 1,
  imagePrompt: '[ Placeholder for saved natural language prompt ]',
  imagePromptPositive: '[ Placeholder for saved positive tags ]',
  imagePromptNegative: '[ Placeholder for saved negative tags ]',
};

const PREVIEW_OUTLINE = {
  id: '[ placeholder-outline-id ]',
  kind: 'outline' as const,
  name: '[ Placeholder for outline name ]',
  description: '[ Placeholder for outline description ]',
  content: '[ Placeholder for outline content ]',
  parentId: null,
  position: 0,
};

const PREVIEW_ACT = {
  id: '[ placeholder-act-id ]',
  kind: 'act' as const,
  name: '[ Placeholder for act name ]',
  description: '[ Placeholder for act description ]',
  content: '[ Placeholder for act content ]',
  parentId: '[ placeholder-outline-id ]',
  position: 0,
  actNumber: 1,
};

const PREVIEW_CHAPTER = {
  id: '[ placeholder-chapter-id ]',
  kind: 'chapter' as const,
  name: '[ Placeholder for chapter name ]',
  description: '[ Placeholder for chapter description ]',
  content: '[ Placeholder for chapter content ]',
  parentId: '[ placeholder-act-id ]',
  position: 0,
  actNumber: 1,
  chapterNumber: 1,
  manuscriptId: '[ placeholder-manuscript-id ]',
};

const PREVIEW_ROOT_LOCATION_ID = '[ placeholder-story-entity-id-3 ]';
const PREVIEW_NESTED_ENTITY_ID = '[ placeholder-story-entity-id-2 ]';
const PREVIEW_MANUSCRIPT_ID = '[ placeholder-manuscript-id ]';

const PREVIEW_ALL_OBJECT_IDS = [
  PREVIEW_BASIC_INFO.id,
  PREVIEW_GUIDELINES.id,
  PREVIEW_NESTED_ENTITY_ID,
  PREVIEW_STORY_ENTITY.id,
  PREVIEW_ROOT_LOCATION_ID,
  PREVIEW_OUTLINE.id,
  PREVIEW_ACT.id,
  PREVIEW_CHAPTER.id,
  PREVIEW_MANUSCRIPT_ID,
];

const PREVIEW_CONTEXT_IDS = [
  PREVIEW_NESTED_ENTITY_ID,
  PREVIEW_CHAPTER.id,
  PREVIEW_MANUSCRIPT_ID,
];

/**
 * Map taskType and taskSubtype to the PromptType used in schema validation.
 */
export function getPromptTypeFromTask(taskType: TaskType, taskSubtype: string): PromptType {
  switch (taskType) {
    case 'agent':
      return 'agent';
    case 'subAgent':
      return 'subAgent';
    case 'memory':
      return 'memory';
    case 'editAssistant':
      return 'editAssistant';
    case 'translation':
      return 'translation';
    case 'imagePrompt':
      if (taskSubtype === 'scene') return 'sceneImagePrompt';
      return 'objectImagePrompt';
    default:
      return 'agent';
  }
}

/**
 * Build shape-complete placeholder project data that mirrors runtime keys.
 * Preview stays local and placeholder-based even when project context is enabled.
 */
export function buildMinimalProjectData(languages: string[] = []): PromptProjectData {
  return buildPromptProjectDataSkeleton({ languages });
}

/**
 * Get all object IDs from the project for filtered ID arrays.
 */
function getAllProjectObjectIds(projectId: string): string[] {
  try {
    const store = useUnifiedObjectStore.getState();
    const allObjects = Object.values(store.objects);
    return allObjects
      .filter(obj => obj.metadata.project_id === projectId)
      .map(obj => obj.id);
  } catch {
    return [];
  }
}

function getAllProjectStoryEntityIds(projectId: string): string[] {
  try {
    const store = useUnifiedObjectStore.getState();
    const allObjects = Object.values(store.objects);
    return allObjects
      .filter(obj => obj.metadata.project_id === projectId && obj.type === 'story_entity')
      .map(obj => obj.id);
  } catch {
    return [];
  }
}

/**
 * Build filtered ID arrays based on toggle state.
 */
function buildFilteredIds(
  projectId: string | null,
  includeAllFilteredIds: boolean
): FilteredIds {
  if (!includeAllFilteredIds || !projectId) {
    if (includeAllFilteredIds) {
      return {
        contextObjectIds: PREVIEW_CONTEXT_IDS,
        objectIds: PREVIEW_ALL_OBJECT_IDS,
        targetIds: PREVIEW_ALL_OBJECT_IDS,
        contextIds: PREVIEW_CONTEXT_IDS,
        selectedEntityIds: [PREVIEW_NESTED_ENTITY_ID],
      };
    }
    return {
      contextObjectIds: [],
      objectIds: [],
      targetIds: [],
      contextIds: [],
      selectedEntityIds: [],
    };
  }

  const allIds = getAllProjectObjectIds(projectId);
  const allStoryEntityIds = getAllProjectStoryEntityIds(projectId);
  const effectiveAllIds = allIds.length > 0 ? allIds : PREVIEW_ALL_OBJECT_IDS;
  const effectiveStoryEntityIds = allStoryEntityIds.length > 0 ? allStoryEntityIds : [PREVIEW_NESTED_ENTITY_ID];
  return {
    contextObjectIds: effectiveAllIds,
    objectIds: effectiveAllIds,
    targetIds: effectiveAllIds,
    contextIds: effectiveAllIds,
    selectedEntityIds: effectiveStoryEntityIds,
  };
}

/**
 * Build mode-specific data from schema examples with overrides.
 * Returns the appropriate mode data based on taskType.
 */
export function buildModeSpecificData(
  taskType: TaskType,
  taskSubtype: string,
  filteredIds: FilteredIds,
  promptTypeOverrides?: Record<string, any>
): Partial<Pick<TemplateData, 'agent' | 'memorySummary' | 'editAssistant' | 'translation' | 'imagePrompt' | 'memory'>> {
  let modeData: Partial<Pick<TemplateData, 'agent' | 'memorySummary' | 'editAssistant' | 'translation' | 'imagePrompt' | 'memory'>> = {};
  const projectDataTarget = String(promptTypeOverrides?._preview?.editAssistant?.projectDataTarget || promptTypeOverrides?.['_preview.editAssistant.projectDataTarget'] || 'storyEntity');
  const imagePromptTarget = String(promptTypeOverrides?._preview?.imagePrompt?.currentTargetType || promptTypeOverrides?.['_preview.imagePrompt.currentTargetType'] || 'storyEntity');

  switch (taskType) {
    case 'agent':
    case 'subAgent':
      modeData = {
        agent: {
          runMode: taskSubtype === 'planMode' ? 'planMode' : 'agentMode',
          surface: 'story-entity',
          contextObjectIds: filteredIds.contextObjectIds,
        },
      };
      break;

    case 'memory':
      modeData = {
        memorySummary: {
          previousSummary: '[ Placeholder for previous summary ]',
          messages: [{
            role: 'user',
            content: '[ Placeholder for archived message content ]',
            messageId: '[ placeholder-message-id ]',
            createdAt: new Date().toISOString(),
          }],
          language: '[ Placeholder language ]',
          archiveUntilMessageId: '[ placeholder-archive-boundary-id ]',
        },
      };
      break;

    case 'editAssistant':
      if (taskSubtype === 'manuscript') {
        modeData = {
          editAssistant: {
            projectData: {
              contextIds: [],
              editScope: 'selected',
              basicInfo: null,
              guidelines: null,
              storyEntity: null,
            },
            manuscript: {
              currentId: '[ placeholder-manuscript-id ]',
              currentChapterId: '[ placeholder-chapter-id ]',
              currentChapterName: '[ Placeholder for chapter name ]',
              currentChapterManuscript: '[ Placeholder for current chapter manuscript content ]',
              contextIds: filteredIds.contextIds,
            },
            outline: {
              contextIds: [],
              editScope: 'selected',
              items: [],
            },
          },
        };
      } else if (taskSubtype === 'outline') {
        modeData = {
          editAssistant: {
            projectData: {
              contextIds: [],
              editScope: 'selected',
              basicInfo: null,
              guidelines: null,
              storyEntity: null,
            },
            manuscript: {
              currentId: '',
              currentChapterId: '',
              currentChapterName: '',
              currentChapterManuscript: '',
              contextIds: [],
            },
            outline: {
              contextIds: filteredIds.contextIds,
              editScope: 'selected',
              items: [PREVIEW_CHAPTER],
            },
          },
        };
      } else {
        const basicInfo = projectDataTarget === 'basicInfo' ? PREVIEW_BASIC_INFO : null;
        const guidelines = projectDataTarget === 'guidelines' ? PREVIEW_GUIDELINES : null;
        const storyEntity = projectDataTarget === 'storyEntity' ? PREVIEW_STORY_ENTITY : null;
        modeData = {
          editAssistant: {
            manuscript: {
              currentId: '',
              currentChapterId: '',
              currentChapterName: '',
              currentChapterManuscript: '',
              contextIds: [],
            },
            projectData: {
              contextIds: filteredIds.contextIds,
              editScope: 'selected',
              basicInfo,
              guidelines,
              storyEntity,
            },
            outline: {
              contextIds: [],
              editScope: 'selected',
              items: [],
            },
          },
        };
      }
      break;

    case 'translation':
      modeData = {
        translation: {
          sourceLanguage: '[ Placeholder for source language ]',
          targetLanguage: '[ Placeholder for target language ]',
          objectIds: filteredIds.objectIds,
          contextObjectIds: filteredIds.contextObjectIds,
          currentTranslatedContents: [{
            id: '[ placeholder-obj-id ]',
            type: 'story_entity',
            kind: 'character',
            name: '[ Placeholder for object name ]',
            translatedContent: '[ Placeholder for existing translation ]',
          }],
          messages: [{
            id: '[ placeholder-msg-id ]',
            content: '[ Placeholder for message content ]',
          }],
        },
      };
      break;

    case 'imagePrompt':
      modeData = {
        imagePrompt: {
          promptMode: 'natural',
          currentTarget: {
            basicInfo: imagePromptTarget === 'basicInfo'
              ? {
                  id: PREVIEW_BASIC_INFO.id,
                  title: PREVIEW_BASIC_INFO.title,
                  logline: PREVIEW_BASIC_INFO.logline,
                  image_prompt: '[ Placeholder for saved natural language prompt ]',
                  image_prompt_positive: '[ Placeholder for saved positive tags ]',
                  image_prompt_negative: '[ Placeholder for saved negative tags ]',
                }
              : null,
            storyEntity: imagePromptTarget === 'storyEntity'
              ? {
                  id: PREVIEW_STORY_ENTITY.id,
                  kind: PREVIEW_STORY_ENTITY.kind,
                  name: PREVIEW_STORY_ENTITY.name,
                  description: PREVIEW_STORY_ENTITY.description,
                  content: PREVIEW_STORY_ENTITY.content,
                  image_prompt: PREVIEW_STORY_ENTITY.imagePrompt,
                  image_prompt_positive: PREVIEW_STORY_ENTITY.imagePromptPositive,
                  image_prompt_negative: PREVIEW_STORY_ENTITY.imagePromptNegative,
                }
              : null,
          },
          sceneChapter: {
            manuscriptId: '[ placeholder-manuscript-id ]',
            chapterId: '[ placeholder-chapter-id ]',
            chapterName: '[ Placeholder for chapter title ]',
            actNumber: 1,
            chapterNumber: 1,
          },
          scenePreContext: '[ Placeholder for scene pre-context ]',
          scenePostContext: '[ Placeholder for scene post-context ]',
          selectedEntityIds: filteredIds.selectedEntityIds,
        },
      };
      break;
  }

  // Apply prompt type overrides
  if (promptTypeOverrides) {
    for (const [path, value] of Object.entries(promptTypeOverrides)) {
      if (path.startsWith('_preview.')) {
        continue;
      }
      if (value !== undefined && value !== '') {
        modeData = setNestedValue(modeData, path, value);
      }
    }
  }

  return modeData;
}

/**
 * Build config data aligned with the backend ScenarioManager.build_template_data().
 */
function buildConfigData(overrides?: Partial<ConfigData>): ConfigData {
  const store = useSettingsStore.getState();
  const settings = store.getSettings();
  const preferredDisplayLanguage = useDisplayLanguageStore.getState().preferredDisplayLanguage;
  const allowedDisplayLanguages = new Set([settings.mainLanguage, ...settings.subLanguages].filter(Boolean));
  const displayLanguage =
    preferredDisplayLanguage && allowedDisplayLanguages.has(preferredDisplayLanguage)
      ? preferredDisplayLanguage
      : settings.mainLanguage || 'English';

  const baseConfig: ConfigData = {
    mainLanguage: settings.mainLanguage || 'English',
    displayLanguage,
    today: new Date().toISOString().split('T')[0],
    thinking_mode: 'off',
    outputMode: 'tool_call',
  };

  return { ...baseConfig, ...overrides };
}

/**
 * Build complete preview data for template rendering.
 */
export function buildPreviewData(options: PreviewDataOptions): TemplateData {
  const {
    taskType,
    taskSubtype,
    injectedInputKey,
    showProjectContext,
    includeAllFilteredIds,
    projectId,
    configOverrides,
    promptTypeOverrides,
    variableOverrides,
  } = options;

  // Build config data with overrides
  const config = buildConfigData(configOverrides);

  // Build project data based on context mode
  const projectLanguages = showProjectContext && projectId
    ? [config.mainLanguage, config.displayLanguage]
    : [config.mainLanguage];
  const project = buildMinimalProjectData(projectLanguages);

  // Build input data with placeholders (match runtime injection model)
  const input: Record<string, any> = {
    userMessage: '',
    agentMessage: '',
    subAgentMessage: '',
    toolResults: [],
  };
  if (injectedInputKey === 'userMessage') {
    input.userMessage = '[ Placeholder for user message ]';
  } else if (injectedInputKey === 'agentMessage') {
    input.agentMessage = '[ Placeholder for agent message ]';
  } else if (injectedInputKey === 'subAgentMessage') {
    input.subAgentMessage = '[ Placeholder for sub agent message ]';
  }

  // Build variables from store with overrides
  const storeVariables = useVariableStore.getState().getVariablesForTemplate();
  const variables: VariablesData = { ...storeVariables, ...variableOverrides };

  // Build filtered IDs
  const filteredIds = buildFilteredIds(projectId, includeAllFilteredIds);

  // Build mode-specific data with filtered IDs and prompt type overrides
  const modeData = buildModeSpecificData(taskType, taskSubtype, filteredIds, promptTypeOverrides);

  // Build complete template data
  const templateData: TemplateData = {
    config,
    project,
    input,
    agent: {
      runMode: taskSubtype === 'planMode' ? 'planMode' : 'agentMode',
      surface: 'story-entity',
      contextObjectIds: filteredIds.contextObjectIds,
    },
    journey: {
      kind: '',
      payload: {},
      targetIds: filteredIds.targetIds,
    },
    memory: {
      summaries: [],
      historyChats: [],
    },
    memorySummary: {
      previousSummary: '[ Placeholder for previous summary ]',
      messages: [{
        role: 'user',
        content: '[ Placeholder for archived message content ]',
        messageId: '[ placeholder-message-id ]',
        createdAt: new Date().toISOString(),
      }],
      language: '[ Placeholder language ]',
      archiveUntilMessageId: '[ placeholder-archive-boundary-id ]',
    },
    variables,
    ...modeData,
  };

  if ((taskType === 'agent' || taskType === 'subAgent') && templateData.memory) {
    templateData.memory.summaries = [
      [
        '- Project: [Placeholder Project]',
        '- Characters: [Placeholder]',
        '- Current arc: [Placeholder]',
      ].join('\n'),
    ];
    templateData.memory.historyChats = [
      {
        messageId: '[placeholder-message-id-1]',
        role: 'user',
        matchedSnippet: 'We decided the protagonist is afraid of water after the incident at the river.',
        match: { kind: 'content', fieldPath: 'content', chunkIndex: 0 },
      },
      {
        messageId: '[placeholder-message-id-2]',
        role: 'assistant',
        matchedSnippet: 'Drafted a scene outline for Act 2, Chapter 3 with rising tension and a reveal.',
        match: { kind: 'content', fieldPath: 'content', chunkIndex: 1 },
      },
      {
        messageId: '[placeholder-message-id-3]',
        role: 'assistant',
        matchedSnippet: 'Tool call: create_story_entity(kind="character", name="Ari")',
        match: { kind: 'tool_call', fieldPath: 'tool_calls/index/0/result', chunkIndex: 2 },
        toolCall: {
          name: 'create_story_entity',
          status: 'accepted',
          result: 'Applied successfully',
        },
      },
    ];
  }

  return templateData;
}

/**
 * Get current project ID from store.
 */
export function getCurrentProjectId(): string | null {
  return useProjectStore.getState().currentProjectId;
}

/**
 * Get all user-defined variables for the override controls.
 */
export function getUserVariables(): Array<{
  id: string;
  name: string;
  value: string | number | boolean | null;
  type: 'string' | 'number' | 'boolean' | 'select';
  options?: string[];
}> {
  const store = useVariableStore.getState();
  return store.variables.map(v => ({
    id: v.id,
    name: v.name,
    value: v.value,
    type: v.var_type as 'string' | 'number' | 'boolean' | 'select',
    options: v.select_options ?? undefined,
  }));
}
