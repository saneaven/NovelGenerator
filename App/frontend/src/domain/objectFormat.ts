/**
 * Rich-text format rules for unified objects.
 *
 * Single source of truth (moved out of the unifiedObjectStore god object).
 * - Which object types store rich text as TipTap vs markdown.
 * - Which fields per type carry rich text (used for the markdown preview query).
 */

import type { ObjectType, StoryEntityStructureObjectType } from '../types/unifiedObject';

export type RichFieldName = 'content' | 'authorNote';

/** story_entity + story_entity_folder are fetched/invalidated via the story-entity tree. */
export function isStoryEntityTreeType(type: ObjectType): type is StoryEntityStructureObjectType {
  return type === 'story_entity_folder' || type === 'story_entity';
}

/** Default rich-text format used when fetching/updating an object of this type. */
export function defaultRichTextFormatForType(type: ObjectType): 'tiptap' | 'markdown' {
  return (
    type === 'guidelines'
    || type === 'story_entity'
    || type === 'outline'
    || type === 'manuscript'
    || type === 'timeline_track'
    || type === 'timeline_event'
  )
    ? 'tiptap'
    : 'markdown';
}

/** Rich-text fields per object type (drives the markdown-preview sibling query). */
export const RICH_PREVIEW_FIELDS: Partial<Record<ObjectType, readonly RichFieldName[]>> = {
  guidelines: ['authorNote'],
  story_entity: ['content'],
  outline: ['content'],
  manuscript: ['content'],
  timeline_track: ['content'],
  timeline_event: ['content'],
};

/** True if the type has rich-text fields that need a markdown-rendered variant. */
export function isRichPreviewType(type: ObjectType): boolean {
  return Boolean(RICH_PREVIEW_FIELDS[type]);
}
