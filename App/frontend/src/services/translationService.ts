/**
 * Unified Translation Service
 *
 * Core philosophy: reuse one pipeline for translation tasks.
 * - Story objects: type-specific translation functions (translate_character, translate_location, etc.)
 * - Chat messages: dedicated chat translation flow via translate_chat_message.
 *
 * This service handles all translation operations using LLMRequestManager.
 */

import type { MutableRefObject } from 'react';
import type { LanguageData } from '../types/multilingual';
import { LLMRequestPipeline } from '../chat/LLMRequestPipeline';
import { LLMRequestManager, type LLMRequestManagerConfig, type LLMRequestManagerCallbacks } from '../chat/sessions/LLMRequestManager';
import {
  TRANSLATION_FUNCTIONS,
  TRANSLATION_FUNCTION_TO_TYPE,
  TRANSLATION_FUNCTION_NAMES,
  TRANSLATE_CHAT_MESSAGE_FUNCTION,
} from '../chat/types/translationFunctionSchemas';
import { useSettingsStore } from '../store/settingsStore';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useNovelEditorStore } from '../store/novelEditorStore';
import type { ObjectType } from '../types/unifiedObject';
import type { FunctionCallMetadata, FunctionCallProgress, ContentPart } from '../llm_request/types';
import { translationService as translationAPI } from '../api/unifiedObjectService';
import { parseJsonOutput, parseStreamingItems, extractRawContent, type ParsedItem } from '../utils/nativeOutputParser';

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
  onPartialSuccess?: (translations: TranslationResult[], error: Error) => void;
  abortControllerRef?: MutableRefObject<AbortController | null>;
  /** Raw streaming content callback (native mode only) */
  onStreamContent?: (content: string) => void;
  /** Parsed items during streaming (native mode only) */
  onStreamParsed?: (items: ParsedItem[]) => void;
  /** Content parts callback (includes thinking) */
  onStreamUpdate?: (contentParts: ContentPart[]) => void;
  /** Function call progress callback (function calling mode only) */
  onFunctionCallProgress?: (progressList: FunctionCallProgress[]) => void;
  /** Session ID for updating llmTaskStore with streaming content */
  sessionId?: string;
}

export interface TranslationStatus {
  objectId: string;
  isTranslating: boolean;
  error?: string;
}

export interface TranslationResult {
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
  // ==========================================================================
  // TRANSLATION STATUS MANAGEMENT (delegates to unifiedObjectStore)
  // ==========================================================================

  /**
   * Set translation status for an object.
   * Uses the reactive Zustand store instead of a static Map.
   */
  static setTranslationStatus(objectId: string, status: Partial<TranslationStatus>): void {
    const store = useUnifiedObjectStore.getState();
    store.setTranslating(objectId, status.isTranslating ?? false);
  }

  /**
   * Get translation status for an object.
   * Reads from the reactive Zustand store.
   */
  static getTranslationStatus(objectId: string): TranslationStatus | null {
    const store = useUnifiedObjectStore.getState();
    const isTranslating = store.translating[objectId] ?? false;
    return { objectId, isTranslating };
  }

  /**
   * Clear translation status for an object.
   * Removes from the reactive Zustand store.
   */
  static clearTranslationStatus(objectId: string): void {
    const store = useUnifiedObjectStore.getState();
    store.clearTranslating(objectId);
  }

  /**
   * Clear all translation statuses.
   * Note: This clears via store's clearAllObjects which also clears translating state.
   */
  static clearAllTranslationStatuses(): void {
    // Clear all translating states by setting each to false
    const store = useUnifiedObjectStore.getState();
    Object.keys(store.translating).forEach(objectId => {
      store.clearTranslating(objectId);
    });
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
      onPartialSuccess,
      abortControllerRef: providedAbortRef,
      onStreamContent,
      onStreamParsed,
      onStreamUpdate,
      onFunctionCallProgress: onFunctionCallProgressCallback,
    } = options;

    if (objects.length === 0) {
      throw new Error('No objects to translate');
    }

    const settingsStore = useSettingsStore.getState();
    const translationConfig = settingsStore.getFunctionConfig('translation');
    const providerConfig = settingsStore.getProviderConfig(translationConfig.provider);
    const isNativeOutput = settingsStore.settings.nativeOutputMode;

    // Prepare objects array for prompt
    const objectsArray = objects.map(obj => ({
      objectType: obj.objectType,
      objectId: obj.objectId,
      ...obj.sourceData,
    }));

    const promptContext = {
      translationType: 'story' as const,
      sourceLanguage,
      targetLanguage,
      objectCount: objects.length,
      objectsArray,  // Pass array directly, not stringified
      userInstructions: userInstructions || '',
      enablePrefill: translationConfig.advanced.enablePrefill,
      enableThinking: false,
      enableCustomThinking: false,
      isNativeOutput,
    };

    const abortController = new AbortController();
    const abortControllerRef: MutableRefObject<AbortController | null> = providedAbortRef || { current: abortController };
    if (providedAbortRef) {
      providedAbortRef.current = abortController;
    }

    const chatPipeline = new LLMRequestPipeline();
    const completed: string[] = [];
    const collectedTranslations: TranslationResult[] = [];
    const systemInsertConfig = {
      ...LLMRequestPipeline.createDefaultSystemConfig(),
      enabled: true,
      includeProjectInfo: false,
      includeStoryObjects: false,
      includeNovelContent: false,
      promptContext,
      promptType: 'translation' as const,
    };

    // Native output handler for JSON parsing
    const handleNativeOutput = async (text: string) => {
      const cleanedText = extractRawContent(text);
      const parsedItems = parseJsonOutput(cleanedText);

      if (parsedItems.length === 0) {
        throw new Error('AI did not return valid JSON output for translation.');
      }

      // Map parsed items to translations using the original objects array for objectType
      const translations: TranslationResult[] = [];
      for (const item of parsedItems) {
        if (!item.id) continue;

        // Find the original object to get its type
        const originalObj = objects.find(o => o.objectId === item.id);
        if (!originalObj) {
          console.warn(`Could not find original object for id: ${item.id}`);
          continue;
        }

        const translationData: Record<string, any> = {};
        if (item.name !== undefined) translationData.name = item.name;
        if (item.description !== undefined) translationData.description = item.description;
        if (item.content !== undefined) {
          translationData.content = item.content;
          // Calculate word count for manuscript
          if (originalObj.objectType === 'manuscript') {
            translationData.wordCount = item.content.split(/\s+/).filter(Boolean).length;
          }
        }

        translations.push({
          objectType: originalObj.objectType,
          objectId: item.id,
          ...translationData,
        });

        // Report progress
        if (onProgress) {
          onProgress(translations.map(t => t.objectId));
        }
      }

      if (translations.length === 0) {
        throw new Error('No valid translations parsed from AI output');
      }

      // Prepare batch data for backend
      const batchData = translations.map(trans => {
        const { objectType, objectId, ...data } = trans;
        return {
          objectType: objectType as ObjectType,
          objectId,
          language: targetLanguage,
          data,
        };
      });

      // Send to backend using unified endpoint
      await translationAPI.addTranslations(batchData);

      // Update display language to show translated content immediately
      const { setDisplayLanguage } = useNovelEditorStore.getState();
      setDisplayLanguage(projectId, targetLanguage);

      // Final progress update
      if (onProgress) {
        onProgress(translations.map(t => t.objectId));
      }
    };

    const llmConfig: LLMRequestManagerConfig = {
      projectId,
      getStoryObjects: () => createEmptyStoryObjects(),
      systemInsertConfig,
      chatPipeline,
      provider: translationConfig.provider,
      providerConfig,
      aiModel: translationConfig.model,
      temperature: translationConfig.temperature,
      providerPreference: translationConfig.providerPreference,
      functions: isNativeOutput ? undefined : TRANSLATION_FUNCTIONS,
      toolChoice: isNativeOutput ? undefined : 'required',
      mode: 'workspace',
      enablePrefill: translationConfig.advanced.enablePrefill,
      thinkingMode: translationConfig.advanced.thinkingMode as any,
      thinkingConfig: translationConfig.advanced.thinkingConfig,
      retryConfig: settingsStore.settings.retryConfig,
      abortControllerRef,
      sessionId: options.sessionId,
    };

    const callbacks: LLMRequestManagerCallbacks = {
      onStreamUpdate: (contentParts) => {
        // Always pass content parts to user callback (for thinking display etc.)
        if (onStreamUpdate) onStreamUpdate(contentParts);

        // In native mode, pass streaming content to callbacks
        if (isNativeOutput) {
          const text = contentParts
            .filter(part => part.type === 'content')
            .map(part => part.text)
            .join('');
          if (text) {
            // Pass raw content
            if (onStreamContent) onStreamContent(text);

            // Parse and pass structured items
            if (onStreamParsed) {
              const items = parseStreamingItems(text);
              if (items.length > 0) onStreamParsed(items);
            }
          }
        }
        // Function mode: progress is tracked via onFunctionCallProgress
      },
      onFunctionCallProgress: isNativeOutput ? undefined : (progressList: FunctionCallProgress[]) => {
        // Pass to user callback
        if (onFunctionCallProgressCallback) onFunctionCallProgressCallback(progressList);
        // Extract IDs and full translation data from streaming function call arguments
        const newIds: string[] = [];
        for (const progress of progressList) {
          const args = progress.draft.parsedArguments;
          const functionName = progress.draft.functionName;

          if (args?.id && !completed.includes(args.id)) {
            newIds.push(args.id);

            // Also collect full translation data for partial success handling
            const objectType = TRANSLATION_FUNCTION_TO_TYPE[functionName];
            if (objectType && args.id) {
              const { id, ...data } = args;

              // Check if we already have this translation
              const existingIndex = collectedTranslations.findIndex(t => t.objectId === id);
              const translationResult: TranslationResult = {
                objectType,
                objectId: id,
                ...data,
              };

              if (existingIndex >= 0) {
                // Update existing (may have more complete data now)
                collectedTranslations[existingIndex] = translationResult;
              } else {
                collectedTranslations.push(translationResult);
              }
            }
          }
        }

        if (newIds.length > 0) {
          completed.push(...newIds);
          if (onProgress) {
            onProgress([...completed]);
          }
        }
      },
      onFunctionCalls: isNativeOutput ? undefined : async (functionCalls: FunctionCallMetadata[]) => {
        // Filter for translation function calls only
        const translationCalls = functionCalls.filter(
          fc => TRANSLATION_FUNCTION_NAMES.has(fc.function_name)
        );

        if (translationCalls.length === 0) {
          console.error('Available function calls:', functionCalls.map(fc => fc.function_name));
          throw new Error('AI did not call any translation functions');
        }

        // Accumulate translations from individual function calls
        const translations: TranslationResult[] = [];

        for (const call of translationCalls) {
          const objectType = TRANSLATION_FUNCTION_TO_TYPE[call.function_name];
          if (!objectType) continue;

          const args = typeof call.arguments === 'string'
            ? JSON.parse(call.arguments)
            : call.arguments;

          if (!args.id) {
            console.warn('Skipping translation call without id:', args);
            continue;
          }

          // Extract id and rest of the data
          const { id, ...data } = args;

          // manuscript인 경우 wordCount 자동 계산
          if (objectType === 'manuscript' && data.content) {
            data.wordCount = data.content.split(/\s+/).filter(Boolean).length;
          }

          translations.push({
            objectType,
            objectId: id,
            ...data,
          });

          // Report progress for each completed translation
          if (onProgress) {
            onProgress(translations.map(t => t.objectId));
          }
        }

        if (translations.length === 0) {
          throw new Error('No valid translations received from AI');
        }

        // Verify we got all expected translations
        if (translations.length !== objects.length) {
          console.warn(
            `Expected ${objects.length} translations but received ${translations.length}`
          );
        }

        // Prepare batch data for backend
        const batchData = translations.map(trans => {
          const { objectType, objectId, ...data } = trans;
          return {
            objectType: objectType as ObjectType,
            objectId,
            language: targetLanguage,
            data,
          };
        });

        // Send to backend using unified endpoint
        await translationAPI.addTranslations(batchData);

        // Update display language to show translated content immediately
        const { setDisplayLanguage } = useNovelEditorStore.getState();
        setDisplayLanguage(projectId, targetLanguage);

        // Final progress update
        if (onProgress) {
          onProgress(translations.map(t => t.objectId));
        }
      },
      onFinalMessage: isNativeOutput ? async (message) => {
        const text = message.contentParts
          ?.filter(part => part.type === 'content')
          .map(part => part.text)
          .join('') || '';
        if (text.trim()) {
          try {
            await handleNativeOutput(text.trim());
          } catch (err) {
            if (onError) {
              onError(err instanceof Error ? err : new Error('Failed to parse translation output'));
            }
          }
        } else {
          if (onError) {
            onError(new Error('AI did not generate any translation output'));
          }
        }
      } : undefined,
      onError: (error: Error) => {
        // If we have partial translations, call onPartialSuccess instead of onError
        if (onPartialSuccess && collectedTranslations.length > 0) {
          onPartialSuccess([...collectedTranslations], error);
        } else if (onError) {
          onError(error);
        }
      },
    };

    const llmManager = new LLMRequestManager(llmConfig, callbacks);

    try {
      await llmManager.run(null, {
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

  /**
   * Apply partial translations that were collected during a failed batch operation.
   * This sends the successfully parsed translations to the backend.
   */
  static async applyPartialTranslations(
    translations: TranslationResult[],
    targetLanguage: string
  ): Promise<void> {
    if (translations.length === 0) {
      throw new Error('No translations to apply');
    }

    // Prepare batch data for backend
    const batchData = translations.map(trans => {
      const { objectType, objectId, ...data } = trans;

      // manuscript인 경우 wordCount 자동 계산
      if (objectType === 'manuscript' && data.content) {
        data.wordCount = data.content.split(/\s+/).filter(Boolean).length;
      }

      return {
        objectType: objectType as ObjectType,
        objectId,
        language: targetLanguage,
        data,
      };
    });

    // Send to backend using unified endpoint
    await translationAPI.addTranslations(batchData);
  }

  /**
   * Translate a single chat message (content + optional thinking)
   */
  static async translateChatMessage(
    source: { content: string },
    options: {
      projectId: string;
      sourceLanguage: string;
      targetLanguage: string;
      userInstructions?: string;
      abortControllerRef?: MutableRefObject<AbortController | null>;
    }
  ): Promise<{ content: string }> {
    const {
      projectId,
      sourceLanguage,
      targetLanguage,
      userInstructions,
      abortControllerRef: providedAbortRef,
    } = options;

    const settingsStore = useSettingsStore.getState();
    const translationConfig = settingsStore.getFunctionConfig('translation');
    const providerConfig = settingsStore.getProviderConfig(translationConfig.provider);
    const isNativeOutput = settingsStore.settings.nativeOutputMode;

    const promptContext = {
      translationType: 'chat' as const,
      sourceLanguage,
      targetLanguage,
      sourceContent: source.content,
      userInstructions: userInstructions || '',
      enablePrefill: translationConfig.advanced.enablePrefill,
      enableThinking: false,
      enableCustomThinking: false,
      isNativeOutput,
    };

    const abortController = new AbortController();
    const abortControllerRef: MutableRefObject<AbortController | null> = providedAbortRef || { current: abortController };
    if (providedAbortRef) {
      providedAbortRef.current = abortController;
    }

    const chatPipeline = new LLMRequestPipeline();
    const systemInsertConfig = {
      ...LLMRequestPipeline.createDefaultSystemConfig(),
      enabled: true,
      includeProjectInfo: false,
      includeStoryObjects: false,
      includeNovelContent: false,
      promptContext,
      promptType: 'translation' as const,
    };

    let resolveTranslation!: (value: { content: string }) => void;
    let rejectTranslation!: (error: Error) => void;
    let translationSettled = false;
    const translationPromise = new Promise<{ content: string }>((resolve, reject) => {
      resolveTranslation = (value) => {
        translationSettled = true;
        resolve(value);
      };
      rejectTranslation = (error) => {
        translationSettled = true;
        reject(error);
      };
    });

    const llmConfig: LLMRequestManagerConfig = {
      projectId,
      getStoryObjects: () => createEmptyStoryObjects(),
      systemInsertConfig,
      chatPipeline,
      provider: translationConfig.provider,
      providerConfig,
      aiModel: translationConfig.model,
      temperature: translationConfig.temperature,
      providerPreference: translationConfig.providerPreference,
      functions: isNativeOutput ? undefined : [TRANSLATE_CHAT_MESSAGE_FUNCTION],
      toolChoice: isNativeOutput ? undefined : 'required',
      mode: 'workspace',
      enablePrefill: translationConfig.advanced.enablePrefill,
      thinkingMode: translationConfig.advanced.thinkingMode as any,
      thinkingConfig: translationConfig.advanced.thinkingConfig,
      retryConfig: settingsStore.settings.retryConfig,
      abortControllerRef,
    };

    const callbacks: LLMRequestManagerCallbacks = {
      onStreamUpdate: () => {},
      onFunctionCalls: isNativeOutput ? undefined : async (functionCalls: FunctionCallMetadata[]) => {
        const translationCall = functionCalls.find(fc => fc.function_name === TRANSLATE_CHAT_MESSAGE_FUNCTION.name);
        if (!translationCall) {
          rejectTranslation(new Error('AI did not call translate_chat_message function'));
          return;
        }

        try {
          const args = typeof translationCall.arguments === 'string'
            ? JSON.parse(translationCall.arguments)
            : translationCall.arguments;

          if (!args || !args.content) {
            rejectTranslation(new Error('Translation missing content field'));
            return;
          }

          resolveTranslation({
            content: args.content,
          });
        } catch (err) {
          rejectTranslation(err instanceof Error ? err : new Error('Failed to parse translation result'));
        }
      },
      onFinalMessage: isNativeOutput ? (message) => {
        const text = message.contentParts
          ?.filter(part => part.type === 'content')
          .map(part => part.text)
          .join('') || '';
        if (text.trim()) {
          // For chat translation, use raw text directly (no XML parsing needed)
          resolveTranslation({ content: extractRawContent(text.trim()) });
        } else {
          rejectTranslation(new Error('AI did not generate any translation'));
        }
      } : undefined,
      onError: (error: Error) => {
        rejectTranslation(error);
      },
    };

    const llmManager = new LLMRequestManager(llmConfig, callbacks);

    try {
      await llmManager.run(null, {
        history: [],
        language: targetLanguage,
      });
      if (!translationSettled) {
        rejectTranslation(new Error('No translation result returned by the AI'));
      }
      return await translationPromise;
    } finally {
      if (!providedAbortRef && abortControllerRef.current) {
        abortControllerRef.current = null;
      }
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
export const translateChatMessage = TranslationService.translateChatMessage.bind(TranslationService);
export const applyPartialTranslations = TranslationService.applyPartialTranslations.bind(TranslationService);
