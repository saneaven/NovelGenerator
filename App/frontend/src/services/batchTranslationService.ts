/**
 * Batch Translation Service
 * Handles translation of multiple story objects in a single LLM request
 */

import type { MutableRefObject } from 'react';
import { ChatPipeline } from '../chat/ChatPipeline';
import { LLMRequestManager, type LLMRequestManagerConfig, type LLMRequestManagerCallbacks } from '../chat/sessions/LLMRequestManager';
import { TRANSLATE_BATCH_STORY_OBJECTS_FUNCTION } from '../chat/types/translationFunctionSchemas';
import { useSettingsStore } from '../store/settingsStore';
import type { ObjectType } from '../types/unifiedObject';
import type { FunctionCallMetadata, ContentPart, ChatMessage } from '../llm_request/types';
import unifiedObjectService from '../api/unifiedObjectService';

export interface StoryObjectToTranslate {
  objectType: ObjectType;
  objectId: string;
  sourceData: Record<string, any>;
}

export interface BatchTranslationOptions {
  projectId: string;
  objects: StoryObjectToTranslate[];
  sourceLanguage: string;
  targetLanguage: string;
  userInstructions?: string;
  onProgress?: (completed: string[]) => void;
  onError?: (error: Error) => void;
  abortControllerRef?: MutableRefObject<AbortController | null>;
}

interface TranslationResult {
  objectType: string;
  objectId: string;
  [key: string]: any;
}

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

/**
 * Request batch translation for multiple story objects
 */
export async function requestBatchTranslation(options: BatchTranslationOptions): Promise<void> {
  const {
    projectId,
    objects,
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
  const batchTranslationConfig = settingsStore.getFunctionConfig('batchTranslation');
  const providerConfig = settingsStore.getProviderConfig(batchTranslationConfig.provider);

  // Prepare objects array for prompt
  const objectsArray = objects.map(obj => ({
    objectType: obj.objectType,
    objectId: obj.objectId,
    ...obj.sourceData,
  }));

  const promptContext = {
    sourceLanguage,
    targetLanguage,
    objectCount: objects.length,
    objectsArray: JSON.stringify(objectsArray, null, 2),
    userInstructions: userInstructions || '',
    enablePrefill: batchTranslationConfig.advanced.enablePrefill,
    enableThinking: batchTranslationConfig.advanced.thinkingMode !== 'off',
  };

  const abortController = new AbortController();
  const abortControllerRef: MutableRefObject<AbortController | null> = providedAbortRef || { current: abortController };
  if (providedAbortRef) {
    providedAbortRef.current = abortController;
  }

  const chatPipeline = new ChatPipeline();
  const completed: string[] = [];

  const taskRunnerConfig: LLMRequestManagerConfig = {
    projectId,
    getStoryObjects: () => createEmptyStoryObjects(),
    systemInsertConfig: {
      promptContext,
      promptType: 'batchTranslation',
    },
    chatPipeline,
    provider: batchTranslationConfig.provider,
    providerConfig,
    aiModel: batchTranslationConfig.model,
    temperature: batchTranslationConfig.temperature,
    providerPreference: batchTranslationConfig.providerPreference,
    functions: [TRANSLATE_BATCH_STORY_OBJECTS_FUNCTION],
    mode: 'workspace',
    enablePrefill: batchTranslationConfig.advanced.enablePrefill,
    thinkingMode: batchTranslationConfig.advanced.thinkingMode as any,
    reasoningConfig: batchTranslationConfig.advanced.reasoningConfig,
    abortControllerRef,
  };

  const callbacks: LLMRequestManagerCallbacks = {
    onStreamUpdate: (contentParts: ContentPart[]) => {
      // Parse streaming JSON to track progress
      const textContent = contentParts
        .filter(p => p.type === 'content')
        .map(p => p.text)
        .join('');

      // Try to extract completed object IDs from partial JSON
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

      console.log('Batch translation function arguments:', args);

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
        return {
          objectType: objectType as ObjectType,
          objectId,
          language: targetLanguage,
          data,
        };
      });

      // Send to backend in single batch request
      await unifiedObjectService.batchAddTranslations(batchData);

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

  const taskRunner = new LLMRequestManager(taskRunnerConfig, callbacks);

  // Prepare user message
  const userMessageContent = userInstructions
    ? `Translate all objects with the following instructions:\n\n${userInstructions}`
    : 'Translate all provided objects';

  const userMessage: ChatMessage = {
    id: `msg-batch-translation-${Date.now()}`,
    role: 'user',
    content: userMessageContent,
    timestamp: new Date(),
  };

  try {
    await taskRunner.run(userMessage, {
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
