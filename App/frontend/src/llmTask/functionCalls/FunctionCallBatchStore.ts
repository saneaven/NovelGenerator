import type { ObjectType, UnifiedObject, UpdateObjectRequest } from '../../types/unifiedObject';
import type { StoreActions } from '../../functionCall/apply/types';

type UpdateKey = string;

type StagedUpdate = {
  key: UpdateKey;
  type: ObjectType;
  id: string;
  request: UpdateObjectRequest;
  callIds: Set<string>;
};

type FlushStatus = { success: true } | { success: false; reason: string };

function normalizeCreateNewVersion(value: UpdateObjectRequest['create_new_version']): boolean {
  return value ?? true;
}

function buildUpdateKey(params: {
  type: ObjectType;
  id: string;
  language: string;
  createNewVersion: boolean;
}): UpdateKey {
  const { type, id, language, createNewVersion } = params;
  return `${type}:${id}:${language}:${createNewVersion ? 'new' : 'in_place'}`;
}

function mergeMetadata(
  base: UpdateObjectRequest['metadata'] | undefined,
  next: UpdateObjectRequest['metadata'] | undefined
): UpdateObjectRequest['metadata'] | undefined {
  if (!base && !next) return undefined;
  return { ...(base ?? {}), ...(next ?? {}) };
}

/**
 * StoreActions wrapper that stages updateObject() calls and applies them at flush().
 *
 * - createObject/deleteObject are delegated immediately
 * - updateObject is staged (deduped by object+language+createNewVersion)
 *
 * This is scoped to a single apply run (create one instance per apply).
 */
export class FunctionCallBatchStore implements StoreActions {
  private readonly baseStore: StoreActions;

  private readonly cacheById = new Map<string, UnifiedObject>();
  private readonly stagedByKey = new Map<UpdateKey, StagedUpdate>();
  private readonly keysByCallId = new Map<string, Set<UpdateKey>>();

  private activeCallId: string | null = null;

  constructor(params: { baseStore: StoreActions }) {
    this.baseStore = params.baseStore;
  }

  beginCall(callId: string): void {
    this.activeCallId = callId;
  }

  endCall(): void {
    this.activeCallId = null;
  }

  getUpdateKeysForCall(callId: string): ReadonlySet<UpdateKey> {
    return this.keysByCallId.get(callId) ?? new Set();
  }

  private trackUpdateKey(callId: string, key: UpdateKey): void {
    const existing = this.keysByCallId.get(callId);
    if (existing) {
      existing.add(key);
      return;
    }
    this.keysByCallId.set(callId, new Set([key]));
  }

  private getObjectFromAny(id: string): UnifiedObject | null {
    return this.cacheById.get(id) ?? this.baseStore.getObject(id);
  }

  getObject(id: string): UnifiedObject | null {
    return this.getObjectFromAny(id);
  }

  async fetchObject(type: ObjectType, id: string): Promise<void> {
    // If we already have a cached (possibly staged) object, don't overwrite it.
    if (this.cacheById.has(id)) return;
    await this.baseStore.fetchObject(type, id);
  }

  async listObjects(type: ObjectType, projectId: string): Promise<UnifiedObject[]> {
    const objects = await this.baseStore.listObjects(type, projectId);
    return objects.map((obj) => this.cacheById.get(obj.id) ?? obj);
  }

  async createObject(
    type: ObjectType,
    projectId: string,
    data: Record<string, unknown>,
    language: string,
    metadata?: Record<string, unknown>,
    userRequest?: string
  ): Promise<UnifiedObject> {
    const created = await this.baseStore.createObject(type, projectId, data, language, metadata, userRequest);
    // Clear any stale staged state for the new object ID (shouldn't happen, but safe).
    this.cacheById.delete(created.id);
    return created;
  }

  async updateObject(type: ObjectType, id: string, request: UpdateObjectRequest): Promise<void> {
    const language = request.language;
    const createNewVersion = normalizeCreateNewVersion(request.create_new_version);
    const key = buildUpdateKey({ type, id, language, createNewVersion });

    const callId = this.activeCallId;
    if (callId) this.trackUpdateKey(callId, key);

    // Ensure we have an object to apply staged data onto.
    let current = this.getObjectFromAny(id);
    if (!current) {
      await this.baseStore.fetchObject(type, id);
      current = this.baseStore.getObject(id);
    }
    if (!current) {
      throw new Error(`${type} with id ${id} not found`);
    }

    const existing = this.stagedByKey.get(key);
    if (existing) {
      existing.request = {
        ...existing.request,
        // Always take latest computed data; merge with previously staged metadata.
        data: request.data,
        metadata: mergeMetadata(existing.request.metadata, request.metadata),
        user_request: request.user_request ?? existing.request.user_request,
        create_new_version: createNewVersion,
        language,
      };
      if (callId) existing.callIds.add(callId);
    } else {
      this.stagedByKey.set(key, {
        key,
        type,
        id,
        request: {
          ...request,
          create_new_version: createNewVersion,
        },
        callIds: callId ? new Set([callId]) : new Set(),
      });
    }

    // Apply staged changes to our local cache so later calls in the same batch see updated state.
    const prevLangData = (current.data?.[language] ?? {}) as Record<string, unknown>;
    const nextLangData = { ...prevLangData, ...(request.data as any) };
    const nextMetadata = request.metadata ? { ...(current.metadata as any), ...(request.metadata as any) } : current.metadata;

    this.cacheById.set(id, {
      ...current,
      metadata: nextMetadata,
      data: { ...(current.data ?? {}), [language]: nextLangData },
    });
  }

  async deleteObject(type: ObjectType, id: string): Promise<void> {
    // If the object is deleted, any staged updates for it are invalid.
    this.clearStagedForObject(id);
    this.cacheById.delete(id);
    await this.baseStore.deleteObject(type, id);
  }

  async flush(): Promise<Map<UpdateKey, FlushStatus>> {
    const results = new Map<UpdateKey, FlushStatus>();

    for (const [key, staged] of this.stagedByKey.entries()) {
      try {
        await this.baseStore.updateObject(staged.type, staged.id, staged.request);
        results.set(key, { success: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.set(key, { success: false, reason: message });
      }
    }

    this.stagedByKey.clear();
    this.cacheById.clear();
    return results;
  }

  private clearStagedForObject(objectId: string): void {
    for (const [key, staged] of this.stagedByKey.entries()) {
      if (staged.id !== objectId) continue;

      this.stagedByKey.delete(key);
      for (const callId of staged.callIds) {
        const keys = this.keysByCallId.get(callId);
        if (!keys) continue;
        keys.delete(key);
        if (keys.size === 0) this.keysByCallId.delete(callId);
      }
    }
  }
}
