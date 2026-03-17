import type { UnifiedObject, ObjectType as UnifiedObjectType } from '../../../types/unifiedObject';
import type { ObjectOperationVM, StoryEntityKind } from '../vmTypes';
import { objectTypeLabel } from '../../modules/objectToolMeta';

export interface ObjectSnapshot {
  id?: string;
  unifiedType?: UnifiedObjectType;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
  displayName?: string;
  object?: UnifiedObject;
}

function dataForLanguage(object: UnifiedObject | undefined, language: string): Record<string, unknown> {
  if (!object) return {};
  if (object.data?.[language]) {
    return object.data[language] as Record<string, unknown>;
  }

  const fallbackLanguage = Object.keys(object.data ?? {})[0];
  if (fallbackLanguage) {
    return object.data[fallbackLanguage] as Record<string, unknown>;
  }

  return {};
}

function storyEntityKindToUnifiedType(storyEntityKind?: StoryEntityKind): UnifiedObjectType | undefined {
  if (storyEntityKind === 'character' || storyEntityKind === 'location' || storyEntityKind === 'organization' || storyEntityKind === 'lorebook') {
    return 'story_entity';
  }
  return undefined;
}

function isSingletonUnifiedType(type: UnifiedObjectType): boolean {
  return type === 'basic_info' || type === 'guidelines';
}

export function resolveUnifiedType(operation: ObjectOperationVM): UnifiedObjectType | undefined {
  switch (operation.objectType) {
    case 'story_entity_folder':
      return 'story_entity_folder';
    case 'basic_info':
      return 'basic_info';
    case 'guidelines':
      return 'guidelines';
    case 'outline':
      return 'outline';
    case 'manuscript':
      return 'manuscript';
    case 'story_entity':
      return storyEntityKindToUnifiedType(operation.storyEntityKind);
    default:
      return undefined;
  }
}

function resolveByTypeAndId(
  objects: Record<string, UnifiedObject>,
  type: UnifiedObjectType,
  id?: string,
  projectId?: string
): UnifiedObject | undefined {
  if (id && objects[id]?.type === type) {
    return objects[id];
  }

  if (id) {
    return undefined;
  }

  if (!isSingletonUnifiedType(type)) {
    return undefined;
  }

  // Fallback for singleton-like objects (basic_info/guidelines)
  const all = Object.values(objects);
  return all.find((object) => {
    if (!object || object.type !== type) return false;
    if (!projectId) return true;
    return object.metadata?.project_id === projectId;
  });
}

function resolveObjectById(
  objects: Record<string, UnifiedObject>,
  id: string | undefined,
  type?: UnifiedObjectType,
): UnifiedObject | undefined {
  if (!id) return undefined;
  const object = objects[id];
  if (!object) return undefined;
  if (type && object.type !== type) return undefined;
  return object;
}

function resolveDisplayName(
  object: UnifiedObject | undefined,
  data: Record<string, unknown>,
  objects: Record<string, UnifiedObject>,
  language: string,
): string | undefined {
  if (!object) return undefined;

  if (object.type === 'basic_info') {
    if (typeof data.title === 'string' && data.title.trim()) return data.title;
    return 'Basic Info';
  }

  if (object.type === 'guidelines') {
    return 'Guidelines';
  }

  if (object.type === 'manuscript') {
    const chapterId = object.metadata?.chapter_id;
    if (typeof chapterId === 'string') {
      const chapter = objects[chapterId];
      if (chapter) {
        const chapterData = dataForLanguage(chapter, language);
        if (typeof chapterData.name === 'string' && chapterData.name.trim()) {
          return `Manuscript: ${chapterData.name}`;
        }
      }
    }
    return 'Manuscript';
  }

  if (typeof data.name === 'string' && data.name.trim()) {
    return data.name;
  }

  return undefined;
}

function fallbackOperationData(operation: ObjectOperationVM): Record<string, unknown> {
  const resultData = operation.result?.data;
  if (resultData && typeof resultData === 'object') {
    const object = (resultData as Record<string, unknown>).object;
    if (object && typeof object === 'object' && !Array.isArray(object)) {
      return object as Record<string, unknown>;
    }
  }
  return {};
}

export function getObjectSnapshot(params: {
  operation: ObjectOperationVM;
  objects: Record<string, UnifiedObject>;
  projectId?: string;
  language: string;
}): ObjectSnapshot {
  const { operation, objects, projectId, language } = params;
  const unifiedType = resolveUnifiedType(operation);

  if (!unifiedType) {
    return {
      id: operation.targetId,
      unifiedType: undefined,
      data: {},
      metadata: {},
      displayName: operation.targetLabel,
      object: undefined,
    };
  }

  const object = resolveByTypeAndId(objects, unifiedType, operation.targetId, projectId);
  const fallbackData = fallbackOperationData(operation);
  const data = object ? dataForLanguage(object, language) : fallbackData;
  const metadata = object
    ? ((object.metadata ?? {}) as unknown as Record<string, unknown>)
    : {};
  const fallbackDisplayName = typeof fallbackData.name === 'string' && fallbackData.name.trim()
    ? fallbackData.name
    : undefined;

  return {
    id: object?.id ?? operation.targetId,
    unifiedType,
    data,
    metadata,
    displayName: resolveDisplayName(object, data, objects, language) ?? fallbackDisplayName ?? operation.targetLabel,
    object,
  };
}

export function resolveObjectTitle(params: {
  operation: ObjectOperationVM;
  objects: Record<string, UnifiedObject>;
  projectId?: string;
  language: string;
}): { type: string; name: string | undefined } {
  const { operation, objects, projectId, language } = params;
  const resolvedObject = operation.targetId ? objects[operation.targetId] : undefined;
  const type = objectTypeLabel(
    operation.objectType,
    operation.storyEntityKind,
    operation.outlineKind ?? (resolvedObject?.type === 'outline' ? resolvedObject.kind as 'outline' | 'act' | 'chapter' | undefined : undefined),
  );

  const unifiedType = resolveUnifiedType(operation);
  if (operation.category === 'create') {
    const createdObjectId = typeof operation.result?.objectId === 'string'
      ? operation.result.objectId
      : undefined;
    const createdObject = unifiedType
      ? resolveObjectById(objects, createdObjectId, unifiedType)
      : undefined;
    if (createdObject) {
      const data = dataForLanguage(createdObject, language);
      const name = resolveDisplayName(createdObject, data, objects, language);
      if (name) return { type, name };
    }

    if (typeof operation.args.name === 'string' && operation.args.name.trim()) {
      return { type, name: operation.args.name };
    }

    if (typeof operation.args.title === 'string' && operation.args.title.trim()) {
      return { type, name: operation.args.title };
    }

    return { type, name: undefined };
  }

  if (unifiedType) {
    const object = resolveByTypeAndId(objects, unifiedType, operation.targetId, projectId);
    if (object) {
      const data = dataForLanguage(object, language);
      const name = resolveDisplayName(object, data, objects, language);
      if (name) return { type, name };
    }
  }

  const fallbackData = fallbackOperationData(operation);
  if (typeof fallbackData.name === 'string' && fallbackData.name.trim()) {
    return { type, name: fallbackData.name };
  }

  if (typeof operation.args.name === 'string' && operation.args.name.trim()) {
    return { type, name: operation.args.name };
  }

  if (typeof operation.args.title === 'string' && operation.args.title.trim()) {
    return { type, name: operation.args.title };
  }

  return { type, name: undefined };
}

export function pickExistingKeys(
  args: Record<string, unknown>,
  blockedKeys: string[] = []
): string[] {
  const blocked = new Set(blockedKeys);
  return Object.keys(args).filter((key) => !blocked.has(key));
}

export function pickValues(args: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in args) {
      next[key] = args[key];
    }
  }
  return next;
}
