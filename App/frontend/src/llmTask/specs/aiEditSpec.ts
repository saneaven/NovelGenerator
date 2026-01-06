import type { TaskSpec } from './types';
import type { ObjectType } from '../../types/unifiedObject';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSettingsStore } from '../../store/settingsStore';
import { LLMTask, LLMTaskMode, type LLMTaskModeType, type EditAssistantManuscriptPromptContext, type EditAssistantStoryObjectPromptContext } from '../../llm';
import type { LLMTaskResult } from '../../llm/types';
import { convertNativeOutputToFunctionCalls } from '../../functionCall';
import { stageSessionEdits } from '../functionCalls/functionCallEngine';

export type AiEditCategory = ObjectType | 'manuscript';

export interface AiEditTaskInput {
  projectId: string;
  category: AiEditCategory;
  targetId?: string;
  userRequest: string;
  selectedContextIds: string[];
}

const CATEGORY_LABELS: Record<string, string> = {
  basic_info: 'Basic Info',
  character: 'Character',
  organization: 'Organization',
  location: 'Location',
  lorebook: 'Lorebook',
  outline: 'Outline',
  act: 'Act',
  chapter: 'Chapter',
  manuscript: 'Manuscript',
};

export const aiEditSpec: TaskSpec<'aiEdit', AiEditTaskInput, void> = {
  kind: 'aiEdit',
  label: (input) => {
    const categoryLabel = CATEGORY_LABELS[input.category] ?? input.category;
    if (!input.targetId) {
      return `AI Edit: ${categoryLabel}`;
    }

    const store = useUnifiedObjectStore.getState();
    const mainLanguage = useSettingsStore.getState().settings.mainLanguage;
    if (input.category === 'manuscript') {
      const chapter = store.getObject(input.targetId);
      const langData = chapter?.data?.[mainLanguage] || (chapter?.data ? Object.values(chapter.data)[0] : undefined);
      const chapterName = (langData as any)?.name ?? '';
      return chapterName ? `AI Edit: ${categoryLabel} - ${chapterName}` : `AI Edit: ${categoryLabel}`;
    }

    const obj = store.getObject(input.targetId);
    const name = (obj?.data ? (obj.data as any)[mainLanguage] : undefined)?.name
      ?? (obj?.data ? (obj.data as any)[mainLanguage] : undefined)?.title
      ?? (obj?.data ? Object.values(obj.data)[0] as any : undefined)?.name
      ?? (obj?.data ? Object.values(obj.data)[0] as any : undefined)?.title
      ?? '';

    return name ? `AI Edit: ${categoryLabel} - ${name}` : `AI Edit: ${categoryLabel}`;
  },
  run: async ({ sessionId, input, abortController, updateSession }) => {
    const unifiedStore = useUnifiedObjectStore.getState();
    const settingsStore = useSettingsStore.getState();

    const editAssistantConfig = settingsStore.getFunctionConfig('editAssistant');
    const providerConfig = settingsStore.getProviderConfig(editAssistantConfig.provider);
    const isNativeOutput = settingsStore.settings.nativeOutputMode;
    const mainLanguage = settingsStore.settings.mainLanguage;

    const isManuscriptMode = input.category === 'manuscript';

    const contextIds = input.selectedContextIds.filter((id) => {
      if (!id) return false;
      if (!input.targetId) return true;

      if (isManuscriptMode) {
        const manuscriptObj = unifiedStore.getManuscriptByChapterId(input.targetId);
        return manuscriptObj ? id !== manuscriptObj.id : true;
      }

      return id !== input.targetId;
    });

    let llmMode: LLMTaskModeType = LLMTaskMode.EDIT_ASSISTANT_STORY_OBJECT;
    let promptContext: EditAssistantStoryObjectPromptContext | EditAssistantManuscriptPromptContext;

    if (isManuscriptMode) {
      if (!input.targetId) {
        updateSession({ status: 'error', error: 'Manuscript edit requires a target chapter ID.' });
        return;
      }

      const manuscriptObj = unifiedStore.getManuscriptByChapterId(input.targetId);
      if (!manuscriptObj) {
        updateSession({ status: 'error', error: `Manuscript not found for chapter ${input.targetId}` });
        return;
      }

      const chapter = unifiedStore.getObject(input.targetId);
      const chapterData = chapter?.data?.[mainLanguage] || (chapter?.data ? Object.values(chapter.data)[0] : undefined);
      const chapterName = (chapterData as any)?.name ?? '';

      const manuscriptData = manuscriptObj.data[mainLanguage] || Object.values(manuscriptObj.data)[0] || {};
      const currentContent = (manuscriptData as any)?.content ?? '';

      promptContext = {
        userInput: input.userRequest.trim(),
        projectId: input.projectId,
        currentId: manuscriptObj.id,
        currentChapterId: input.targetId,
        currentChapterName: chapterName,
        currentChapterContent: currentContent,
        objectIds: contextIds.length > 0 ? contextIds : undefined,
        isNativeOutput,
        outputLanguage: mainLanguage,
        enablePrefill: editAssistantConfig.advanced.enablePrefill,
        enableThinking: editAssistantConfig.advanced.thinkingMode === 'model',
        enableCustomThinking: editAssistantConfig.advanced.thinkingMode === 'custom',
      };

      llmMode = LLMTaskMode.EDIT_ASSISTANT_MANUSCRIPT;
    } else {
      const targetIds = input.targetId ? [input.targetId] : [];

      promptContext = {
        userInput: input.userRequest.trim(),
        projectId: input.projectId,
        targetIds,
        contextIds: contextIds.length > 0 ? contextIds : undefined,
        isNativeOutput,
        outputLanguage: mainLanguage,
        enablePrefill: editAssistantConfig.advanced.enablePrefill,
        enableThinking: editAssistantConfig.advanced.thinkingMode === 'model',
        enableCustomThinking: editAssistantConfig.advanced.thinkingMode === 'custom',
      };
    }

    let result: LLMTaskResult | null = null;

    const task = new LLMTask(
      {
        mode: llmMode,
        projectId: input.projectId,
        promptContext,
        abortController,
        provider: editAssistantConfig.provider,
        providerConfig,
        model: editAssistantConfig.model,
        temperature: editAssistantConfig.temperature,
        thinkingMode: editAssistantConfig.advanced.thinkingMode as any,
        thinkingConfig: editAssistantConfig.advanced.thinkingConfig,
        retryConfig: settingsStore.settings.retryConfig,
      },
      {
        onUpdate: (parts) => updateSession({ contentParts: parts }),
        onFunctionProgress: (progress) => updateSession({ functionCallProgress: progress }),
        onComplete: (r) => {
          result = r;
        },
        onError: () => {
          // Error is handled by LLMTask.run() throwing
        },
      }
    );

    await task.run();

    if (!result) {
      updateSession({ status: 'error', error: 'AI request finished without a result.' });
      return;
    }

    const finalResult = result as unknown as LLMTaskResult;

    updateSession({ provider: finalResult.provider, model: finalResult.model, usage: finalResult.usage });

    const functionCalls = isNativeOutput
      ? convertNativeOutputToFunctionCalls(
          finalResult.contentParts
            .filter(p => p.type === 'content')
            .map(p => p.text)
            .join('')
        )
      : finalResult.functionCalls;

    if (!functionCalls.length) {
      updateSession({ status: 'error', error: 'AI response did not include any actions to apply.' });
      return;
    }

    await stageSessionEdits({
      sessionId,
      projectId: input.projectId,
      language: mainLanguage,
      functionCalls,
    });
  },
};
