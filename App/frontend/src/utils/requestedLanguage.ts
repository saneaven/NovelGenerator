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

interface ResolveRequestedLanguageStateParams {
  availableLanguages: string[];
  requestedLanguage: string;
  mainLanguage: string;
}

function normalizeLanguages(languages: string[]): string[] {
  return [...new Set(languages.filter((language) => typeof language === 'string' && language.trim().length > 0))];
}

export function resolveRequestedLanguageState({
  availableLanguages,
  requestedLanguage,
  mainLanguage,
}: ResolveRequestedLanguageStateParams): RequestedLanguageState {
  const normalizedLanguages = normalizeLanguages(availableLanguages);
  const hasRequestedLanguage = normalizedLanguages.includes(requestedLanguage);
  const viewLanguage = hasRequestedLanguage
    ? requestedLanguage
    : normalizedLanguages.includes(mainLanguage)
      ? mainLanguage
      : normalizedLanguages[0] ?? requestedLanguage;
  const isMainLanguage = requestedLanguage === mainLanguage;

  return {
    requestedLanguage,
    viewLanguage,
    hasRequestedLanguage,
    isFallbackView: viewLanguage !== requestedLanguage,
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
