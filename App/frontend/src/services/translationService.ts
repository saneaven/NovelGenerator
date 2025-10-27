import type { ConversationBlock } from '../llm_request/types';
import type { LanguageData } from '../types/multilingual';
import { SystemPromptManager, PromptType, type TranslationPromptContext, type TranslationDataType } from '../chat/managers/SystemPromptManager';
import { PrefillManager, PrefillType, type TranslationPrefillContext } from '../chat/managers/PrefillManager';

// Translation request types
export interface TranslationRequest {
  sourceLanguage: string;
  targetLanguage: string;
  data: any;
  dataType: TranslationDataType;
  previousVersionData?: any; // Previous version data in target language for context
  enablePrefill?: boolean;
  enableThinking?: boolean;
}

export interface TranslationResult {
  messages: ConversationBlock[];
  expectedDataType: string;
}

export interface TranslationStatus {
  objectId: string;
  isTranslating: boolean;
  error?: string;
}

export class TranslationService {
  private static translationStatuses = new Map<string, TranslationStatus>();

  // Set translation status for UI updates
  static setTranslationStatus(objectId: string, status: Partial<TranslationStatus>): void {
    const existing = this.translationStatuses.get(objectId) || { objectId, isTranslating: false };
    this.translationStatuses.set(objectId, { ...existing, ...status });
  }

  // Get translation status
  static getTranslationStatus(objectId: string): TranslationStatus | null {
    return this.translationStatuses.get(objectId) || null;
  }

  // Clear translation status
  static clearTranslationStatus(objectId: string): void {
    this.translationStatuses.delete(objectId);
  }

  // Prepare translation request using SystemPromptManager
  static async prepareTranslationRequest(request: TranslationRequest): Promise<TranslationResult> {
    const promptContext: TranslationPromptContext = {
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      dataType: request.dataType,
      sourceData: request.data,
      previousVersionData: request.previousVersionData,
      enablePrefill: request.enablePrefill,
      enableThinking: request.enableThinking,
    };

    const systemPrompt = await SystemPromptManager.generatePrompt(PromptType.TRANSLATION, promptContext);

    // The user message is just the source data - the system prompt handles everything
    const userPrompt = `Please translate the following data:\n\n${JSON.stringify(request.data, null, 2)}`;

    const messages: ConversationBlock[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    // Add prefill if enabled
    if (request.enablePrefill) {
      const prefillContext: TranslationPrefillContext = {
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
        dataType: request.dataType
      };
      const prefill = PrefillManager.generatePrefill(PrefillType.TRANSLATION_ASSISTANT, prefillContext);
      if (prefill && prefill.trim().length > 0) {
        messages.push({ role: 'assistant', content: prefill });
      }
    }

    return {
      messages,
      expectedDataType: request.dataType,
    };
  }

  // Parse AI response (similar to aiEditService.parseAIResponse)
  static parseTranslationResponse(response: string): any {
    let jsonText = response.trim();

    // Extract JSON from markdown code blocks if present
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    }

    return JSON.parse(jsonText);
  }

  // Validate translation result
  static validateTranslationResult(result: any, dataType: TranslationDataType): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!result) {
      errors.push('Translation result is null or undefined');
      return { isValid: false, errors };
    }

    switch (dataType) {
      case 'nameDescription':
      case 'chapterData':
        if (typeof result.name !== 'string' || typeof result.description !== 'string') {
          errors.push('Invalid name-description translation format');
        }
        break;

      case 'basicInfo':
        if (typeof result.title !== 'string' || typeof result.logline !== 'string' || typeof result.genre !== 'string') {
          errors.push('Invalid basic info translation format');
        }
        break;

      case 'chapterContent':
        if (typeof result.content !== 'string' || typeof result.wordCount !== 'number') {
          errors.push('Invalid chapter content translation format');
        }
        break;

      case 'chatMessage':
        if (typeof result.content !== 'string') {
          errors.push('Invalid chat message translation format');
        }
        break;

      default:
        if (typeof result !== 'object') {
          errors.push('Invalid translation result format');
        }
        break;
    }

    return { isValid: errors.length === 0, errors };
  }

  // Helper method to check if data exists in specific language
  static hasLanguageData<T>(languageData: LanguageData<T>, language: string): boolean {
    return languageData && typeof languageData === 'object' && language in languageData;
  }

  // Helper method to get available languages for data
  static getAvailableLanguages<T>(languageData: LanguageData<T>): string[] {
    if (!languageData || typeof languageData !== 'object') return [];
    return Object.keys(languageData);
  }

  // Helper method to get best available language data (fallback logic)
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

  // Helper method to add translated data to existing language data
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

  // Clear all translation statuses
  static clearAllTranslationStatuses(): void {
    this.translationStatuses.clear();
  }
}
