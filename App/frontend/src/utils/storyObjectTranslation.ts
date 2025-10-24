import { TranslationService } from '../services/translationService';
import { useStoryObjectStore } from '../store/storyObjectStore';
import { useErrorStore } from '../store/errorStore';
import { useSettingsStore } from '../store/settingsStore';
import { streamChat } from '../llm_request/llmService';
import type { StoryObjectCategory } from '../types/storyObject';

export interface TranslateStoryObjectParams {
  projectId: string;
  category: StoryObjectCategory;
  itemId: string;
  sourceLanguage: string;
  targetLanguage: string;
  aiModel: string;
  onTranslating?: (isTranslating: boolean) => void;
  previousVersionData?: any; // Previous version data in target language for context
}

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
    addTranslatedDataToItem,
    getPreviousVersionDataInLanguage,
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
    let dataType: 'nameDescription' | 'basicInfo' | 'chapterData';
    if (category === 'basicInfo') {
      dataType = 'basicInfo';
    } else if (category === 'chapter') {
      dataType = 'chapterData';
    } else {
      dataType = 'nameDescription';
    }

    // Get previous version data if not provided
    const previousData = previousVersionData !== undefined
      ? previousVersionData
      : getPreviousVersionDataInLanguage(projectId, category, itemId, targetLanguage);

    // Get provider config from settings
    const settingsStore = useSettingsStore.getState();
    const translationConfig = settingsStore.getFunctionConfig('translation');
    const providerConfig = settingsStore.getProviderConfig(translationConfig.provider);

    const translationRequest = TranslationService.prepareTranslationRequest({
      sourceLanguage,
      targetLanguage,
      data: sourceData,
      dataType,
      previousVersionData: previousData,
      enablePrefill: translationConfig.advanced.enablePrefill,
      enableThinking: translationConfig.advanced.enableThinking,
    });

    let response = '';
    for await (const chunk of streamChat(
      translationRequest.messages,
      translationConfig.provider,
      providerConfig,
      {
        model: aiModel || translationConfig.model,
        temperature: translationConfig.temperature,
        providerPreference: translationConfig.providerPreference,
      }
    )) {
      if (typeof chunk === 'string') {
        response += chunk;
      } else if (chunk.content) {
        response += chunk.content;
      }
    }

    const parsed = TranslationService.parseTranslationResponse(response);
    const validation = TranslationService.validateTranslationResult(parsed, dataType);
    if (!validation.isValid) {
      throw new Error(validation.errors.join(', '));
    }

    // Add translated data to the item's active version
    addTranslatedDataToItem(projectId, category, itemId, targetLanguage, parsed);

    // Optionally sync flat fields if this is the current display language
    // This will be handled by the UI component based on user's language preference
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred during translation.';
    showError('Translation Failed', errorMessage);
    throw error;
  } finally {
    onTranslating?.(false);
    TranslationService.clearTranslationStatus(itemId);
  }
}

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
