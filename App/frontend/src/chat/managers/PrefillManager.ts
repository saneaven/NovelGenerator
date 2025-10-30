import type { StoryObjectCategory } from '../../types/storyObject';

import chatPrefillTemplate from './prompts/prefills/ChatPrefill.md?raw';
import storyObjectEditPrefillTemplate from './prompts/prefills/StoryObjectEditPrefill.md?raw';
import chapterEditPrefillTemplate from './prompts/prefills/ChapterEditPrefill.md?raw';
import translationPrefillTemplate from './prompts/prefills/TranslationPrefill.md?raw';
import { TemplateRenderer, type RenderContext } from '../utils/TemplateRenderer';
import { useSettingsStore, type AIFunctionType } from '../../store/settingsStore';

/**
 * Enum defining different types of assistant prefills
 */
const PREFILL_TYPE = {
  CHAT_ASSISTANT: 'chat_assistant',
  STORY_OBJECT_EDIT_ASSISTANT: 'story_object_edit_assistant',
  CHAPTER_EDIT_ASSISTANT: 'chapter_edit_assistant',
  TRANSLATION_ASSISTANT: 'translation_assistant',
} as const;

export type PrefillType = typeof PREFILL_TYPE[keyof typeof PREFILL_TYPE];
export const PrefillType = PREFILL_TYPE;

/**
 * Base interface for common prefill context
 */
export interface BasePrefillContext {
  outputLanguage?: string;
}

/**
 * Context for chat assistant prefills
 */
export interface ChatAssistantPrefillContext extends BasePrefillContext {
  mode?: 'novelEditor' | 'workspace';
  hasFunctions?: boolean;
}

/**
 * Context for story object editing prefills
 */
export interface StoryObjectEditPrefillContext extends BasePrefillContext {
  category: StoryObjectCategory;
  editScope?: string;
}

/**
 * Context for chapter editing prefills
 */
export interface ChapterEditPrefillContext extends BasePrefillContext {
  chapterName: string;
}

/**
 * Translation data type classification (matches SystemPromptManager)
 */
export type TranslationDataType =
  | 'nameDescription'
  | 'basicInfo'
  | 'chapterData'
  | 'chapterContent'
  | 'chatMessage'
  | 'general';

/**
 * Context for translation prefills
 */
export interface TranslationPrefillContext extends BasePrefillContext {
  sourceLanguage: string;
  targetLanguage: string;
  dataType: TranslationDataType;
}

/**
 * Centralized prefill manager that renders markdown templates with placeholders
 * Prefills are added as assistant role messages at the end of conversation to guide AI responses
 */
export class PrefillManager {
  /**
   * Generate prefill based on type and context - Overloaded for type safety
   */
  static generatePrefill(type: typeof PrefillType.CHAT_ASSISTANT, context?: ChatAssistantPrefillContext): string;
  static generatePrefill(type: typeof PrefillType.STORY_OBJECT_EDIT_ASSISTANT, context: StoryObjectEditPrefillContext): string;
  static generatePrefill(type: typeof PrefillType.CHAPTER_EDIT_ASSISTANT, context: ChapterEditPrefillContext): string;
  static generatePrefill(type: typeof PrefillType.TRANSLATION_ASSISTANT, context: TranslationPrefillContext): string;
  static generatePrefill(type: PrefillType, context?: unknown): string {
    switch (type) {
      case PrefillType.CHAT_ASSISTANT:
        return this.generateChatAssistantPrefill(context as ChatAssistantPrefillContext | undefined);
      case PrefillType.STORY_OBJECT_EDIT_ASSISTANT:
        return this.generateStoryObjectEditPrefill(context as StoryObjectEditPrefillContext);
      case PrefillType.CHAPTER_EDIT_ASSISTANT:
        return this.generateChapterEditPrefill(context as ChapterEditPrefillContext);
      case PrefillType.TRANSLATION_ASSISTANT:
        return this.generateTranslationPrefill(context as TranslationPrefillContext);
      default:
        throw new Error(`Unknown prefill type: ${type}`);
    }
  }

  /**
   * Validate prefill generation context
   */
  static validateContext(type: typeof PrefillType.STORY_OBJECT_EDIT_ASSISTANT, context: StoryObjectEditPrefillContext): { isValid: boolean; errors: string[] };
  static validateContext(type: typeof PrefillType.CHAPTER_EDIT_ASSISTANT, context: ChapterEditPrefillContext): { isValid: boolean; errors: string[] };
  static validateContext(type: typeof PrefillType.CHAT_ASSISTANT, context?: ChatAssistantPrefillContext): { isValid: boolean; errors: string[] };
  static validateContext(type: typeof PrefillType.TRANSLATION_ASSISTANT, context: TranslationPrefillContext): { isValid: boolean; errors: string[] };
  static validateContext(type: PrefillType, context?: unknown): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    const normalizedContext = (context ?? {}) as Record<string, unknown>;

    switch (type) {
      case PrefillType.STORY_OBJECT_EDIT_ASSISTANT: {
        const editContext = normalizedContext as Partial<StoryObjectEditPrefillContext>;
        if (!editContext?.category) {
          errors.push('Category is required for story object edit prefill');
        }
        break;
      }
      case PrefillType.CHAPTER_EDIT_ASSISTANT: {
        const chapterContext = normalizedContext as Partial<ChapterEditPrefillContext>;
        if (!chapterContext?.chapterName) {
          errors.push('Chapter name is required for chapter edit prefill');
        }
        break;
      }
      case PrefillType.TRANSLATION_ASSISTANT: {
        const translationContext = normalizedContext as Partial<TranslationPrefillContext>;
        if (!translationContext?.sourceLanguage) {
          errors.push('Source language is required for translation prefill');
        }
        if (!translationContext?.targetLanguage) {
          errors.push('Target language is required for translation prefill');
        }
        if (!translationContext?.dataType) {
          errors.push('Data type is required for translation prefill');
        }
        break;
      }
      case PrefillType.CHAT_ASSISTANT:
        // Chat assistant context is always valid (all properties are optional)
        break;
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Get available prefill types
   */
  static getAvailablePrefillTypes(): PrefillType[] {
    return Object.values(PrefillType);
  }

  /**
   * Map prefill type to AI function type for accessing per-function settings
   */
  private static mapPrefillTypeToFunctionType(prefillType: PrefillType): AIFunctionType {
    switch (prefillType) {
      case PrefillType.CHAT_ASSISTANT:
        return 'chat';
      case PrefillType.STORY_OBJECT_EDIT_ASSISTANT:
        return 'storyEdit';
      case PrefillType.CHAPTER_EDIT_ASSISTANT:
        return 'chapterGen';
      case PrefillType.TRANSLATION_ASSISTANT:
        return 'translation';
      default:
        throw new Error(`Unknown prefill type: ${prefillType}`);
    }
  }

  private static generateChatAssistantPrefill(context: ChatAssistantPrefillContext = {}): string {
    const language = this.resolveLanguage(context.outputLanguage);
    const mode = context.mode || 'workspace';
    const hasFunctions = context.hasFunctions ? 'yes' : 'no';
    const settings = useSettingsStore.getState().settings;
    const functionType = this.mapPrefillTypeToFunctionType(PrefillType.CHAT_ASSISTANT);
    const advancedSettings = settings.functionConfigs[functionType].advanced;

    const renderContext: RenderContext = {
      variables: {
        language,
        mode,
        hasFunctions,
      },
      conditionals: {
        thinking: advancedSettings.enableThinking,
        prefill: advancedSettings.enablePrefill,
      },
    };

    return TemplateRenderer.render(chatPrefillTemplate, renderContext);
  }

  private static generateStoryObjectEditPrefill(context: StoryObjectEditPrefillContext): string {
    const { category, editScope, outputLanguage } = context;

    const categoryName = this.getCategoryDisplayName(category);
    const language = this.resolveLanguage(outputLanguage);
    const scope = editScope || 'item';
    const settings = useSettingsStore.getState().settings;
    const functionType = this.mapPrefillTypeToFunctionType(PrefillType.STORY_OBJECT_EDIT_ASSISTANT);
    const advancedSettings = settings.functionConfigs[functionType].advanced;

    const renderContext: RenderContext = {
      variables: {
        categoryName,
        language,
        editScope: scope,
      },
      conditionals: {
        thinking: advancedSettings.enableThinking,
        prefill: advancedSettings.enablePrefill,
      },
    };

    return TemplateRenderer.render(storyObjectEditPrefillTemplate, renderContext);
  }

  private static generateChapterEditPrefill(context: ChapterEditPrefillContext): string {
    const { chapterName, outputLanguage } = context;

    const language = this.resolveLanguage(outputLanguage);
    const settings = useSettingsStore.getState().settings;
    const functionType = this.mapPrefillTypeToFunctionType(PrefillType.CHAPTER_EDIT_ASSISTANT);
    const advancedSettings = settings.functionConfigs[functionType].advanced;

    const renderContext: RenderContext = {
      variables: {
        chapterName,
        language,
      },
      conditionals: {
        thinking: advancedSettings.enableThinking,
        prefill: advancedSettings.enablePrefill,
      },
    };

    return TemplateRenderer.render(chapterEditPrefillTemplate, renderContext);
  }

  private static generateTranslationPrefill(context: TranslationPrefillContext): string {
    const { sourceLanguage, targetLanguage, dataType } = context;

    const dataTypeName = this.getDataTypeDisplayName(dataType);
    const settings = useSettingsStore.getState().settings;
    const functionType = this.mapPrefillTypeToFunctionType(PrefillType.TRANSLATION_ASSISTANT);
    const advancedSettings = settings.functionConfigs[functionType].advanced;

    const renderContext: RenderContext = {
      variables: {
        sourceLanguage,
        targetLanguage,
        dataTypeName,
      },
      conditionals: {
        thinking: advancedSettings.enableThinking,
        prefill: advancedSettings.enablePrefill,
      },
    };

    return TemplateRenderer.render(translationPrefillTemplate, renderContext);
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
}
