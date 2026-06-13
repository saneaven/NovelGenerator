export interface RequestedLanguageState {
  requestedLanguage: string;
  viewLanguage: string;
  hasRequestedLanguage: boolean;
  isFallbackView: boolean;
  canEdit: boolean;
  isMainLanguage: boolean;
  isTranslationView: boolean;
  createNewVersion: boolean;
}

export interface BackendLanguageState {
  requested_language: string;
  content_language: string | null;
  fallback_to: string | null;
  available_languages: string[];
  has_requested_language: boolean;
  is_fallback: boolean;
}

function normalizeLanguages(languages: string[]): string[] {
  return [...new Set(languages.filter((language) => typeof language === 'string' && language.trim().length > 0))];
}

export function requestedLanguageStateFromProjection(
  languageState: BackendLanguageState | undefined,
  mainLanguage: string,
): RequestedLanguageState {
  const requestedLanguage = languageState?.requested_language || mainLanguage;
  const viewLanguage = languageState?.content_language || requestedLanguage;
  const hasRequestedLanguage = Boolean(languageState?.has_requested_language);
  const isMainLanguage = requestedLanguage === mainLanguage;
  return {
    requestedLanguage,
    viewLanguage,
    hasRequestedLanguage,
    isFallbackView: Boolean(languageState?.is_fallback),
    canEdit: hasRequestedLanguage,
    isMainLanguage,
    isTranslationView: !isMainLanguage,
    createNewVersion: isMainLanguage,
  };
}

export function resolveTranslationSourceLanguage(availableLanguages: string[], mainLanguage: string): string {
  const normalizedLanguages = normalizeLanguages(availableLanguages);
  if (normalizedLanguages.includes(mainLanguage)) {
    return mainLanguage;
  }
  return normalizedLanguages[0] ?? mainLanguage;
}
