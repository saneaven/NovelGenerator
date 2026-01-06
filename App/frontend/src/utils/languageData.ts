import type { LanguageData, LanguageDataEntry } from '../types/multilingual';

export function getBestLanguageData<T>(
  languageData: LanguageData<T>,
  preferredLanguage: string,
  fallbackLanguage?: string
): LanguageDataEntry<T> | null {
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

