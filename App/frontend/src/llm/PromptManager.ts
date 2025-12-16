import type { FunctionCallSchema } from './schemas/chatFunctions';
import type { StoryObjectCategory } from '../types/storyObject';
import { getEditFunctionsForCategory, CHAPTER_EDIT_FUNCTIONS } from './schemas/editFunctions';
import { TRANSLATION_FUNCTIONS, CHAT_TRANSLATION_FUNCTIONS } from './schemas/translationFunctions';
import { OBJECT_IMAGE_PROMPT_FUNCTIONS } from './schemas/imagePromptFunctions';
import { renderTemplate } from '../templateEngine/engine';
import { useSettingsStore } from '../store/settingsStore';
import {
  LLMTaskMode,
  type LLMTaskModeType,
  type PromptBundle,
  type PromptContext,
  type TemplateData,
  type ChatWorkspacePromptContext,
  type ChatNovelEditorPromptContext,
  type StoryObjectEditPromptContext,
  type ChapterEditPromptContext,
  type StoryTranslationPromptContext,
  type ChatTranslationPromptContext,
  type ObjectImagePromptContext,
  type SceneImagePromptContext,
} from './types';

/**
 * PromptManager - Renders prompt templates for all LLM task modes
 * Supports systemPrompt, userPrompt, nonLastUserPrompt, and prefill
 */
export class PromptManager {
  /**
   * Load a prompt template from store or fallback to bundled default
   */
  private static async getTemplate(
    functionType: 'chat' | 'translation' | 'storyObjectEdit' | 'manuscriptEdit' | 'imagePrompt',
    category: 'systemPrompt' | 'prefill' | 'userPrompt' | 'nonLastUserPrompt',
    name?: string
  ): Promise<string | null> {
    const store = useSettingsStore.getState();

    // Try to get from cache first
    const cached = store.getPromptFromCache(functionType, category as any, name);
    if (cached) {
      return cached;
    }

    // Load from backend (will cache automatically)
    try {
      return await store.loadPrompt(functionType, category as any, name);
    } catch (error) {
      // nonLastUserPrompt is optional, return null if not found
      if (category === 'nonLastUserPrompt') {
        return null;
      }
      console.error('Failed to load prompt:', error);
      throw new Error(`No prompt template found for ${functionType}/${category}/${name || 'default'}`);
    }
  }

  /**
   * Generate a complete prompt bundle for a given mode and context
   */
  static async generatePromptBundle(
    mode: LLMTaskModeType,
    context: PromptContext
  ): Promise<PromptBundle> {
    switch (mode) {
      case LLMTaskMode.CHAT_WORKSPACE:
        return this.generateChatWorkspaceBundle(context as ChatWorkspacePromptContext);
      case LLMTaskMode.CHAT_NOVEL_EDITOR:
        return this.generateChatNovelEditorBundle(context as ChatNovelEditorPromptContext);
      case LLMTaskMode.STORY_OBJECT_EDIT:
        return this.generateStoryObjectEditBundle(context as StoryObjectEditPromptContext);
      case LLMTaskMode.CHAPTER_EDIT:
        return this.generateChapterEditBundle(context as ChapterEditPromptContext);
      case LLMTaskMode.TRANSLATION:
        return this.generateTranslationBundle(context as StoryTranslationPromptContext);
      case LLMTaskMode.CHAT_TRANSLATION:
        return this.generateChatTranslationBundle(context as ChatTranslationPromptContext);
      case LLMTaskMode.OBJECT_IMAGE_PROMPT:
        return this.generateObjectImagePromptBundle(context as ObjectImagePromptContext);
      case LLMTaskMode.SCENE_IMAGE_PROMPT:
        return this.generateSceneImagePromptBundle(context as SceneImagePromptContext);
      default:
        throw new Error(`Unknown LLM task mode: ${mode}`);
    }
  }

  /**
   * Render a template with the given data
   */
  static renderTemplate(template: string, data: Record<string, any>): string {
    return renderTemplate(template, data);
  }

  /**
   * Get functions for a given mode
   */
  static getFunctionsForMode(
    mode: LLMTaskModeType,
    context: PromptContext
  ): FunctionCallSchema[] | undefined {
    switch (mode) {
      case LLMTaskMode.CHAT_WORKSPACE:
      case LLMTaskMode.CHAT_NOVEL_EDITOR:
        return (context as ChatWorkspacePromptContext).functions;
      case LLMTaskMode.STORY_OBJECT_EDIT:
        return this.getStoryObjectEditFunctions(context as StoryObjectEditPromptContext);
      case LLMTaskMode.CHAPTER_EDIT:
        return this.getChapterEditFunctions(context as ChapterEditPromptContext);
      case LLMTaskMode.TRANSLATION:
        return this.getTranslationFunctions(context as StoryTranslationPromptContext);
      case LLMTaskMode.CHAT_TRANSLATION:
        return this.getChatTranslationFunctions(context as ChatTranslationPromptContext);
      case LLMTaskMode.OBJECT_IMAGE_PROMPT:
        return this.getObjectImagePromptFunctions(context as ObjectImagePromptContext);
      case LLMTaskMode.SCENE_IMAGE_PROMPT:
        return undefined; // Native output
      default:
        return undefined;
    }
  }

  // ==================== Chat Workspace ====================

  private static async generateChatWorkspaceBundle(
    context: ChatWorkspacePromptContext
  ): Promise<PromptBundle> {
    const [systemTemplate, userTemplate, nonLastTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('chat', 'systemPrompt', 'workspace'),
      this.getTemplate('chat', 'userPrompt', 'workspace'),
      this.getTemplate('chat', 'nonLastUserPrompt', 'workspace'),
      this.getTemplate('chat', 'prefill', 'workspace'),
    ]);

    const mainLanguage = this.resolveLanguage(context.outputLanguage);

    const templateData: TemplateData = {
      variable: {
        mainLanguage,
        mode: 'workspace' as const,
        userInput: context.userInput,
        today: new Date().toISOString().split('T')[0],
      },
      state: {
        enableThinking: context.enableThinking ?? false,
        enableCustomThinking: context.enableCustomThinking ?? false,
        enablePrefill: context.enablePrefill ?? false,
        hasFunctions: !!(context.functions && context.functions.length > 0),
      },
      context: {
        storyContext: context.storyObjects ?? null,
        functionResults: context.functionResults ?? [],
      },
    };

    return {
      systemPrompt: renderTemplate(systemTemplate!, templateData),
      userPrompt: userTemplate ? renderTemplate(userTemplate, templateData) : context.userInput,
      nonLastUserPrompt: nonLastTemplate ? nonLastTemplate : undefined,
      prefill: prefillTemplate && context.enablePrefill
        ? renderTemplate(prefillTemplate, templateData)
        : undefined,
      templateData,
    };
  }

  // ==================== Chat Novel Editor ====================

  private static async generateChatNovelEditorBundle(
    context: ChatNovelEditorPromptContext
  ): Promise<PromptBundle> {
    const [systemTemplate, userTemplate, nonLastTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('chat', 'systemPrompt', 'novelEditor'),
      this.getTemplate('chat', 'userPrompt', 'novelEditor'),
      this.getTemplate('chat', 'nonLastUserPrompt', 'novelEditor'),
      this.getTemplate('chat', 'prefill', 'novelEditor'),
    ]);

    const mainLanguage = this.resolveLanguage(context.outputLanguage);

    const templateData: TemplateData = {
      variable: {
        mainLanguage,
        mode: 'novelEditor' as const,
        userInput: context.userInput,
        today: new Date().toISOString().split('T')[0],
      },
      state: {
        enableThinking: context.enableThinking ?? false,
        enableCustomThinking: context.enableCustomThinking ?? false,
        enablePrefill: context.enablePrefill ?? false,
        hasFunctions: !!(context.functions && context.functions.length > 0),
      },
      context: {
        storyContext: context.storyObjects ?? null,
        novelContent: context.novelData ?? null,
        functionResults: context.functionResults ?? [],
      },
    };

    return {
      systemPrompt: renderTemplate(systemTemplate!, templateData),
      userPrompt: userTemplate ? renderTemplate(userTemplate, templateData) : context.userInput,
      nonLastUserPrompt: nonLastTemplate ? nonLastTemplate : undefined,
      prefill: prefillTemplate && context.enablePrefill
        ? renderTemplate(prefillTemplate, templateData)
        : undefined,
      templateData,
    };
  }

  // ==================== Story Object Edit ====================

  private static async generateStoryObjectEditBundle(
    context: StoryObjectEditPromptContext
  ): Promise<PromptBundle> {
    const [systemTemplate, userTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('storyObjectEdit', 'systemPrompt'),
      this.getTemplate('storyObjectEdit', 'userPrompt'),
      this.getTemplate('storyObjectEdit', 'prefill'),
    ]);

    const categoryName = this.getCategoryDisplayName(context.category);
    const editScope = context.targetId ? 'a specific item' : 'the entire category';
    const mainLanguage = this.resolveLanguage(context.outputLanguage);
    const isBatchEdit = !context.targetId;

    const templateData: TemplateData = {
      variable: {
        mainLanguage,
        userInput: context.userInput,
        today: new Date().toISOString().split('T')[0],
        categoryName,
        editScope,
        targetId: context.targetId ?? '',
      },
      state: {
        enableThinking: context.enableThinking ?? false,
        enableCustomThinking: context.enableCustomThinking ?? false,
        enablePrefill: context.enablePrefill ?? false,
        isNativeOutput: context.isNativeOutput ?? false,
        isBatchEdit,
      },
      context: {
        contextData: context.contextData,
        currentData: context.currentData,
      },
    };

    return {
      systemPrompt: renderTemplate(systemTemplate!, templateData),
      userPrompt: renderTemplate(userTemplate!, templateData),
      prefill: prefillTemplate && context.enablePrefill
        ? renderTemplate(prefillTemplate, templateData)
        : undefined,
      templateData,
    };
  }

  // ==================== Chapter Edit ====================

  private static async generateChapterEditBundle(
    context: ChapterEditPromptContext
  ): Promise<PromptBundle> {
    const [systemTemplate, userTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('manuscriptEdit', 'systemPrompt'),
      this.getTemplate('manuscriptEdit', 'userPrompt'),
      this.getTemplate('manuscriptEdit', 'prefill'),
    ]);

    const mainLanguage = this.resolveLanguage(context.outputLanguage);

    const templateData: TemplateData = {
      variable: {
        mainLanguage,
        userInput: context.userInput,
        today: new Date().toISOString().split('T')[0],
        currentChapterId: context.currentChapterId,
        currentChapterName: context.currentChapterName,
        currentChapterContent: context.currentChapterContent,
      },
      state: {
        enableThinking: context.enableThinking ?? false,
        enableCustomThinking: context.enableCustomThinking ?? false,
        enablePrefill: context.enablePrefill ?? false,
        isNativeOutput: context.isNativeOutput ?? false,
      },
      context: {
        contextData: context.contextData,
      },
    };

    return {
      systemPrompt: renderTemplate(systemTemplate!, templateData),
      userPrompt: renderTemplate(userTemplate!, templateData),
      prefill: prefillTemplate && context.enablePrefill
        ? renderTemplate(prefillTemplate, templateData)
        : undefined,
      templateData,
    };
  }

  // ==================== Translation ====================

  private static async generateTranslationBundle(
    context: StoryTranslationPromptContext
  ): Promise<PromptBundle> {
    let systemTemplate: string;
    let userTemplate: string;
    let prefillTemplate: string | null;

    try {
      [systemTemplate, userTemplate, prefillTemplate] = await Promise.all([
        this.getTemplate('translation', 'systemPrompt', 'story'),
        this.getTemplate('translation', 'userPrompt', 'story'),
        this.getTemplate('translation', 'prefill', 'story'),
      ]) as [string, string, string | null];
    } catch {
      [systemTemplate, userTemplate, prefillTemplate] = await Promise.all([
        this.getTemplate('translation', 'systemPrompt'),
        this.getTemplate('translation', 'userPrompt'),
        this.getTemplate('translation', 'prefill'),
      ]) as [string, string, string | null];
    }

    const hasContext = !!(context.contextData && Object.keys(context.contextData).length > 0);

    const templateData: TemplateData = {
      variable: {
        userInput: context.userInput,
        today: new Date().toISOString().split('T')[0],
        sourceLanguage: context.sourceLanguage,
        targetLanguage: context.targetLanguage,
        objectCount: context.objectCount,
      },
      state: {
        enableThinking: context.enableThinking ?? false,
        enableCustomThinking: context.enableCustomThinking ?? false,
        enablePrefill: context.enablePrefill ?? false,
        isNativeOutput: context.isNativeOutput ?? false,
        hasContext,
      },
      context: {
        objectsArray: context.objectsArray,
        contextData: context.contextData,
      },
    };

    return {
      systemPrompt: renderTemplate(systemTemplate!, templateData),
      userPrompt: renderTemplate(userTemplate!, templateData),
      prefill: prefillTemplate && context.enablePrefill
        ? renderTemplate(prefillTemplate, templateData)
        : undefined,
      templateData,
    };
  }

  // ==================== Chat Translation ====================

  private static async generateChatTranslationBundle(
    context: ChatTranslationPromptContext
  ): Promise<PromptBundle> {
    const [systemTemplate, userTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('translation', 'systemPrompt', 'chat'),
      this.getTemplate('translation', 'userPrompt', 'chat'),
      this.getTemplate('translation', 'prefill', 'chat'),
    ]);

    const templateData: TemplateData = {
      variable: {
        userInput: context.userInput,
        today: new Date().toISOString().split('T')[0],
        sourceLanguage: context.sourceLanguage,
        targetLanguage: context.targetLanguage,
        objectCount: 1,
        sourceContent: context.sourceContent,
      },
      state: {
        enableThinking: context.enableThinking ?? false,
        enableCustomThinking: context.enableCustomThinking ?? false,
        enablePrefill: context.enablePrefill ?? false,
        isNativeOutput: context.isNativeOutput ?? false,
      },
      context: {},
    };

    return {
      systemPrompt: renderTemplate(systemTemplate!, templateData),
      userPrompt: renderTemplate(userTemplate!, templateData),
      prefill: prefillTemplate && context.enablePrefill
        ? renderTemplate(prefillTemplate, templateData)
        : undefined,
      templateData,
    };
  }

  // ==================== Object Image Prompt ====================

  private static async generateObjectImagePromptBundle(
    context: ObjectImagePromptContext
  ): Promise<PromptBundle> {
    const [systemTemplate, userTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('imagePrompt', 'systemPrompt', 'object'),
      this.getTemplate('imagePrompt', 'userPrompt', 'object'),
      this.getTemplate('imagePrompt', 'prefill', 'object'),
    ]);

    const mainLanguage = this.resolveLanguage(context.outputLanguage);

    const templateData: TemplateData = {
      variable: {
        mainLanguage,
        userInput: context.userInput,
        today: new Date().toISOString().split('T')[0],
        objectType: context.objectType,
        objectInfo: context.objectInfo,
        currentPrompt: context.currentPrompt,
        currentPromptPositive: context.currentPromptPositive,
        currentPromptNegative: context.currentPromptNegative,
        promptMode: context.promptMode,
      },
      state: {
        enableThinking: context.enableThinking ?? false,
        enableCustomThinking: context.enableCustomThinking ?? false,
        enablePrefill: context.enablePrefill ?? false,
        isNativeOutput: context.isNativeOutput ?? false,
        isNaturalPrompt: context.promptMode === 'natural',
        isPositivePrompt: context.promptMode === 'positive',
        isNegativePrompt: context.promptMode === 'negative',
        hasUserInput: !!context.userInput?.trim(),
        hasCurrentPrompt: !!(context.currentPrompt || context.currentPromptPositive),
      },
      context: {},
    };

    return {
      systemPrompt: renderTemplate(systemTemplate!, templateData),
      userPrompt: renderTemplate(userTemplate!, templateData),
      prefill: prefillTemplate && context.enablePrefill
        ? renderTemplate(prefillTemplate, templateData)
        : undefined,
      templateData,
    };
  }

  // ==================== Scene Image Prompt ====================

  private static async generateSceneImagePromptBundle(
    context: SceneImagePromptContext
  ): Promise<PromptBundle> {
    const [systemTemplate, userTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('imagePrompt', 'systemPrompt', 'scene'),
      this.getTemplate('imagePrompt', 'userPrompt', 'scene'),
      this.getTemplate('imagePrompt', 'prefill', 'scene'),
    ]);

    const mainLanguage = this.resolveLanguage(context.outputLanguage);

    const templateData: TemplateData = {
      variable: {
        mainLanguage,
        userInput: context.userInput,
        today: new Date().toISOString().split('T')[0],
        scenePreContext: context.scenePreContext,
        scenePostContext: context.scenePostContext,
        promptMode: context.promptMode,
      },
      state: {
        enableThinking: context.enableThinking ?? false,
        enableCustomThinking: context.enableCustomThinking ?? false,
        enablePrefill: context.enablePrefill ?? false,
        isNativeOutput: context.isNativeOutput ?? false,
        isNaturalPrompt: context.promptMode === 'natural',
        isPositivePrompt: context.promptMode === 'positive',
        isNegativePrompt: context.promptMode === 'negative',
        hasUserInput: !!context.userInput?.trim(),
        hasSelectedObjects: context.selectedObjects && context.selectedObjects.length > 0,
      },
      context: {
        selectedObjects: context.selectedObjects || [],
      },
    };

    return {
      systemPrompt: renderTemplate(systemTemplate!, templateData),
      userPrompt: renderTemplate(userTemplate!, templateData),
      prefill: prefillTemplate && context.enablePrefill
        ? renderTemplate(prefillTemplate, templateData)
        : undefined,
      templateData,
    };
  }

  // ==================== Helpers ====================

  private static resolveLanguage(language?: string): string {
    const trimmed = language ? language.trim() : '';
    return trimmed.length > 0 ? trimmed : 'the language used by the user';
  }

  private static getCategoryDisplayName(category: StoryObjectCategory): string {
    const names: Record<string, string> = {
      basicInfo: 'Basic Info',
      character: 'Character',
      organization: 'Organization',
      location: 'Location',
      lorebook: 'Lorebook',
      outline: 'Outline',
      act: 'Act',
      chapter: 'Chapter',
    };
    return names[category] || category;
  }

  // ==================== Function Schemas ====================

  private static getStoryObjectEditFunctions(
    context: StoryObjectEditPromptContext
  ): FunctionCallSchema[] | undefined {
    if (context.isNativeOutput) return undefined;
    return getEditFunctionsForCategory(context.category, context.targetId);
  }

  private static getChapterEditFunctions(
    context: ChapterEditPromptContext
  ): FunctionCallSchema[] | undefined {
    if (context.isNativeOutput) return undefined;
    return CHAPTER_EDIT_FUNCTIONS;
  }

  private static getTranslationFunctions(
    context: StoryTranslationPromptContext
  ): FunctionCallSchema[] | undefined {
    if (context.isNativeOutput) return undefined;
    return TRANSLATION_FUNCTIONS;
  }

  private static getChatTranslationFunctions(
    context: ChatTranslationPromptContext
  ): FunctionCallSchema[] | undefined {
    if (context.isNativeOutput) return undefined;
    return CHAT_TRANSLATION_FUNCTIONS;
  }

  private static getObjectImagePromptFunctions(
    context: ObjectImagePromptContext
  ): FunctionCallSchema[] | undefined {
    if (context.isNativeOutput) return undefined;
    return OBJECT_IMAGE_PROMPT_FUNCTIONS;
  }

}
