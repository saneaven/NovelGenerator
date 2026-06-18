/**
 * Query-key factory for unified objects.
 *
 * Hierarchy: ['objects', scope, ...ids, language, format].
 * Every level has a named prefix builder so invalidation is explicit and
 * format-agnostic. e.g. `collectionLang(pid, type, lang)` matches BOTH the
 * 'tiptap' and 'markdown' cached collections (invalidateQueries prefix-matches).
 */

import type { ObjectType } from '../../types/unifiedObject';

type RichTextFormat = 'tiptap' | 'markdown';
/**
 * Whether a collection/tree query carries heavy rich-text bodies.
 * 'summary' = backend include_content=false (labels/metadata/wordCount only).
 * Kept as the LAST key segment so all prefix builders (collectionLang, etc.)
 * still match both variants for invalidation.
 */
type CollectionVariant = 'full' | 'summary';

export const objectKeys = {
  all: ['objects'] as const,

  // ---- collections (list of one object type within a project) ----
  collectionsOf: (projectId: string) => [...objectKeys.all, 'collection', projectId] as const,
  collectionType: (projectId: string, type: ObjectType) =>
    [...objectKeys.collectionsOf(projectId), type] as const,
  collectionLang: (projectId: string, type: ObjectType, language: string) =>
    [...objectKeys.collectionType(projectId, type), language] as const,
  collection: (
    projectId: string,
    type: ObjectType,
    language: string,
    format: RichTextFormat = 'tiptap',
    variant: CollectionVariant = 'full',
  ) => [...objectKeys.collectionLang(projectId, type, language), format, variant] as const,

  // ---- story-entity tree (folders + entities, own endpoint) ----
  storyTreesOf: (projectId: string) => [...objectKeys.all, 'storyTree', projectId] as const,
  storyTreeLang: (projectId: string, language: string) =>
    [...objectKeys.storyTreesOf(projectId), language] as const,
  storyTree: (
    projectId: string,
    language: string,
    format: RichTextFormat = 'tiptap',
    variant: CollectionVariant = 'full',
  ) => [...objectKeys.storyTreeLang(projectId, language), format, variant] as const,

  // ---- single object ----
  allDetails: () => [...objectKeys.all, 'detail'] as const,
  detailOf: (type: ObjectType, id: string) => [...objectKeys.allDetails(), type, id] as const,
  detailLang: (type: ObjectType, id: string, language: string) =>
    [...objectKeys.detailOf(type, id), language] as const,
  detail: (type: ObjectType, id: string, language: string, format: RichTextFormat = 'tiptap') =>
    [...objectKeys.detailLang(type, id, language), format] as const,

  // ---- version history (metadata) + single version (content) ----
  versions: (type: ObjectType, id: string) => [...objectKeys.all, 'versions', type, id] as const,
  version: (type: ObjectType, id: string, versionId: string) =>
    [...objectKeys.versions(type, id), versionId] as const,

  // ---- translation status for a project (target languages) ----
  translationStatus: (projectId: string, targets: string[]) =>
    [...objectKeys.all, 'translationStatus', projectId, [...targets].sort()] as const,
};

export type { RichTextFormat as ObjectRichTextFormat, CollectionVariant as ObjectCollectionVariant };
