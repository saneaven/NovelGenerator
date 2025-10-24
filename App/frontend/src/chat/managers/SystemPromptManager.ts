import type { FunctionCallSchema } from '../types/functionCalling';
import type { StoryObjectCategory } from '../../types/storyObject';

import { TemplateRenderer, type RenderContext } from '../utils/TemplateRenderer';
import { useSettingsStore } from '../../store/settingsStore';
import { getDefaultPrompt } from '../../prompts/defaults';

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
  mode?: 'novel-editor' | 'workspace';
  functions?: FunctionCallSchema[];
  enablePrefill?: boolean;
  enableThinking?: boolean;
}

/**
 * Context for story object editing prompts
 */
export interface StoryObjectEditPromptContext extends BasePromptContext {
  category: StoryObjectCategory;
  targetId?: string;
  contextData?: Record<string, unknown>;
  currentData: unknown;
  jsonSchema: unknown;
  enablePrefill?: boolean;
  enableThinking?: boolean;
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
 * Context for translation prompts
 */
export interface TranslationPromptContext extends BasePromptContext {
  sourceLanguage: string;
  targetLanguage: string;
  dataType: TranslationDataType;
  sourceData: unknown;
  previousVersionData?: unknown;
  enablePrefill?: boolean;
  enableThinking?: boolean;
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
    category: 'systemPrompt' | 'functionInstructions' | 'prefill',
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
      console.error('Failed to load prompt, using bundled default:', error);
      // Final fallback to bundled default
      const fallback = getDefaultPrompt(functionType, category, name);
      if (fallback) {
        return fallback;
      }
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
    switch (type) {
      case PromptType.CHAT_SYSTEM:
        return this.generateChatSystemPrompt(context as ChatSystemPromptContext | undefined);
      case PromptType.STORY_OBJECT_EDIT:
        return this.generateStoryObjectEditPrompt(context as StoryObjectEditPromptContext);
      case PromptType.CHAPTER_EDIT:
        return this.generateChapterEditPrompt(context as ChapterEditPromptContext);
      case PromptType.TRANSLATION:
        return this.generateTranslationPrompt(context as TranslationPromptContext);
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
        if (!editContext?.jsonSchema) {
          errors.push('JSON schema is required for story object edit prompt');
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
        if (!translationContext?.dataType) {
          errors.push('Data type is required for translation prompt');
        }
        if (!translationContext?.sourceData) {
          errors.push('Source data is required for translation prompt');
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

  private static async generateChatSystemPrompt(context: ChatSystemPromptContext = {}): Promise<string> {
    const mode = context.mode || 'workspace';
    const systemTemplate = await this.getTemplate('chat', 'systemPrompt', mode);
    const functionInstructions = await this.buildFunctionInstructions(context);
    const language = this.resolveLanguage(context.outputLanguage);

    const renderContext: RenderContext = {
      variables: {
        functionInstructions,
        language,
      },
      conditionals: {
        thinking: context.enableThinking ?? false,
        prefill: context.enablePrefill ?? false,
      },
    };

    return TemplateRenderer.render(systemTemplate, renderContext);
  }

  private static async generateStoryObjectEditPrompt(context: StoryObjectEditPromptContext): Promise<string> {
    const { category, targetId, contextData, currentData, jsonSchema, outputLanguage } = context;

    const systemTemplate = await this.getTemplate('storyEdit', 'systemPrompt');
    const categoryName = this.getCategoryDisplayName(category);
    const editScope = targetId ? 'a specific item' : 'the entire category';
    const language = this.resolveLanguage(outputLanguage);

    const renderContext: RenderContext = {
      variables: {
        categoryName,
        editScope,
        language,
      },
      context: {
        contextData: this.formatContextData(contextData),
        currentData: this.formatJsonBlock(currentData),
        jsonSchema: this.formatJsonBlock(jsonSchema),
      },
      conditionals: {
        thinking: context.enableThinking ?? false,
        prefill: context.enablePrefill ?? false,
      },
    };

    return TemplateRenderer.render(systemTemplate, renderContext);
  }

  private static async generateChapterEditPrompt(context: ChapterEditPromptContext): Promise<string> {
    const { chapterName, currentContent, contextData, outputLanguage, userRequest } = context;

    const systemTemplate = await this.getTemplate('chapterGen', 'systemPrompt');
    const language = this.resolveLanguage(outputLanguage);

    const renderContext: RenderContext = {
      variables: {
        chapterName,
        language,
        userRequest: userRequest || 'Please improve the chapter content.',
      },
      context: {
        contextData: this.formatContextData(contextData),
        currentContent: this.formatTextBlock(currentContent),
      },
      conditionals: {
        thinking: context.enableThinking ?? false,
        prefill: context.enablePrefill ?? false,
      },
    };

    return TemplateRenderer.render(systemTemplate, renderContext);
  }

  private static async generateTranslationPrompt(context: TranslationPromptContext): Promise<string> {
    const { sourceLanguage, targetLanguage, dataType, sourceData, previousVersionData } = context;

    const systemTemplate = await this.getTemplate('translation', 'systemPrompt');
    const dataTypeName = this.getDataTypeDisplayName(dataType);
    const previousVersionContext = previousVersionData
      ? `## Previous Version Context\n\nA previous ${targetLanguage} version is provided below for reference. Use it to maintain consistency in terminology, style, and tone:\n\n${this.formatJsonBlock(previousVersionData)}`
      : '';

    const outputSchemaHint = this.getTranslationOutputSchemaHint(dataType);

    const renderContext: RenderContext = {
      variables: {
        sourceLanguage,
        targetLanguage,
        dataTypeName,
      },
      context: {
        previousVersionContext,
        sourceData: this.formatJsonBlock(sourceData),
        outputSchemaHint,
      },
      conditionals: {
        thinking: context.enableThinking ?? false,
        prefill: context.enablePrefill ?? false,
      },
    };

    return TemplateRenderer.render(systemTemplate, renderContext);
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

  private static formatContextData(contextData?: Record<string, unknown>): string {
    if (!contextData || Object.keys(contextData).length === 0) {
      return 'No additional context provided.';
    }

    return Object.entries(contextData)
      .map(([key, value]) => `### ${this.formatHeading(key)}\n${this.formatJsonBlock(value)}`)
      .join('\n\n');
  }

  private static formatJsonBlock(value: unknown): string {
    if (value === undefined) {
      return 'Not provided.';
    }

    const serialized = this.safeStringify(value);
    return `\u0060\u0060\u0060json\n${serialized}\n\u0060\u0060\u0060`;
  }

  private static formatTextBlock(value: string): string {
    if (!value) {
      return 'No content provided.';
    }

    return `\u0060\u0060\u0060text\n${value}\n\u0060\u0060\u0060`;
  }

  private static safeStringify(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private static formatHeading(input: string): string {
    if (!input) {
      return '';
    }

    return input.charAt(0).toUpperCase() + input.slice(1);
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

  /**
   * Get display name for translation data type
   */
  private static getDataTypeDisplayName(dataType: TranslationDataType): string {
    const names = {
      nameDescription: 'Name and Description',
      basicInfo: 'Basic Info',
      chapterData: 'Chapter Data',
      chapterContent: 'Chapter Content',
      chatMessage: 'Chat Message',
      general: 'General Data',
    } as const;

    return names[dataType] || dataType;
  }

  /**
   * Get output schema hint for translation data type
   */
  private static getTranslationOutputSchemaHint(dataType: TranslationDataType): string {
    const hints = {
      nameDescription: '```json\n{\n  "name": "translated name",\n  "description": "translated description"\n}\n```',
      basicInfo: '```json\n{\n  "title": "translated title",\n  "logline": "translated logline",\n  "genre": "translated genre"\n}\n```',
      chapterData: '```json\n{\n  "name": "translated chapter name",\n  "description": "translated chapter description"\n}\n```',
      chapterContent: '```json\n{\n  "content": "translated chapter content",\n  "wordCount": updated_word_count_number\n}\n```',
      chatMessage: '```json\n{\n  "content": "translated message content"\n}\n```',
      general: 'Match the structure of the input JSON with all translatable fields translated.',
    } as const;

    return hints[dataType] || hints.general;
  }
}
