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
 * Context for translation prompts (unified for single and batch translations)
 */
export interface TranslationPromptContext extends BasePromptContext {
  sourceLanguage: string;
  targetLanguage: string;
  objectCount: number;
  objectsArray: string; // Already JSON stringified
  userInstructions?: string;
  enablePrefill?: boolean;
  enableThinking?: boolean;
  enableCustomThinking?: boolean;
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
    functionType: 'chat' | 'translation' | 'storyEdit' | 'chapterGen',
    category: 'systemPrompt' | 'functionInstructions' | 'prefill' | 'userPrompt',
    name?: 'workspace' | 'novelEditor'
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
        if (!translationContext?.sourceLanguage) {
          errors.push('Source language is required for translation prompt');
        }
        if (!translationContext?.targetLanguage) {
          errors.push('Target language is required for translation prompt');
        }
        if (!translationContext?.objectsArray) {
          errors.push('Objects array is required for translation prompt');
        }
        if (typeof translationContext?.objectCount !== 'number' || translationContext.objectCount < 1) {
          errors.push('Valid object count is required for translation prompt');
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
    const functionInstructions = await this.buildFunctionInstructions(context);
    const language = this.resolveLanguage(context.outputLanguage);

    const data = {
      variable: {
        functionInstructions,
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
    const {
      sourceLanguage,
      targetLanguage,
      objectCount,
      objectsArray,
      userInstructions,
    } = context;

    const [systemTemplate, userTemplate] = await Promise.all([
      this.getTemplate('translation', 'systemPrompt'),
      this.getTemplate('translation', 'userPrompt'),
    ]);

    const systemData = {
      variable: {
        sourceLanguage,
        targetLanguage,
        objectCount,
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
        sourceLanguage,
        targetLanguage,
        objectCount,
        objectsArray, // Pass raw string (it's already JSON stringified in context)
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

  private static async buildFunctionInstructions(context: ChatSystemPromptContext): Promise<string> {
    if (!context.mode || !context.functions || context.functions.length === 0) {
      return '';
    }

    return await this.getTemplate('chat', 'functionInstructions', context.mode);
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
