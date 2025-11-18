/**
 * Unified Translation Service
 *
 * Core philosophy: Everything is a batch translation.
 * Single translations are just batches of size 1.
 *
 * This service handles both single and batch translation operations
 * using a unified pipeline with LLMRequestManager and batch function schema.
 */

import type { MutableRefObject } from 'react';
import type { LanguageData } from '../types/multilingual';
import { ChatPipeline } from '../chat/ChatPipeline';
import { LLMRequestManager, type LLMRequestManagerConfig, type LLMRequestManagerCallbacks } from '../chat/sessions/LLMRequestManager';
import { TRANSLATE_BATCH_STORY_OBJECTS_FUNCTION } from '../chat/types/translationFunctionSchemas';
import { useSettingsStore } from '../store/settingsStore';
import type { ObjectType } from '../types/unifiedObject';
import type { FunctionCallMetadata, ContentPart, ChatMessage } from '../llm_request/types';
import { translationService as translationAPI } from '../api/unifiedObjectService';

// ============================================================================
// TYPES
// ============================================================================

export interface StoryObjectToTranslate {
  objectType: ObjectType;
  objectId: string;
  sourceData: Record<string, any>;
}

export interface TranslationOptions {
  projectId: string;
  sourceLanguage: string;
  targetLanguage: string;
  userInstructions?: string;
  onProgress?: (completed: string[]) => void;
  onError?: (error: Error) => void;
  abortControllerRef?: MutableRefObject<AbortController | null>;
}

export interface TranslationStatus {
  objectId: string;
  isTranslating: boolean;
  error?: string;
}

interface TranslationResult {
  objectType: string;
  objectId: string;
  [key: string]: any;
}

// ============================================================================
// HELPERS
// ============================================================================

function createEmptyStoryObjects() {
  return {
    basicInfo: null,
    characters: [],
    organizations: [],
    locations: [],
    lorebook: [],
    outline: { acts: [] },
  };
}

// ============================================================================
// TRANSLATION SERVICE
// ============================================================================

export class TranslationService {
  private static translationStatuses = new Map<string, TranslationStatus>();

  // ==========================================================================
  // TRANSLATION STATUS MANAGEMENT
  // ==========================================================================

  static setTranslationStatus(objectId: string, status: Partial<TranslationStatus>): void {
    const existing = this.translationStatuses.get(objectId) || { objectId, isTranslating: false };
    this.translationStatuses.set(objectId, { ...existing, ...status });
  }

  static getTranslationStatus(objectId: string): TranslationStatus | null {
    return this.translationStatuses.get(objectId) || null;
  }

  static clearTranslationStatus(objectId: string): void {
    this.translationStatuses.delete(objectId);
  }

  static clearAllTranslationStatuses(): void {
    this.translationStatuses.clear();
  }

  // ==========================================================================
  // LANGUAGE DATA UTILITIES
  // ==========================================================================

  static hasLanguageData<T>(languageData: LanguageData<T>, language: string): boolean {
    return languageData && typeof languageData === 'object' && language in languageData;
  }

  static getAvailableLanguages<T>(languageData: LanguageData<T>): string[] {
    if (!languageData || typeof languageData !== 'object') return [];
    return Object.keys(languageData);
  }

  static getBestLanguageData<T>(
    languageData: LanguageData<T>,
    preferredLanguage: string,
    fallbackLanguage?: string
  ): { language: string; data: T } | null {
    if (!languageData || typeof languageData !== 'object') return null;

    if (preferredLanguage in languageData) {
      return { language: preferredLanguage, data: languageData[preferredLanguage] };
    }

    if (fallbackLanguage && fallbackLanguage in languageData) {
      return { language: fallbackLanguage, data: languageData[fallbackLanguage] };
    }

    const availableLanguages = Object.keys(languageData);
    if (availableLanguages.length > 0) {
      const language = availableLanguages[0];
      return { language, data: languageData[language] };
    }

    return null;
  }

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

  // ==========================================================================
  // CORE TRANSLATION METHOD (Unified for Single & Batch)
  // ==========================================================================

  /**
   * Translate objects (single or batch) using unified pipeline.
   * This is the core method that handles all translation operations.
   *
   * @param objects - Array of objects to translate (can be 1 or many)
   * @param options - Translation options including languages and callbacks
   */
  static async translateObjects(
    objects: StoryObjectToTranslate[],
    options: TranslationOptions
  ): Promise<void> {
    const {
      projectId,
      sourceLanguage,
      targetLanguage,
      userInstructions,
      onProgress,
      onError,
      abortControllerRef: providedAbortRef,
    } = options;

    if (objects.length === 0) {
      throw new Error('No objects to translate');
    }

    const settingsStore = useSettingsStore.getState();
    const translationConfig = settingsStore.getFunctionConfig('batchTranslation');
    const providerConfig = settingsStore.getProviderConfig(translationConfig.provider);

    // Prepare objects array for prompt
    const objectsArray = objects.map(obj => ({
      objectType: obj.objectType,
      objectId: obj.objectId,
      ...obj.sourceData,
    }));

    console.log('Input objects for translation:', objects.map(obj => ({
      objectType: obj.objectType,
      objectId: obj.objectId,
      objectIdType: typeof obj.objectId,
      hasObjectId: !!obj.objectId,
    })));

    const promptContext = {
      sourceLanguage,
      targetLanguage,
      objectCount: objects.length,
      objectsArray: JSON.stringify(objectsArray, null, 2),
      userInstructions: userInstructions || '',
      enablePrefill: translationConfig.advanced.enablePrefill,
      enableThinking: translationConfig.advanced.thinkingMode !== 'off',
    };

    console.log('Prompt context:', promptContext);

    const abortController = new AbortController();
    const abortControllerRef: MutableRefObject<AbortController | null> = providedAbortRef || { current: abortController };
    if (providedAbortRef) {
      providedAbortRef.current = abortController;
    }

    const chatPipeline = new ChatPipeline();
    const completed: string[] = [];

    const llmConfig: LLMRequestManagerConfig = {
      projectId,
      getStoryObjects: () => createEmptyStoryObjects(),
      systemInsertConfig: {
        promptContext,
        promptType: 'translation',
      },
      chatPipeline,
      provider: translationConfig.provider,
      providerConfig,
      aiModel: translationConfig.model,
      temperature: translationConfig.temperature,
      providerPreference: translationConfig.providerPreference,
      functions: [TRANSLATE_BATCH_STORY_OBJECTS_FUNCTION],
      mode: 'workspace',
      enablePrefill: translationConfig.advanced.enablePrefill,
      thinkingMode: translationConfig.advanced.thinkingMode as any,
      reasoningConfig: translationConfig.advanced.reasoningConfig,
      abortControllerRef,
    };

    const callbacks: LLMRequestManagerCallbacks = {
      onStreamUpdate: (contentParts: ContentPart[]) => {
        // Parse streaming JSON to track progress
        const textContent = contentParts
          .filter(p => p.type === 'content')
          .map(p => p.text)
          .join('');

        // Extract completed object IDs from partial JSON
        if (textContent.includes('objectId')) {
          const matches = textContent.match(/"objectId":\s*"([^"]+)"/g);
          if (matches && onProgress) {
            const ids = matches.map(m => m.match(/"objectId":\s*"([^"]+)"/)?.[1]).filter(Boolean) as string[];
            const newCompleted = ids.filter(id => !completed.includes(id));
            if (newCompleted.length > 0) {
              completed.push(...newCompleted);
              onProgress([...completed]);
            }
          }
        }
      },
      onFunctionCalls: async (functionCalls: FunctionCallMetadata[]) => {
        // Find the batch translation function call
        const batchCall = functionCalls.find(fc => fc.function_name === 'translate_batch_story_objects');
        if (!batchCall) {
          console.error('Available function calls:', functionCalls.map(fc => fc.function_name));
          throw new Error('AI did not call translate_batch_story_objects function');
        }

        // Parse the results
        const args = typeof batchCall.arguments === 'string'
          ? JSON.parse(batchCall.arguments)
          : batchCall.arguments;

        console.log('Translation function arguments:', args);

        const translations: TranslationResult[] = args.translations;

        if (!Array.isArray(translations) || translations.length === 0) {
          console.error('Invalid translations received:', {
            args,
            translationsType: typeof translations,
            translationsValue: translations,
            isArray: Array.isArray(translations),
            argsKeys: Object.keys(args || {}),
          });
          throw new Error(`No translations returned from AI. Received: ${JSON.stringify(args)}`);
        }

        // Prepare batch data for backend
        const batchData = translations.map(trans => {
          const { objectType, objectId, ...data } = trans;

          // Debug logging
          console.log('Processing translation:', {
            objectType,
            objectId,
            objectIdType: typeof objectId,
            hasObjectId: !!objectId,
            data
          });

          return {
            objectType: objectType as ObjectType,
            objectId,
            language: targetLanguage,
            data,
          };
        });

        console.log('Batch data to send to backend:', JSON.stringify(batchData, null, 2));

        // Send to backend using unified endpoint
        await translationAPI.addTranslations(batchData);

        // Update progress
        if (onProgress) {
          onProgress(translations.map(t => t.objectId));
        }
      },
      onError: (error: Error) => {
        if (onError) {
          onError(error);
        }
      },
    };

    const llmManager = new LLMRequestManager(llmConfig, callbacks);

    // Prepare user message
    const userMessageContent = objects.length === 1
      ? (userInstructions || `Translate this ${objects[0].objectType} from ${sourceLanguage} to ${targetLanguage}.`)
      : (userInstructions
          ? `Translate all objects with the following instructions:\n\n${userInstructions}`
          : 'Translate all provided objects');

    const userMessage: ChatMessage = {
      id: `msg-translation-${Date.now()}`,
      role: 'user',
      content: userMessageContent,
      timestamp: new Date(),
    };

    try {
      await llmManager.run(userMessage, {
        history: [],
        language: targetLanguage,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Silent abort
        return;
      }
      throw error;
    }
  }

  // ==========================================================================
  // CONVENIENCE WRAPPERS
  // ==========================================================================

  /**
   * Translate a single object (convenience wrapper for translateObjects with 1 item)
   */
  static async translateSingle(
    object: StoryObjectToTranslate,
    options: TranslationOptions
  ): Promise<void> {
    return this.translateObjects([object], options);
  }

  /**
   * Translate multiple objects (convenience wrapper for translateObjects)
   */
  static async translateBatch(
    objects: StoryObjectToTranslate[],
    options: TranslationOptions
  ): Promise<void> {
    return this.translateObjects(objects, options);
  }
}

// Export singleton instance methods for convenience
export const translateObjects = TranslationService.translateObjects.bind(TranslationService);
export const translateSingle = TranslationService.translateSingle.bind(TranslationService);
export const translateBatch = TranslationService.translateBatch.bind(TranslationService);
