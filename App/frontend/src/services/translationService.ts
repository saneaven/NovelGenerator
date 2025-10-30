import type { LanguageData } from '../types/multilingual';

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
}
