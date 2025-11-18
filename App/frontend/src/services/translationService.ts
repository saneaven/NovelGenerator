import type { MutableRefObject } from 'react';
import type { LanguageData } from '../types/multilingual';
import type { ChatMessage } from '../llm_request/types';
import type { StoryObjects } from '../types/storyObject';
import { createEmptyStoryObjects } from '../types/storyObject';
import { ChatPipeline } from '../chat/ChatPipeline';
import { ChatManager, type ChatManagerConfig, type ChatManagerCallbacks } from '../chat/processors/ChatManager';
import { getTranslationFunctionSchema, type TranslationDataType } from '../chat/types/translationFunctionSchemas';
import { applyTranslationFunctionCalls, type TranslationContext } from '../chat/utils/translationFunctionApplicator';
import { useSettingsStore } from '../store/settingsStore';

interface TranslationRequestOptions {
  projectId: string;
  sourceLanguage: string;
  targetLanguage: string;
  dataType: TranslationDataType;
  sourceData: Record<string, any>;
  translationContext: TranslationContext;
  storyObjects?: StoryObjects;
  userMessage?: string;
}

/**
 * Translation status tracking for UI updates
 */
export interface TranslationStatus {
  objectId: string;
  isTranslating: boolean;
  error?: string;
}

/**
 * Translation Service - Utility methods for managing translations
 *
 * Note: Translation operations now use function calling via translationFunctionSchemas.ts
 * This service maintains only utility methods for translation state management.
 */
export class TranslationService {
  private static translationStatuses = new Map<string, TranslationStatus>();

  // ============================================
  // TRANSLATION STATUS MANAGEMENT
  // ============================================

  /**
   * Set translation status for UI updates
   */
  static setTranslationStatus(objectId: string, status: Partial<TranslationStatus>): void {
    const existing = this.translationStatuses.get(objectId) || { objectId, isTranslating: false };
    this.translationStatuses.set(objectId, { ...existing, ...status });
  }

  /**
   * Get translation status
   */
  static getTranslationStatus(objectId: string): TranslationStatus | null {
    return this.translationStatuses.get(objectId) || null;
  }

  /**
   * Clear translation status
   */
  static clearTranslationStatus(objectId: string): void {
    this.translationStatuses.delete(objectId);
  }

  /**
   * Clear all translation statuses
   */
  static clearAllTranslationStatuses(): void {
    this.translationStatuses.clear();
  }

  // ============================================
  // LANGUAGE DATA UTILITIES
  // ============================================

  /**
   * Check if data exists in specific language
   */
  static hasLanguageData<T>(languageData: LanguageData<T>, language: string): boolean {
    return languageData && typeof languageData === 'object' && language in languageData;
  }

  /**
   * Get available languages for data
   */
  static getAvailableLanguages<T>(languageData: LanguageData<T>): string[] {
    if (!languageData || typeof languageData !== 'object') return [];
    return Object.keys(languageData);
  }

  /**
   * Get best available language data with fallback logic
   */
  static getBestLanguageData<T>(
    languageData: LanguageData<T>,
    preferredLanguage: string,
    fallbackLanguage?: string
  ): { language: string; data: T } | null {
    if (!languageData || typeof languageData !== 'object') return null;

    // Try preferred language first
    if (preferredLanguage in languageData) {
      return { language: preferredLanguage, data: languageData[preferredLanguage] };
    }

    // Try fallback language
    if (fallbackLanguage && fallbackLanguage in languageData) {
      return { language: fallbackLanguage, data: languageData[fallbackLanguage] };
    }

    // Try any available language
    const availableLanguages = Object.keys(languageData);
    if (availableLanguages.length > 0) {
      const language = availableLanguages[0];
      return { language, data: languageData[language] };
    }

    return null;
  }

  /**
   * Add translated data to existing language data
   */
  static addTranslatedData<T>(
    existingLanguageData: LanguageData<T>,
    targetLanguage: string,
    translatedData: T
  ): LanguageData<T> {
    return {
      ...existingLanguageData,
      [targetLanguage]: translatedData,
    };
  }

  // ============================================
  // AI TRANSLATION WORKFLOW
  // ============================================

  /**
   * Run a translation request through the chat pipeline with translation function calling.
   */
  static async requestTranslation(options: TranslationRequestOptions): Promise<void> {
    const {
      projectId,
      sourceLanguage,
      targetLanguage,
      dataType,
      sourceData,
      translationContext,
      storyObjects,
      userMessage
    } = options;

    const settingsStore = useSettingsStore.getState();
    const translationConfig = settingsStore.getFunctionConfig('translation');
    const providerConfig = settingsStore.getProviderConfig(translationConfig.provider);
    const translationFunctionSchema = getTranslationFunctionSchema(dataType);
    const promptContext = {
      sourceLanguage,
      targetLanguage,
      dataType,
      sourceData,
      enablePrefill: translationConfig.advanced.enablePrefill,
      enableThinking: translationConfig.advanced.thinkingMode !== 'off',
    };

    const abortController = new AbortController();
    const abortControllerRef: MutableRefObject<AbortController | null> = { current: abortController };
    const chatPipeline = new ChatPipeline();
    const fallbackStoryObjects = storyObjects ?? createEmptyStoryObjects();
    const tempChatId = `temp-translation-${Date.now()}`;

    const chatManagerConfig: ChatManagerConfig = {
      projectId,
      getStoryObjects: () => fallbackStoryObjects,
      systemInsertConfig: {
        promptContext,
        promptType: 'translation',
      },
      chatPipeline,
      getIsLoading: () => false,
      setIsLoading: () => {},
      abortControllerRef,
      getActiveChatId: () => tempChatId,
      getConversationLanguage: () => targetLanguage,
      provider: translationConfig.provider,
      providerConfig,
      aiModel: translationConfig.model,
      temperature: translationConfig.temperature,
      providerPreference: translationConfig.providerPreference,
      functions: [translationFunctionSchema],
      mode: 'workspace',
      enablePrefill: translationConfig.advanced.enablePrefill,
      thinkingMode: translationConfig.advanced.thinkingMode as any,
      reasoningConfig: translationConfig.advanced.reasoningConfig,
    };

    const translationPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        abortControllerRef.current = null;
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      const callbacks: ChatManagerCallbacks = {
        onUpdateMessage: () => {},
        onSyncMessageToBackend: async () => {},
        onFunctionCalls: async (_projId, _chatId, _messageId, functionCalls) => {
          try {
            const results = await applyTranslationFunctionCalls(functionCalls, translationContext);
            const failure = results.find(result => !result.success);
            if (failure) {
              finish(new Error(failure.error || failure.message || 'Translation failed'));
            } else {
              finish();
            }
          } catch (error) {
            finish(error instanceof Error ? error : new Error('Failed to apply translation'));
          }
        },
        onAddMessage: async () => `msg-${Date.now()}`,
        onGetChatHistory: () => [],
        onError: (error) => {
          finish(error);
        },
      };

      const chatManager = new ChatManager(chatManagerConfig, callbacks);
      const userPrompt: ChatMessage = {
        id: `msg-user-${Date.now()}`,
        role: 'user',
        content: userMessage || `Please translate this ${dataType} from ${sourceLanguage} to ${targetLanguage}.`,
        timestamp: new Date(),
      };

      chatManager.processUserMessage(userPrompt)
        .catch(err => finish(err instanceof Error ? err : new Error('Translation request failed')));
    });

    await translationPromise;
  }
}


