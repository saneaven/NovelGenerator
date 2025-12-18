/**
 * Unified Translation Service
 *
 * Handles all translation operations using LLMTask.
 * - Story objects: set_* and patch_* translation functions
 * - Chat messages: dedicated chat translation flow via set_chat_message_translation
 */

import type { MutableRefObject } from 'react';
import type { LanguageData } from '../types/multilingual';
import {
  SET_FUNCTION_NAMES,
  PATCH_FUNCTION_NAMES,
  ALL_TRANSLATION_FUNCTION_NAMES,
  SET_CHAT_MESSAGE_TRANSLATION,
  FUNCTION_TO_OBJECT_TYPE,
} from '../llm/schemas/translationFunctions';
import { useSettingsStore } from '../store/settingsStore';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import type { ObjectType, UnifiedObject } from '../types/unifiedObject';
import type { FunctionCallMetadata, FunctionCallProgress, ContentPart } from '../llm/requestTypes';
import { translationService as translationAPI } from '../api/unifiedObjectService';
import { parseJsonOutput, parseStreamingItems, extractRawContent, type ParsedItem } from '../utils/nativeOutputParser';
import { LLMTask, LLMTaskMode, type StoryTranslationPromptContext, type ChatTranslationPromptContext } from '../llm';
import { applyTranslationFunctionCalls } from '../chat/utils/translationFunctionApplicator';

export interface StoryObjectToTranslate {
  objectType: ObjectType;
  objectId: string;
  sourceData: Record<string, any>;
  versionNumber?: number;
  /** Current translation in target language (if exists) */
  currentTranslation?: Record<string, any>;
}

export interface TranslationOptions {
  projectId: string;
  sourceLanguage: string;
  targetLanguage: string;
  userInput?: string;
  contextData?: Record<string, any>;
  /** IDs of objects to use as translation context (for terminology consistency) */
  contextObjectIds?: string[];
  onProgress?: (completed: string[]) => void;
  onError?: (error: Error) => void;
  onPartialSuccess?: (translations: TranslationResult[], error: Error) => void;
  abortControllerRef?: MutableRefObject<AbortController | null>;
  onStreamContent?: (content: string) => void;
  onStreamParsed?: (items: ParsedItem[]) => void;
  onStreamUpdate?: (contentParts: ContentPart[]) => void;
  onFunctionCallProgress?: (progressList: FunctionCallProgress[]) => void;
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
  versionNumber?: number;
  [key: string]: any;
}

export class TranslationService {
  static setTranslationStatus(objectId: string, status: Partial<TranslationStatus>): void {
    const store = useUnifiedObjectStore.getState();
    store.setTranslating(objectId, status.isTranslating ?? false);
  }

  static getTranslationStatus(objectId: string): TranslationStatus | null {
    const store = useUnifiedObjectStore.getState();
    const isTranslating = store.translating[objectId] ?? false;
    return { objectId, isTranslating };
  }

  static clearTranslationStatus(objectId: string): void {
    const store = useUnifiedObjectStore.getState();
    store.clearTranslating(objectId);
  }

  static clearAllTranslationStatuses(): void {
    const store = useUnifiedObjectStore.getState();
    Object.keys(store.translating).forEach(objectId => {
      store.clearTranslating(objectId);
    });
  }

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
    return { ...existingLanguageData, [targetLanguage]: translatedData };
  }

  /**
   * Get current translation data for objects that have translations in target language
   */
  static getCurrentTranslatedContents(
    objects: StoryObjectToTranslate[],
    targetLanguage: string
  ): Array<{ id: string; type: string; name: string; translatedContent: string }> {
    const store = useUnifiedObjectStore.getState();
    const result: Array<{ id: string; type: string; name: string; translatedContent: string }> = [];

    for (const obj of objects) {
      const storeObj = store.objects[obj.objectId] as UnifiedObject | undefined;
      if (!storeObj) continue;

      const translatedData = storeObj.data[targetLanguage];
      if (!translatedData) continue;

      // Format based on object type
      let translatedContent = '';
      if (obj.objectType === 'basic_info') {
        translatedContent = `Title: ${translatedData.title || ''}\nLogline: ${translatedData.logline || ''}\nGenre: ${translatedData.genre || ''}`;
      } else if (obj.objectType === 'manuscript') {
        translatedContent = translatedData.content || '';
      } else {
        translatedContent = `Name: ${translatedData.name || ''}\nDescription: ${translatedData.description || ''}`;
      }

      result.push({
        id: obj.objectId,
        type: obj.objectType,
        name: translatedData.name || translatedData.title || obj.objectId,
        translatedContent,
      });
    }

    return result;
  }

  static async translateObjects(
    objects: StoryObjectToTranslate[],
    options: TranslationOptions
  ): Promise<void> {
    const {
      projectId,
      sourceLanguage,
      targetLanguage,
      userInput,
      contextData,
      contextObjectIds,
      onProgress,
      onError,
      onPartialSuccess,
      abortControllerRef: providedAbortRef,
      onStreamContent,
      onStreamParsed,
      onStreamUpdate,
      onFunctionCallProgress: onFunctionCallProgressCallback,
      sessionId,
    } = options;

    if (objects.length === 0) {
      throw new Error('No objects to translate');
    }

    const settingsStore = useSettingsStore.getState();
    const translationConfig = settingsStore.getFunctionConfig('translation');
    const providerConfig = settingsStore.getProviderConfig(translationConfig.provider);
    const isNativeOutput = settingsStore.settings.nativeOutputMode;

    // Build objects array for prompt
    const objectsArray = objects.map(obj => ({
      objectType: obj.objectType,
      objectId: obj.objectId,
      ...obj.sourceData,
    }));

    // Get current translated contents for objects that have translations
    const currentTranslatedContents = this.getCurrentTranslatedContents(objects, targetLanguage);

    const abortController = new AbortController();
    const abortControllerRef: MutableRefObject<AbortController | null> = providedAbortRef || { current: abortController };
    if (providedAbortRef) providedAbortRef.current = abortController;

    const completed: string[] = [];
    const collectedTranslations: TranslationResult[] = [];

    const handleNativeOutput = async (text: string) => {
      const cleanedText = extractRawContent(text);
      const parsedItems = parseJsonOutput(cleanedText);

      if (parsedItems.length === 0) {
        throw new Error('AI did not return valid JSON output for translation.');
      }

      const translations: TranslationResult[] = [];

      for (const item of parsedItems) {
        // Handle function-style output
        const functionName = item.function;
        const id = item.id;

        if (!id) continue;

        const originalObj = objects.find(o => o.objectId === id);
        if (!originalObj) continue;

        // Determine object type from function name or item.type
        let objectType = originalObj.objectType;
        if (functionName && FUNCTION_TO_OBJECT_TYPE[functionName]) {
          const funcType = FUNCTION_TO_OBJECT_TYPE[functionName];
          if (funcType === 'object' && item.type) {
            objectType = item.type as ObjectType;
          } else if (funcType !== 'object' && funcType !== 'chapter') {
            objectType = funcType as ObjectType;
          } else if (funcType === 'chapter' && item.type) {
            objectType = item.type as ObjectType;
          }
        }

        // Build translation data
        const translationData: Record<string, any> = {};

        // Handle set functions
        if (!functionName || SET_FUNCTION_NAMES.has(functionName)) {
          if (item.name !== undefined) translationData.name = item.name;
          if (item.description !== undefined) translationData.description = item.description;
          if (item.title !== undefined) translationData.title = item.title;
          if (item.logline !== undefined) translationData.logline = item.logline;
          if (item.genre !== undefined) translationData.genre = item.genre;
          if (item.content !== undefined) {
            translationData.content = item.content;
            translationData.wordCount = item.content.split(/\s+/).filter(Boolean).length;
          }
        }

        // Handle patch functions - apply patches
        if (functionName && PATCH_FUNCTION_NAMES.has(functionName) && item.replacements) {
          // For patch, we need to apply replacements to current translation
          // This is handled by applyTranslationFunctionCalls, so convert to function call format
          const mockFunctionCall: FunctionCallMetadata = {
            id: crypto.randomUUID(),
            function_name: functionName,
            arguments: item,
            isApplied: false,
          };
          const results = await applyTranslationFunctionCalls([mockFunctionCall], targetLanguage);
          if (results[0]?.success && results[0]?.data) {
            Object.assign(translationData, results[0].data);
          }
          onProgress?.([id]);
          continue;
        }

        if (Object.keys(translationData).length > 0) {
          translations.push({
            objectType,
            objectId: id,
            versionNumber: originalObj.versionNumber,
            ...translationData,
          });
        }

        onProgress?.(translations.map(t => t.objectId));
      }

      if (translations.length === 0) {
        throw new Error('No valid translations parsed from AI output');
      }

      const batchData = translations.map(trans => {
        const { objectType, objectId, versionNumber, ...data } = trans;
        return { objectType: objectType as ObjectType, objectId, language: targetLanguage, data, targetVersionNumber: versionNumber };
      });

      const result = await translationAPI.addTranslations(batchData);

      // Update store directly with returned objects
      if (result.objects?.length) {
        const store = useUnifiedObjectStore.getState();
        result.objects.forEach(obj => {
          store.objects[obj.id] = obj;
        });
        useUnifiedObjectStore.setState({ objects: { ...store.objects } });
      }

      onProgress?.(translations.map(t => t.objectId));
    };

    const handleFunctionCalls = async (functionCalls: FunctionCallMetadata[]) => {
      const translationCalls = functionCalls.filter(fc => ALL_TRANSLATION_FUNCTION_NAMES.has(fc.function_name));

      if (translationCalls.length === 0) {
        throw new Error('AI did not call any translation functions');
      }

      // Use the applicator for all function calls
      const results = await applyTranslationFunctionCalls(translationCalls, targetLanguage);

      const successfulIds = results
        .filter(r => r.success && r.objectId)
        .map(r => r.objectId as string);

      if (successfulIds.length === 0) {
        throw new Error('No valid translations received from AI');
      }

      onProgress?.(successfulIds);
    };

    const promptContext: StoryTranslationPromptContext = {
      projectId,
      userInput: userInput || 'Translate the following objects.',
      sourceLanguage,
      targetLanguage,
      objectCount: objects.length,
      objectsArray,
      contextData,
      contextObjectIds,
      currentTranslatedContents,
      isNativeOutput,
      outputLanguage: targetLanguage,
      enablePrefill: translationConfig.advanced.enablePrefill,
      enableThinking: translationConfig.advanced.thinkingMode === 'model',
      enableCustomThinking: translationConfig.advanced.thinkingMode === 'custom',
    };

    const task = new LLMTask(
      {
        mode: LLMTaskMode.TRANSLATION,
        projectId,
        promptContext,
        abortControllerRef,
        sessionId,
        provider: translationConfig.provider,
        providerConfig,
        model: translationConfig.model,
        temperature: translationConfig.temperature,
        thinkingMode: translationConfig.advanced.thinkingMode as any,
        thinkingConfig: translationConfig.advanced.thinkingConfig,
        retryConfig: settingsStore.settings.retryConfig,
      },
      {
        onUpdate: (contentParts) => {
          onStreamUpdate?.(contentParts);

          if (isNativeOutput) {
            const text = contentParts.filter(part => part.type === 'content').map(part => part.text).join('');
            if (text) {
              onStreamContent?.(text);
              if (onStreamParsed) {
                const items = parseStreamingItems(text);
                if (items.length > 0) onStreamParsed(items);
              }
            }
          }
        },
        onComplete: async (result) => {
          try {
            if (isNativeOutput) {
              const text = result.contentParts.filter(part => part.type === 'content').map(part => part.text).join('');
              if (text.trim()) {
                await handleNativeOutput(text.trim());
              } else {
                throw new Error('AI did not generate any translation output');
              }
            } else {
              await handleFunctionCalls(result.functionCalls);
            }
          } catch (err) {
            if (onPartialSuccess && collectedTranslations.length > 0) {
              onPartialSuccess([...collectedTranslations], err instanceof Error ? err : new Error(String(err)));
            } else {
              onError?.(err instanceof Error ? err : new Error(String(err)));
            }
          }
        },
        onError: (error) => {
          if (onPartialSuccess && collectedTranslations.length > 0) {
            onPartialSuccess([...collectedTranslations], error);
          } else {
            onError?.(error);
          }
        },
        onFunctionProgress: isNativeOutput ? undefined : (progressList) => {
          onFunctionCallProgressCallback?.(progressList);

          const newIds: string[] = [];
          for (const progress of progressList) {
            const args = progress.draft.parsedArguments;
            const functionName = progress.draft.functionName;

            if (args?.id && !completed.includes(args.id) && ALL_TRANSLATION_FUNCTION_NAMES.has(functionName)) {
              newIds.push(args.id);

              const funcType = FUNCTION_TO_OBJECT_TYPE[functionName];
              let objectType = funcType;

              // For object and chapter types, use the type from args
              if ((funcType === 'object' || funcType === 'chapter') && args.type) {
                objectType = args.type;
              }

              if (objectType && args.id) {
                const { id, type, ...data } = args;
                const originalObj = objects.find(o => o.objectId === id);
                const existingIndex = collectedTranslations.findIndex(t => t.objectId === id);
                const translationResult: TranslationResult = {
                  objectType,
                  objectId: id,
                  versionNumber: originalObj?.versionNumber,
                  ...data,
                };

                if (existingIndex >= 0) {
                  collectedTranslations[existingIndex] = translationResult;
                } else {
                  collectedTranslations.push(translationResult);
                }
              }
            }
          }

          if (newIds.length > 0) {
            completed.push(...newIds);
            onProgress?.([...completed]);
          }
        },
      }
    );

    try {
      await task.run();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      throw error;
    }
  }

  static async applyPartialTranslations(
    translations: TranslationResult[],
    targetLanguage: string
  ): Promise<void> {
    if (translations.length === 0) {
      throw new Error('No translations to apply');
    }

    const batchData = translations.map(trans => {
      const { objectType, objectId, versionNumber, ...data } = trans;
      if (objectType === 'manuscript' && data.content) {
        data.wordCount = data.content.split(/\s+/).filter(Boolean).length;
      }
      return { objectType: objectType as ObjectType, objectId, language: targetLanguage, data, targetVersionNumber: versionNumber };
    });

    const result = await translationAPI.addTranslations(batchData);

    // Update store directly with returned objects
    if (result.objects?.length) {
      const store = useUnifiedObjectStore.getState();
      result.objects.forEach(obj => {
        store.objects[obj.id] = obj;
      });
      useUnifiedObjectStore.setState({ objects: { ...store.objects } });
    }
  }

  static async translateChatMessage(
    source: { content: string },
    options: {
      projectId: string;
      sourceLanguage: string;
      targetLanguage: string;
      userInput?: string;
      abortControllerRef?: MutableRefObject<AbortController | null>;
    }
  ): Promise<{ content: string }> {
    const { projectId, sourceLanguage, targetLanguage, userInput, abortControllerRef: providedAbortRef } = options;

    const settingsStore = useSettingsStore.getState();
    const translationConfig = settingsStore.getFunctionConfig('translation');
    const providerConfig = settingsStore.getProviderConfig(translationConfig.provider);
    const isNativeOutput = settingsStore.settings.nativeOutputMode;

    const abortController = new AbortController();
    const abortControllerRef: MutableRefObject<AbortController | null> = providedAbortRef || { current: abortController };
    if (providedAbortRef) providedAbortRef.current = abortController;

    return new Promise<{ content: string }>((resolve, reject) => {
      const promptContext: ChatTranslationPromptContext = {
        userInput: userInput || 'Translate the following message.',
        projectId,
        sourceLanguage,
        targetLanguage,
        sourceContent: source.content,
        isNativeOutput,
        outputLanguage: targetLanguage,
        enablePrefill: translationConfig.advanced.enablePrefill,
        enableThinking: translationConfig.advanced.thinkingMode === 'model',
        enableCustomThinking: translationConfig.advanced.thinkingMode === 'custom',
      };

      const task = new LLMTask(
        {
          mode: LLMTaskMode.CHAT_TRANSLATION,
          projectId,
          promptContext,
          abortControllerRef,
          provider: translationConfig.provider,
          providerConfig,
          model: translationConfig.model,
          temperature: translationConfig.temperature,
          thinkingMode: translationConfig.advanced.thinkingMode as any,
          thinkingConfig: translationConfig.advanced.thinkingConfig,
          retryConfig: settingsStore.settings.retryConfig,
        },
        {
          onUpdate: () => {},
          onComplete: (result) => {
            if (isNativeOutput) {
              const text = result.contentParts.filter(part => part.type === 'content').map(part => part.text).join('');
              if (text.trim()) {
                resolve({ content: extractRawContent(text.trim()) });
              } else {
                reject(new Error('AI did not generate any translation'));
              }
            } else {
              const translationCall = result.functionCalls.find(fc => fc.function_name === SET_CHAT_MESSAGE_TRANSLATION.name);
              if (!translationCall) {
                reject(new Error('AI did not call set_chat_message_translation function'));
                return;
              }

              try {
                const args = typeof translationCall.arguments === 'string'
                  ? JSON.parse(translationCall.arguments)
                  : translationCall.arguments;

                if (!args?.content) {
                  reject(new Error('Translation missing content field'));
                  return;
                }

                resolve({ content: args.content });
              } catch (err) {
                reject(err instanceof Error ? err : new Error('Failed to parse translation result'));
              }
            }
          },
          onError: reject,
        }
      );

      task.run().catch(reject);
    });
  }

  static async translateSingle(object: StoryObjectToTranslate, options: TranslationOptions): Promise<void> {
    return this.translateObjects([object], options);
  }

  static async translateBatch(objects: StoryObjectToTranslate[], options: TranslationOptions): Promise<void> {
    return this.translateObjects(objects, options);
  }
}

export const translateObjects = TranslationService.translateObjects.bind(TranslationService);
export const translateSingle = TranslationService.translateSingle.bind(TranslationService);
export const translateBatch = TranslationService.translateBatch.bind(TranslationService);
export const translateChatMessage = TranslationService.translateChatMessage.bind(TranslationService);
export const applyPartialTranslations = TranslationService.applyPartialTranslations.bind(TranslationService);
export const getCurrentTranslatedContents = TranslationService.getCurrentTranslatedContents.bind(TranslationService);
