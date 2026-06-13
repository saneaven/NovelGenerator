import { describe, expect, it } from 'vitest';
import type { TranslationStatus } from '../../types/unifiedObject';
import {
  buildTranslationStatusByObjectId,
  chooseTargetLanguageByMissingCount,
  hasLanguageForObject,
  shouldOfferObjectForTranslation,
} from './translationAvailability';

function status(
  objectId: string,
  objectType: TranslationStatus['object_type'],
  availableLanguages: string[],
  missingLanguages: string[],
): TranslationStatus {
  return {
    object_id: objectId,
    object_type: objectType,
    available_languages: availableLanguages,
    missing_languages: missingLanguages,
    translation_coverage: 0,
  };
}

describe('translationAvailability', () => {
  it('uses backend status instead of projected local data for translated timeline events', () => {
    const statuses = buildTranslationStatusByObjectId([
      status('event-1', 'timeline_event', ['English', 'Korean'], []),
    ]);

    expect(hasLanguageForObject(statuses, 'event-1', ['English'], 'Korean')).toBe(true);
    expect(shouldOfferObjectForTranslation({
      statusByObjectId: statuses,
      objectId: 'event-1',
      availableLanguages: ['English'],
      sourceLanguage: 'English',
      targetLanguage: 'Korean',
      preSelected: false,
    })).toBe(false);
  });

  it('offers untranslated timeline tracks and events when status is missing the target language', () => {
    const statuses = buildTranslationStatusByObjectId([
      status('track-1', 'timeline_track', ['English'], ['Korean']),
      status('event-1', 'timeline_event', ['English'], ['Korean']),
    ]);

    for (const objectId of ['track-1', 'event-1']) {
      expect(shouldOfferObjectForTranslation({
        statusByObjectId: statuses,
        objectId,
        availableLanguages: ['English'],
        sourceLanguage: 'English',
        targetLanguage: 'Korean',
        preSelected: false,
      })).toBe(true);
    }
  });

  it('allows preselected retranslation but still requires source language availability', () => {
    const statuses = buildTranslationStatusByObjectId([
      status('event-1', 'timeline_event', ['English', 'Korean'], []),
      status('event-2', 'timeline_event', ['Korean'], ['English']),
    ]);

    expect(shouldOfferObjectForTranslation({
      statusByObjectId: statuses,
      objectId: 'event-1',
      availableLanguages: [],
      sourceLanguage: 'English',
      targetLanguage: 'Korean',
      preSelected: true,
    })).toBe(true);
    expect(shouldOfferObjectForTranslation({
      statusByObjectId: statuses,
      objectId: 'event-2',
      availableLanguages: [],
      sourceLanguage: 'English',
      targetLanguage: 'Korean',
      preSelected: true,
    })).toBe(false);
  });

  it('chooses the target language with the most backend-reported missing translations', () => {
    const statuses = [
      status('a', 'story_entity', ['English'], ['Korean', 'Japanese']),
      status('b', 'timeline_event', ['English', 'Japanese'], ['Korean']),
    ];

    expect(chooseTargetLanguageByMissingCount(statuses, ['Japanese', 'Korean'])).toBe('Korean');
  });
});
