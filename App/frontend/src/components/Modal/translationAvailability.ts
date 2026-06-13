import type { TranslationStatus } from '../../types/unifiedObject';

export type TranslationStatusByObjectId = Map<string, TranslationStatus>;

export function buildTranslationStatusByObjectId(
  statuses: TranslationStatus[],
): TranslationStatusByObjectId {
  return new Map(statuses.map((status) => [status.object_id, status]));
}

export function hasLanguageForObject(
  statusByObjectId: TranslationStatusByObjectId,
  objectId: string,
  dataByLanguage: Record<string, unknown> | undefined,
  language: string,
): boolean {
  if (!language) return false;
  const status = statusByObjectId.get(objectId);
  if (status) {
    return status.available_languages.includes(language);
  }
  return Object.prototype.hasOwnProperty.call(dataByLanguage ?? {}, language);
}

export function shouldOfferObjectForTranslation({
  statusByObjectId,
  objectId,
  dataByLanguage,
  sourceLanguage,
  targetLanguage,
  preSelected,
}: {
  statusByObjectId: TranslationStatusByObjectId;
  objectId: string;
  dataByLanguage: Record<string, unknown> | undefined;
  sourceLanguage: string;
  targetLanguage: string;
  preSelected: boolean;
}): boolean {
  if (!hasLanguageForObject(statusByObjectId, objectId, dataByLanguage, sourceLanguage)) {
    return false;
  }
  if (preSelected) {
    return true;
  }
  return !hasLanguageForObject(statusByObjectId, objectId, dataByLanguage, targetLanguage);
}

export function chooseTargetLanguageByMissingCount(
  statuses: TranslationStatus[],
  targetLanguages: string[],
): string {
  let bestLanguage = targetLanguages[0] ?? '';
  let maxMissing = -1;

  for (const language of targetLanguages) {
    const missing = statuses.filter((status) => status.missing_languages.includes(language)).length;
    if (missing > maxMissing) {
      maxMissing = missing;
      bestLanguage = language;
    }
  }

  return bestLanguage;
}
