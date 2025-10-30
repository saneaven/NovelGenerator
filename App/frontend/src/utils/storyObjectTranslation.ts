import { TranslationService } from '../services/translationService';
import { useStoryObjectStore } from '../store/storyObjectStore';
import { useErrorStore } from '../store/errorStore';
import { useSettingsStore } from '../store/settingsStore';
import type { StoryObjectCategory } from '../types/storyObject';
import type { FunctionCallMetadata, ContentPart, ChatMessage } from '../llm_request/types';
import { ChatManager, type ChatManagerConfig, type ChatManagerCallbacks } from '../chat/processors/ChatManager';
import { ChatPipeline } from '../chat/ChatPipeline';
import { getTranslationFunctionSchema, type TranslationDataType } from '../chat/types/translationFunctionSchemas';
import { applyTranslationFunctionCalls, type TranslationContext } from '../chat/utils/translationFunctionApplicator';

export interface TranslateStoryObjectParams {
  projectId: string;
  category: StoryObjectCategory;
  itemId: string;
  sourceLanguage: string;
  targetLanguage: string;
  aiModel: string;
  onTranslating?: (isTranslating: boolean) => void;
  previousVersionData?: any;
}

/**
 * Translate a story object from one language to another using function calling
 */
export async function translateStoryObject(params: TranslateStoryObjectParams): Promise<void> {
  const {
    projectId,
    category,
    itemId,
    sourceLanguage,
    targetLanguage,
    aiModel,
    onTranslating,
    previousVersionData,
  } = params;

  const {
    getItemDataInLanguage,
    getStoryObjects,
  } = useStoryObjectStore.getState();

  const { showError } = useErrorStore.getState();

  // Get source data
  const sourceData = getItemDataInLanguage(projectId, category, itemId, sourceLanguage);
  if (!sourceData) {
    showError('Translation Failed', `No ${sourceLanguage} content available to translate.`);
    return;
  }

  try {
    onTranslating?.(true);
    TranslationService.setTranslationStatus(itemId, { objectId: itemId, isTranslating: true });

    // Determine data type based on category
    let dataType: TranslationDataType;
    if (category === 'basicInfo') {
      dataType = 'basicInfo';
    } else if (category === 'chapter') {
      dataType = 'chapterData';
    } else {
      dataType = 'nameDescription';
    }

    // Get translation function schema
    const translationFunctionSchema = getTranslationFunctionSchema(dataType);

    // Get provider config from settings
    const settingsStore = useSettingsStore.getState();
    const translationConfig = settingsStore.getFunctionConfig('translation');
    const providerConfig = settingsStore.getProviderConfig(translationConfig.provider);

    // Create temporary abort controller
    const abortController = new AbortController();
    const abortControllerRef = { current: abortController };

    // Promise to wait for translation result
    let resolveTranslation: (value: any) => void;
    let rejectTranslation: (error: Error) => void;
    const translationPromise = new Promise<any>((resolve, reject) => {
      resolveTranslation = resolve;
      rejectTranslation = reject;
    });

    // Setup ChatManager callbacks
    const callbacks: ChatManagerCallbacks = {
      onUpdateMessage: () => {
        // No-op for translation
      },
      onSyncMessageToBackend: async () => {
        // No-op for utility translation
      },
      onFunctionCalls: async (projId, chatId, messageId, functionCalls: FunctionCallMetadata[]) => {
        try {
          // Create translation context
          const translationContext: TranslationContext = {
            projectId,
            targetLanguage,
            category,
            itemId,
          };

          // Apply translation function calls
          const results = await applyTranslationFunctionCalls(functionCalls, translationContext);

          const failedResults = results.filter(r => !r.success);
          if (failedResults.length > 0) {
            rejectTranslation(new Error(`Translation failed: ${failedResults.map(r => r.error).join(', ')}`));
          } else {
            // Success!
            const result = results[0];
            resolveTranslation(result.data);
          }
        } catch (err) {
          console.error('Translation function application error:', err);
          rejectTranslation(err instanceof Error ? err : new Error('Failed to apply translation'));
        }
      },
      onAddMessage: async () => {
        return `msg-${Date.now()}`;
      },
      onGetChatHistory: () => {
        return [];
      },
      onError: (err) => {
        rejectTranslation(err);
      },
    };

    // Create ChatManager config
    const tempChatId = `temp-translation-${Date.now()}`;
    const chatManagerConfig: ChatManagerConfig = {
      projectId,
      getStoryObjects: () => getStoryObjects(projectId),
      systemInsertConfig: {
        promptContext: {
          sourceLanguage,
          targetLanguage,
          dataType,
          sourceData,
          previousVersionData,
          enablePrefill: translationConfig.advanced.enablePrefill,
          enableThinking: translationConfig.advanced.thinkingMode !== 'off',
        },
        promptType: 'translation',
      },
      chatPipeline: new ChatPipeline(),
      getIsLoading: () => false,
      setIsLoading: () => {},
      abortControllerRef,
      getActiveChatId: () => tempChatId,
      getConversationLanguage: () => targetLanguage,
      provider: translationConfig.provider,
      providerConfig,
      aiModel: aiModel || translationConfig.model,
      temperature: translationConfig.temperature,
      providerPreference: translationConfig.providerPreference,
      functions: [translationFunctionSchema],
      mode: 'workspace',
      enablePrefill: translationConfig.advanced.enablePrefill,
      thinkingMode: translationConfig.advanced.thinkingMode as any,
      reasoningConfig: translationConfig.advanced.reasoningConfig,
    };

    // Create ChatManager
    const chatManager = new ChatManager(chatManagerConfig, callbacks);

    // Process translation request
    const userMessage: ChatMessage = {
      id: `msg-user-${Date.now()}`,
      role: 'user',
      content: `Please translate this ${dataType} from ${sourceLanguage} to ${targetLanguage}`,
      timestamp: new Date(),
    };

    await chatManager.processUserMessage(userMessage);

    // Wait for translation result
    await translationPromise;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred during translation.';
    showError('Translation Failed', errorMessage);
    throw error;
  } finally {
    onTranslating?.(false);
    TranslationService.clearTranslationStatus(itemId);
  }
}

/**
 * Get display data for an item with fallback logic
 */
export function getDisplayDataForItem(
  projectId: string,
  category: StoryObjectCategory,
  itemId: string,
  requestedLanguage: string,
  primaryLanguage: string,
  secondaryLanguage: string | null
): {
  data: any | null;
  displayLanguage: string;
  hasRequestedLanguage: boolean;
  fallbackLanguage: string | null;
  availableLanguages: string[];
} {
  const {
    getItemDataInLanguage,
    hasItemDataInLanguage,
    getAvailableLanguagesForItem,
  } = useStoryObjectStore.getState();

  const availableLanguages = getAvailableLanguagesForItem(projectId, category, itemId);
  const hasRequestedLanguage = hasItemDataInLanguage(projectId, category, itemId, requestedLanguage);

  if (hasRequestedLanguage) {
    const data = getItemDataInLanguage(projectId, category, itemId, requestedLanguage);
    return {
      data,
      displayLanguage: requestedLanguage,
      hasRequestedLanguage: true,
      fallbackLanguage: null,
      availableLanguages,
    };
  }

  // Try to find fallback language
  let fallbackLanguage: string | null = null;
  let fallbackData: any = null;

  if (hasItemDataInLanguage(projectId, category, itemId, primaryLanguage)) {
    fallbackLanguage = primaryLanguage;
    fallbackData = getItemDataInLanguage(projectId, category, itemId, primaryLanguage);
  } else if (secondaryLanguage && hasItemDataInLanguage(projectId, category, itemId, secondaryLanguage)) {
    fallbackLanguage = secondaryLanguage;
    fallbackData = getItemDataInLanguage(projectId, category, itemId, secondaryLanguage);
  } else if (availableLanguages.length > 0) {
    fallbackLanguage = availableLanguages[0];
    fallbackData = getItemDataInLanguage(projectId, category, itemId, availableLanguages[0]);
  }

  return {
    data: fallbackData,
    displayLanguage: fallbackLanguage || requestedLanguage,
    hasRequestedLanguage: false,
    fallbackLanguage,
    availableLanguages,
  };
}
