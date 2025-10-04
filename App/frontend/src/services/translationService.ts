import type { ConversationBlock } from '../llm_request/types';
import type { LanguageData } from '../types/multilingual';

// Translation request types
export interface TranslationRequest {
  sourceLanguage: string;
  targetLanguage: string;
  data: any;
  dataType: 'nameDescription' | 'basicInfo' | 'chapterData' | 'chapterContent' | 'chatMessage';
  previousVersionData?: any; // Previous version data in target language for context
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

  // Generate system prompt for translation
  private static generateSystemPrompt(
    dataType: string,
    sourceLanguage: string,
    targetLanguage: string,
    hasPreviousVersion: boolean
  ): string {
    const basePrompt = `You are a professional translator. Translate the provided content from ${sourceLanguage} to ${targetLanguage}. `;

    const contextPrompt = hasPreviousVersion
      ? `\n\nIMPORTANT: A previous ${targetLanguage} version will be provided as context. Use it as reference to maintain consistency in terminology, style, and tone, but translate the current ${sourceLanguage} content accurately. The previous version helps you understand the original context and writing style.`
      : '';

    switch (dataType) {
      case 'nameDescription':
        return basePrompt + `You will receive a JSON object with 'name' and 'description' fields. Translate both fields while maintaining the meaning and context. Return only the JSON object with translated fields.` + contextPrompt;

      case 'basicInfo':
        return basePrompt + `You will receive a JSON object with 'title', 'logline', and 'genre' fields. Translate the title and logline while keeping the genre appropriate for the target language. Return only the JSON object with translated fields.` + contextPrompt;

      case 'chapterData':
        return basePrompt + `You will receive a JSON object with 'name' and 'description' fields representing a chapter. Translate both fields while maintaining narrative context. Return only the JSON object with translated fields.` + contextPrompt;

      case 'chapterContent':
        return basePrompt + `You will receive a JSON object with 'content' and 'wordCount' fields. Translate the content while maintaining literary style and narrative flow. Update the wordCount to reflect the translated content. Return only the JSON object with translated fields.` + contextPrompt;

      case 'chatMessage':
        return basePrompt + `You will receive a JSON object with a 'content' field representing a chat message. Translate the content while maintaining the conversational tone and meaning. Return only the JSON object with the translated field.` + contextPrompt;

      default:
        return basePrompt + `Translate the provided JSON object fields to ${targetLanguage}. Return only the translated JSON object.` + contextPrompt;
    }
  }

  // Prepare translation request (similar to aiEditService.prepareEditRequest)
  static prepareTranslationRequest(request: TranslationRequest): TranslationResult {
    const hasPreviousVersion = Boolean(request.previousVersionData);
    const systemPrompt = this.generateSystemPrompt(
      request.dataType,
      request.sourceLanguage,
      request.targetLanguage,
      hasPreviousVersion
    );

    let userPrompt: string;
    if (hasPreviousVersion) {
      userPrompt = `Previous ${request.targetLanguage} version (for context):\n${JSON.stringify(request.previousVersionData, null, 2)}\n\nCurrent ${request.sourceLanguage} content to translate:\n${JSON.stringify(request.data, null, 2)}`;
    } else {
      userPrompt = JSON.stringify(request.data);
    }

    const messages: ConversationBlock[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

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
  static validateTranslationResult(result: any, dataType: string): { isValid: boolean; errors: string[] } {
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
