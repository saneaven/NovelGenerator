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
  isMemoryPrompt?: boolean;
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
  selectedObjectIds: string[];
}

/**
 * Map taskType and taskSubtype to the PromptType used in schema validation.
 */
export function getPromptTypeFromTask(taskType: TaskType, taskSubtype: string): PromptType {
  switch (taskType) {
    case 'agent':
      return 'agent';
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

/**
 * Build filtered ID arrays based on toggle state.
 */
function buildFilteredIds(
  projectId: string | null,
  includeAllFilteredIds: boolean
): FilteredIds {
  if (!includeAllFilteredIds || !projectId) {
    return {
      contextObjectIds: [],
      objectIds: [],
      targetIds: [],
      contextIds: [],
      selectedObjectIds: [],
    };
  }

  const allIds = getAllProjectObjectIds(projectId);
  return {
    contextObjectIds: allIds,
    objectIds: allIds,
    targetIds: allIds,
    contextIds: allIds,
    selectedObjectIds: allIds,
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

  switch (taskType) {
    case 'agent':
      modeData = {
        agent: {
          runMode: taskSubtype === 'planMode' ? 'planMode' : 'agentMode',
          surface: 'story-object',
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
            mode: 'manuscript',
            manuscript: {
              currentId: '[ placeholder-manuscript-id ]',
              currentChapterId: '[ placeholder-chapter-id ]',
              currentChapterName: '[ Placeholder for chapter name ]',
              currentChapterManuscript: '[ Placeholder for current chapter manuscript content ]',
              objectIds: filteredIds.objectIds,
            },
          },
        };
      } else {
        modeData = {
          editAssistant: {
            mode: 'storyObject',
            storyObject: {
              targetIds: filteredIds.targetIds,
              contextIds: filteredIds.contextIds,
              categoryName: '[ Placeholder for category name ]',
              editScope: 'selected',
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
            type: 'character',
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
          currentObject: {
            type: 'character',
            name: '[ Placeholder for current object name ]',
            description: '[ Placeholder for current object description ]',
            content: '[ Placeholder for current object content ]',
            image_prompt: '[ Placeholder for saved natural language prompt ]',
            image_prompt_positive: '[ Placeholder for saved positive tags ]',
            image_prompt_negative: '[ Placeholder for saved negative tags ]',
          },
          scenePreContext: '[ Placeholder for scene pre-context ]',
          scenePostContext: '[ Placeholder for scene post-context ]',
          selectedObjectIds: filteredIds.selectedObjectIds,
        },
      };
      break;
  }

  // Apply prompt type overrides
  if (promptTypeOverrides) {
    for (const [path, value] of Object.entries(promptTypeOverrides)) {
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
    isMemoryPrompt,
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
      surface: 'story-object',
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

  // Provide richer agent-memory preview data for Memory Prompt templates
  if (taskType === 'agent' && isMemoryPrompt && templateData.memory) {
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
        matchedSnippet: 'Tool call: create_character(name="Ari", role="antagonist")',
        match: { kind: 'tool_call', fieldPath: 'tool_calls/index/0/result', chunkIndex: 2 },
        toolCall: {
          name: 'create_character',
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
