import type { FunctionCallSchema } from '../types/functionCalling';
import type { StoryObjectCategory } from '../../types/storyObject';

import chatSystemTemplate from './prompts/WorkspaceSystemPrompt.md?raw';
import storyObjectEditTemplate from './prompts/StoryObjectEditPrompt.md?raw';
import chapterEditTemplate from './prompts/ChapterEditPrompt.md?raw';
import novelEditorFunctionInstructions from './prompts/functionInstructions/novelEditor.md?raw';
import workspaceFunctionInstructions from './prompts/functionInstructions/workspace.md?raw';

/**
 * Enum defining different types of system prompts
 */
const PROMPT_TYPE = {
  CHAT_SYSTEM: 'chat_system',
  STORY_OBJECT_EDIT: 'story_object_edit',
  CHAPTER_EDIT: 'chapter_edit',
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
}

/**
 * Context for chapter editing prompts
 */
export interface ChapterEditPromptContext extends BasePromptContext {
  chapterName: string;
  currentContent: string;
  userRequest?: string;
  contextData?: Record<string, unknown>;
}

interface TemplatePlaceholders {
  var?: Record<string, string | undefined>;
  context?: Record<string, string | undefined>;
}

/**
 * Centralized system prompt manager that renders markdown templates with placeholders
 */
export class SystemPromptManager {
  private static readonly FUNCTION_INSTRUCTION_TEMPLATES: Record<'novel-editor' | 'workspace', string> = {
    'novel-editor': novelEditorFunctionInstructions,
    'workspace': workspaceFunctionInstructions,
  };

  /**
   * Generate system prompt based on type and context - Overloaded for type safety
   */
  static generatePrompt(type: typeof PromptType.CHAT_SYSTEM, context?: ChatSystemPromptContext): string;
  static generatePrompt(type: typeof PromptType.STORY_OBJECT_EDIT, context: StoryObjectEditPromptContext): string;
  static generatePrompt(type: typeof PromptType.CHAPTER_EDIT, context: ChapterEditPromptContext): string;
  static generatePrompt(type: PromptType, context?: unknown): string {
    switch (type) {
      case PromptType.CHAT_SYSTEM:
        return this.generateChatSystemPrompt(context as ChatSystemPromptContext | undefined);
      case PromptType.STORY_OBJECT_EDIT:
        return this.generateStoryObjectEditPrompt(context as StoryObjectEditPromptContext);
      case PromptType.CHAPTER_EDIT:
        return this.generateChapterEditPrompt(context as ChapterEditPromptContext);
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

  private static generateChatSystemPrompt(context: ChatSystemPromptContext = {}): string {
    const functionInstructions = this.buildFunctionInstructions(context);
    const language = this.resolveLanguage(context.outputLanguage);

    return this.renderTemplate(chatSystemTemplate, {
      var: {
        functionInstructions,
        language,
      },
    });
  }

  private static generateStoryObjectEditPrompt(context: StoryObjectEditPromptContext): string {
    const { category, targetId, contextData, currentData, jsonSchema, outputLanguage } = context;

    const categoryName = this.getCategoryDisplayName(category);
    const editScope = targetId ? 'a specific item' : 'the entire category';
    const language = this.resolveLanguage(outputLanguage);

    return this.renderTemplate(storyObjectEditTemplate, {
      var: {
        categoryName,
        editScope,
        language,
      },
      context: {
        contextData: this.formatContextData(contextData),
        currentData: this.formatJsonBlock(currentData),
        jsonSchema: this.formatJsonBlock(jsonSchema),
      },
    });
  }

  private static generateChapterEditPrompt(context: ChapterEditPromptContext): string {
    const { chapterName, currentContent, contextData, outputLanguage, userRequest } = context;

    const language = this.resolveLanguage(outputLanguage);

    return this.renderTemplate(chapterEditTemplate, {
      var: {
        chapterName,
        language,
        userRequest: userRequest || 'Please improve the chapter content.',
      },
      context: {
        contextData: this.formatContextData(contextData),
        currentContent: this.formatTextBlock(currentContent),
      },
    });
  }

  private static buildFunctionInstructions(context: ChatSystemPromptContext): string {
    if (!context.mode || !context.functions || context.functions.length === 0) {
      return '';
    }

    return this.FUNCTION_INSTRUCTION_TEMPLATES[context.mode] ?? '';
  }

  private static resolveLanguage(language?: string): string {
    const trimmed = language ? language.trim() : '';
    return trimmed.length > 0 ? trimmed : 'the language used by the user';
  }

  private static renderTemplate(template: string, placeholders: TemplatePlaceholders = {}): string {
    const placeholderRegex = /\{\{([a-zA-Z0-9_-]+)::([a-zA-Z0-9_.-]+)\}\}/g;

    return template.replace(placeholderRegex, (_, type: string, key: string) => {
      const group = placeholders[type as keyof TemplatePlaceholders];
      if (!group) {
        return '';
      }

      const value = group[key];
      return value ?? '';
    });
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
}
