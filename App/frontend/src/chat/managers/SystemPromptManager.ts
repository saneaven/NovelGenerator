import type { FunctionCallSchema } from '../types/functionCalling';
import type { StoryObjectCategory } from '../../types/storyObject';

import { renderTemplate } from '../../templateEngine/engine';
import { useSettingsStore } from '../../store/settingsStore';

/**
 * Enum defining different types of system prompts
 */
const PROMPT_TYPE = {
  CHAT_SYSTEM: 'chat_system',
  STORY_OBJECT_EDIT: 'story_object_edit',
  CHAPTER_EDIT: 'chapter_edit',
  TRANSLATION: 'translation',
  IMAGE_PROMPT: 'image_prompt',
} as const;

export type PromptType = typeof PROMPT_TYPE[keyof typeof PROMPT_TYPE];
export const PromptType = PROMPT_TYPE;

/**
 * Base interface for common prompt context
 */
export interface BasePromptContext {
  outputLanguage?: string;
}

/**
 * Context for chat system prompts
 */
export interface ChatSystemPromptContext extends BasePromptContext {
  mode?: 'novelEditor' | 'workspace';
  functions?: FunctionCallSchema[];
  enablePrefill?: boolean;
  enableThinking?: boolean;
  enableCustomThinking?: boolean;
}

/**
 * Context for story object editing prompts
 */
export interface StoryObjectEditPromptContext extends BasePromptContext {
  category: StoryObjectCategory;
  targetId?: string;
  contextData?: Record<string, unknown>;
  currentData: unknown;
  userRequest?: string;
  enablePrefill?: boolean;
  enableThinking?: boolean;
  enableCustomThinking?: boolean;
}

/**
 * Context for chapter editing prompts
 */
export interface ChapterEditPromptContext extends BasePromptContext {
  chapterName: string;
  currentContent: string;
  userRequest?: string;
  contextData?: Record<string, unknown>;
  enablePrefill?: boolean;
  enableThinking?: boolean;
  enableCustomThinking?: boolean;
}

/**
 * Translation data type classification
 */
export type TranslationDataType =
  | 'nameDescription'
  | 'basicInfo'
  | 'chapterData'
  | 'chapterContent'
  | 'chatMessage'
  | 'general';
/**
 * Context for story-object translation prompts (single/batch)
 */
export interface StoryTranslationPromptContext extends BasePromptContext {
  translationType?: 'story';
  sourceLanguage: string;
  targetLanguage: string;
  objectCount: number;
  objectsArray: Record<string, any>[];  // Array of objects (passed to context)
  userInstructions?: string;
  enablePrefill?: boolean;
  enableThinking?: boolean;
  enableCustomThinking?: boolean;
}

/**
 * Context for chat message translation prompts
 */
export interface ChatTranslationPromptContext extends BasePromptContext {
  translationType: 'chat';
  sourceLanguage: string;
  targetLanguage: string;
  sourceContent: string;
  userInstructions?: string;
  enablePrefill?: boolean;
  enableThinking?: boolean;
  enableCustomThinking?: boolean;
}

export type TranslationPromptContext =
  | StoryTranslationPromptContext
  | ChatTranslationPromptContext;

/**
 * Context for image prompt generation
 */
export interface ImagePromptContext extends BasePromptContext {
  userRequest: string;
  promptMode: 'natural' | 'positive' | 'negative';
  // Object info (one of these will be set based on object type)
  characterInfo?: string | null;
  locationInfo?: string | null;
  organizationInfo?: string | null;
  lorebookInfo?: string | null;
  // Scene context
  scenePreContext?: string | null;
  scenePostContext?: string | null;
  // Saved prompts from object
  currentPrompt?: string | null;
  currentPromptPositive?: string | null;
  currentPromptNegative?: string | null;
}

export interface PromptBundle {
  systemPrompt: string;
  userPrompts: string[];
}

/**
 * Centralized system prompt manager that renders markdown templates with placeholders
 * Now loads prompts dynamically from settings store with fallback to bundled defaults
 */
export class SystemPromptManager {
  /**
   * Load a prompt template from store or fallback to bundled default
   */
  private static async getTemplate(
    functionType: 'chat' | 'translation' | 'storyEdit' | 'chapterGen' | 'imagePrompt',
    category: 'systemPrompt' | 'prefill' | 'userPrompt',
    name?: string
  ): Promise<string> {
    const store = useSettingsStore.getState();

    // Try to get from cache first
    const cached = store.getPromptFromCache(functionType, category, name);
    if (cached) {
      return cached;
    }

    // Load from backend (will cache automatically)
    try {
      return await store.loadPrompt(functionType, category, name);
    } catch (error) {
      console.error('Failed to load prompt:', error);
      throw new Error(`No prompt template found for ${functionType}/${category}/${name || 'default'}`);
    }
  }

  /**
   * Generate system prompt based on type and context - Overloaded for type safety
   * Now async to support dynamic prompt loading
   */
  static generatePrompt(type: typeof PromptType.CHAT_SYSTEM, context?: ChatSystemPromptContext): Promise<string>;
  static generatePrompt(type: typeof PromptType.STORY_OBJECT_EDIT, context: StoryObjectEditPromptContext): Promise<string>;
  static generatePrompt(type: typeof PromptType.CHAPTER_EDIT, context: ChapterEditPromptContext): Promise<string>;
  static generatePrompt(type: typeof PromptType.TRANSLATION, context: TranslationPromptContext): Promise<string>;
  static async generatePrompt(type: PromptType, context?: unknown): Promise<string> {
    const bundle = await this.generatePromptBundle(type as any, context as any);
    return bundle.systemPrompt;
  }

  static generatePromptBundle(type: typeof PromptType.CHAT_SYSTEM, context?: ChatSystemPromptContext): Promise<PromptBundle>;
  static generatePromptBundle(type: typeof PromptType.STORY_OBJECT_EDIT, context: StoryObjectEditPromptContext): Promise<PromptBundle>;
  static generatePromptBundle(type: typeof PromptType.CHAPTER_EDIT, context: ChapterEditPromptContext): Promise<PromptBundle>;
  static generatePromptBundle(type: typeof PromptType.TRANSLATION, context: TranslationPromptContext): Promise<PromptBundle>;
  static generatePromptBundle(type: typeof PromptType.IMAGE_PROMPT, context: ImagePromptContext): Promise<PromptBundle>;
  static async generatePromptBundle(type: PromptType, context?: unknown): Promise<PromptBundle> {
    switch (type) {
      case PromptType.CHAT_SYSTEM:
        return this.generateChatBundle(context as ChatSystemPromptContext | undefined);
      case PromptType.STORY_OBJECT_EDIT:
        return this.generateStoryObjectEditBundle(context as StoryObjectEditPromptContext);
      case PromptType.CHAPTER_EDIT:
        return this.generateChapterEditBundle(context as ChapterEditPromptContext);
      case PromptType.TRANSLATION:
        return this.generateTranslationBundle(context as TranslationPromptContext);
      case PromptType.IMAGE_PROMPT:
        return this.generateImagePromptBundle(context as ImagePromptContext);
      default:
        throw new Error(`Unknown prompt type: ${type}`);
    }
  }

  /**
   * Validate prompt generation context
   */
  static validateContext(type: typeof PromptType.STORY_OBJECT_EDIT, context: StoryObjectEditPromptContext): { isValid: boolean; errors: string[] };
  static validateContext(type: typeof PromptType.CHAPTER_EDIT, context: ChapterEditPromptContext): { isValid: boolean; errors: string[] };
  static validateContext(type: typeof PromptType.CHAT_SYSTEM, context?: ChatSystemPromptContext): { isValid: boolean; errors: string[] };
  static validateContext(type: typeof PromptType.TRANSLATION, context: TranslationPromptContext): { isValid: boolean; errors: string[] };
  static validateContext(type: PromptType, context?: unknown): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    const normalizedContext = (context ?? {}) as Record<string, unknown>;

    switch (type) {
      case PromptType.STORY_OBJECT_EDIT: {
        const editContext = normalizedContext as Partial<StoryObjectEditPromptContext>;
        if (!editContext?.category) {
          errors.push('Category is required for story object edit prompt');
        }
        if (!editContext?.currentData) {
          errors.push('Current data is required for story object edit prompt');
        }
        break;
      }
      case PromptType.CHAPTER_EDIT: {
        const chapterContext = normalizedContext as Partial<ChapterEditPromptContext>;
        if (!chapterContext?.chapterName) {
          errors.push('Chapter name is required for chapter edit prompt');
        }
        if (!chapterContext?.currentContent) {
          errors.push('Current content is required for chapter edit prompt');
        }
        break;
      }
      case PromptType.TRANSLATION: {
        const translationContext = normalizedContext as Partial<TranslationPromptContext>;
        const translationType = (translationContext as Partial<StoryTranslationPromptContext | ChatTranslationPromptContext>).translationType || 'story';
        if (!translationContext?.sourceLanguage) {
          errors.push('Source language is required for translation prompt');
        }
        if (!translationContext?.targetLanguage) {
          errors.push('Target language is required for translation prompt');
        }
        if (translationType === 'chat') {
          if (!(translationContext as Partial<ChatTranslationPromptContext>)?.sourceContent) {
            errors.push('Source content is required for chat translation prompt');
          }
        } else {
          if (!(translationContext as Partial<StoryTranslationPromptContext>)?.objectsArray) {
            errors.push('Objects array is required for translation prompt');
          }
          const count = (translationContext as Partial<StoryTranslationPromptContext>)?.objectCount;
          if (typeof count !== 'number' || count < 1) {
            errors.push('Valid object count is required for translation prompt');
          }
        }
        break;
      }
      case PromptType.CHAT_SYSTEM:
        // Chat system context is always valid (all properties are optional)
        break;
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Get available prompt types
   */
  static getAvailablePromptTypes(): PromptType[] {
    return Object.values(PromptType);
  }

  private static async generateChatBundle(context: ChatSystemPromptContext = {}): Promise<PromptBundle> {
    const mode = context.mode || 'workspace';
    const systemTemplate = await this.getTemplate('chat', 'systemPrompt', mode);
    const language = this.resolveLanguage(context.outputLanguage);

    const data = {
      variable: {
        language,
        mode,
        today: new Date().toISOString().split('T')[0],
      },
      state: {
        enableThinking: context.enableThinking ?? false,
        enableCustomThinking: context.enableCustomThinking ?? false,
        enablePrefill: context.enablePrefill ?? false,
        hasFunctions: !!(context.functions && context.functions.length > 0),
      },
      context: {}
    };

    const systemPrompt = renderTemplate(systemTemplate, data);

    return {
      systemPrompt,
      userPrompts: [],
    };
  }

  private static async generateStoryObjectEditBundle(context: StoryObjectEditPromptContext): Promise<PromptBundle> {
    const { category, targetId, contextData, currentData, outputLanguage, userRequest } = context;

    const [systemTemplate, userTemplate] = await Promise.all([
      this.getTemplate('storyEdit', 'systemPrompt'),
      this.getTemplate('storyEdit', 'userPrompt'),
    ]);

    const categoryName = this.getCategoryDisplayName(category);
    const editScope = targetId ? 'a specific item' : 'the entire category';
    const language = this.resolveLanguage(outputLanguage);

    const systemData = {
      variable: {
        categoryName,
        editScope,
        language,
      },
      state: {
        enableThinking: context.enableThinking ?? false,
        enableCustomThinking: context.enableCustomThinking ?? false,
        enablePrefill: context.enablePrefill ?? false,
      },
      context: {}
    };

    const userData = {
      variable: {
        categoryName,
        targetId: targetId ?? '',
        userRequest: userRequest || '',
      },
      state: {},
      context: {
        contextData,
        currentData,
      }
    };

    return {
      systemPrompt: renderTemplate(systemTemplate, systemData),
      userPrompts: [
        renderTemplate(userTemplate, userData),
      ],
    };
  }

  private static async generateChapterEditBundle(context: ChapterEditPromptContext): Promise<PromptBundle> {
    const { chapterName, currentContent, contextData, outputLanguage, userRequest } = context;

    const [systemTemplate, userTemplate] = await Promise.all([
      this.getTemplate('chapterGen', 'systemPrompt'),
      this.getTemplate('chapterGen', 'userPrompt'),
    ]);

    const language = this.resolveLanguage(outputLanguage);

    const systemData = {
      variable: {
        chapterName,
        language,
      },
      state: {
        enableThinking: context.enableThinking ?? false,
        enableCustomThinking: context.enableCustomThinking ?? false,
        enablePrefill: context.enablePrefill ?? false,
      },
      context: {}
    };

    const userData = {
      variable: {
        chapterName,
        currentContent,
        userRequest: userRequest || '',
      },
      state: {},
      context: {
        contextData,
      }
    };

    return {
      systemPrompt: renderTemplate(systemTemplate, systemData),
      userPrompts: [
        renderTemplate(userTemplate, userData),
      ],
    };
  }

  private static async generateTranslationBundle(context: TranslationPromptContext): Promise<PromptBundle> {
    const translationType = context.translationType || 'story';

    if (translationType === 'chat') {
      const chatContext = context as ChatTranslationPromptContext;
      const {
        sourceLanguage,
        targetLanguage,
        sourceContent,
        userInstructions,
      } = chatContext;

      let systemTemplate: string;
      let userTemplate: string;


    [systemTemplate, userTemplate] = await Promise.all([
        this.getTemplate('translation', 'systemPrompt', 'chat'),
        this.getTemplate('translation', 'userPrompt', 'chat'),
    ]);

      const systemData = {
        variable: {
          sourceLanguage,
          targetLanguage,
        },
        state: {
          enableThinking: chatContext.enableThinking ?? false,
          enableCustomThinking: chatContext.enableCustomThinking ?? false,
          enablePrefill: chatContext.enablePrefill ?? false,
        },
        context: {}
      };

      const userData = {
        variable: {
          sourceLanguage,
          targetLanguage,
          sourceContent,
          userInstructions: userInstructions || '',
        },
        state: {},
        context: {}
      };

      return {
        systemPrompt: renderTemplate(systemTemplate, systemData),
        userPrompts: [
          renderTemplate(userTemplate, userData),
        ],
      };
    }

    const storyContext = context as StoryTranslationPromptContext;
    const {
      sourceLanguage,
      targetLanguage,
      objectCount,
      objectsArray,
      userInstructions,
    } = storyContext;

    let systemTemplate: string;
    let userTemplate: string;

    try {
      [systemTemplate, userTemplate] = await Promise.all([
        this.getTemplate('translation', 'systemPrompt', 'story'),
        this.getTemplate('translation', 'userPrompt', 'story'),
      ]);
    } catch (error) {
      // Fallback to unnamed templates if named ones are missing
      [systemTemplate, userTemplate] = await Promise.all([
        this.getTemplate('translation', 'systemPrompt'),
        this.getTemplate('translation', 'userPrompt'),
      ]);
    }

    const systemData = {
      variable: {
        sourceLanguage,
        targetLanguage,
        objectCount,
      },
      state: {
        enableThinking: storyContext.enableThinking ?? false,
        enableCustomThinking: storyContext.enableCustomThinking ?? false,
        enablePrefill: storyContext.enablePrefill ?? false,
      },
      context: {}
    };

    const userData = {
      variable: {
        sourceLanguage,
        targetLanguage,
        objectCount,
        userInstructions: userInstructions || '',
      },
      state: {},
      context: {
        objectsArray,  // Array goes in context, use {{ context.objectsArray | json }} in template
      }
    };

    return {
      systemPrompt: renderTemplate(systemTemplate, systemData),
      userPrompts: [
        renderTemplate(userTemplate, userData),
      ],
    };
  }

  private static async generateImagePromptBundle(context: ImagePromptContext): Promise<PromptBundle> {
    const [systemTemplate, userTemplate] = await Promise.all([
      this.getTemplate('imagePrompt', 'systemPrompt'),
      this.getTemplate('imagePrompt', 'userPrompt'),
    ]);

    const systemData = {
      variable: {},
      state: {},
      context: {}
    };

    const userData = {
      variable: {
        userRequest: context.userRequest,
        characterInfo: context.characterInfo,
        locationInfo: context.locationInfo,
        organizationInfo: context.organizationInfo,
        lorebookInfo: context.lorebookInfo,
        scenePreContext: context.scenePreContext,
        scenePostContext: context.scenePostContext,
        currentPrompt: context.currentPrompt,
        currentPromptPositive: context.currentPromptPositive,
        currentPromptNegative: context.currentPromptNegative,
        promptMode: context.promptMode,
      },
      state: {
        isCharacterRequest: !!context.characterInfo,
        isLocationRequest: !!context.locationInfo,
        isOrganizationRequest: !!context.organizationInfo,
        isLorebookRequest: !!context.lorebookInfo,
        isSceneRequest: !!(context.scenePreContext || context.scenePostContext),
        hasCurrentPrompt: !!(context.currentPrompt || context.currentPromptPositive),
        hasUserRequest: !!context.userRequest?.trim(),
        isNaturalPrompt: context.promptMode === 'natural',
        isPositivePrompt: context.promptMode === 'positive',
        isNegativePrompt: context.promptMode === 'negative',
      },
      context: {}
    };

    return {
      systemPrompt: renderTemplate(systemTemplate, systemData),
      userPrompts: [
        renderTemplate(userTemplate, userData),
      ],
    };
  }

  private static resolveLanguage(language?: string): string {
    const trimmed = language ? language.trim() : '';
    return trimmed.length > 0 ? trimmed : 'the language used by the user';
  }

  /**
   * Get display name for story object category
   */
  private static getCategoryDisplayName(category: StoryObjectCategory): string {
    const names = {
      basicInfo: 'Basic Info',
      character: 'Character',
      organization: 'Organization',
      location: 'Location',
      lorebook: 'Lorebook',
      outline: 'Outline',
      act: 'Act',
      chapter: 'Chapter',
    } as const;

    return names[category] || category;
  }
}
