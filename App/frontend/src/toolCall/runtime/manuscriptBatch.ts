import type { HandlerOptions } from '../apply/types';
import type { ApplicationResult } from '../types';
import { getObjectData } from '../types';
import { applySingleReplacement } from '../../utils/patchUtils';
import { docToMarkdown, markdownToDoc } from '../../editor/manuscript/convert';
import { docWordCount, normalizeDoc } from '../../editor/manuscript/doc';
import { ToolCallBatchStore } from './ToolCallBatchStore';

type ManuscriptBatchKey = string;

type ManuscriptBatchState = {
  manuscriptId: string;
  language: string;
  createNewVersion: boolean;
  userRequest: string;
  markdown: string;
  callIds: Set<string>;
};

function ok(message: string, data?: Record<string, unknown>): ApplicationResult {
  return { success: true, message, data };
}

function error(message: string, objectId?: string): ApplicationResult {
  return { success: false, message, error: message, objectId, objectType: 'manuscript' };
}

function normalizeOptions(options: HandlerOptions): Required<Pick<HandlerOptions, 'createNewVersion' | 'userRequest'>> {
  return {
    createNewVersion: options.createNewVersion ?? true,
    userRequest: options.userRequest ?? 'AI Edit',
  };
}

function buildKey(params: { manuscriptId: string; language: string; createNewVersion: boolean }): ManuscriptBatchKey {
  const { manuscriptId, language, createNewVersion } = params;
  return `${manuscriptId}:${language}:${createNewVersion ? 'new' : 'in_place'}`;
}

async function ensureManuscript(store: ToolCallBatchStore, manuscriptId: string): Promise<any> {
  let manuscript = store.getObject(manuscriptId);
  if (!manuscript) {
    await store.fetchObject('manuscript', manuscriptId);
    manuscript = store.getObject(manuscriptId);
  }
  if (!manuscript) {
    throw new Error(`manuscript with id ${manuscriptId} not found`);
  }
  return manuscript;
}

export class ManuscriptBatch {
  private readonly byKey = new Map<ManuscriptBatchKey, ManuscriptBatchState>();
  private readonly lockByKey = new Map<ManuscriptBatchKey, Promise<void>>();

  private async withKeyLock<T>(key: ManuscriptBatchKey, fn: () => Promise<T>): Promise<T> {
    const prev = this.lockByKey.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const tail = prev.then(() => next);
    this.lockByKey.set(key, tail);

    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.lockByKey.get(key) === tail) {
        this.lockByKey.delete(key);
      }
    }
  }

  async applyPatch(params: {
    callId: string;
    args: Record<string, unknown>;
    store: ToolCallBatchStore;
    language: string;
    options: HandlerOptions;
  }): Promise<ApplicationResult> {
    const { callId, args, store, language, options } = params;

    const { createNewVersion, userRequest } = normalizeOptions(options);
    const id = args.id as string | undefined;
    const oldText = args.old as string | undefined;
    const newText = args.new as string | undefined;

    if (!id || !oldText || newText === undefined) {
      return error('Missing required fields (id, old, new) for patch_manuscript', id);
    }

    const key = buildKey({ manuscriptId: id, language, createNewVersion });
    return this.withKeyLock(key, async () => {
      let state = this.byKey.get(key);

      if (!state) {
        const manuscript = await ensureManuscript(store, id);
        const currentData = getObjectData(manuscript, language);
        const currentDoc = normalizeDoc((currentData as any).doc);
        const currentMarkdown = docToMarkdown(currentDoc);

        state = {
          manuscriptId: id,
          language,
          createNewVersion,
          userRequest,
          markdown: currentMarkdown,
          callIds: new Set(),
        };
        this.byKey.set(key, state);
      }

      const result = applySingleReplacement(state.markdown, oldText, newText);
      if (!result.success) {
        return error(result.error ?? 'Patch failed', id);
      }

      state.markdown = result.value;
      state.callIds.add(callId);

      return ok('Updated manuscript', { id });
    });
  }

  async applyReplace(params: {
    callId: string;
    args: Record<string, unknown>;
    store: ToolCallBatchStore;
    projectId: string;
    language: string;
    options: HandlerOptions;
  }): Promise<ApplicationResult> {
    const { callId, args, store, projectId, language, options } = params;

    const { createNewVersion, userRequest } = normalizeOptions(options);
    const id = args.id as string | undefined;
    const content = args.content as string | undefined;

    if (!id || content === undefined) {
      return error('Missing id or content for replace_manuscript', id);
    }

    const key = buildKey({ manuscriptId: id, language, createNewVersion });
    return this.withKeyLock(key, async () => {
      // If manuscript exists, stage via markdown buffer (convert doc only once at flush).
      let manuscript = store.getObject(id);
      if (!manuscript) {
        await store.fetchObject('manuscript', id);
        manuscript = store.getObject(id);
      }

      if (manuscript) {
        const existing = this.byKey.get(key);
        const callIds = existing ? new Set([...existing.callIds, callId]) : new Set([callId]);
        this.byKey.set(key, {
          manuscriptId: id,
          language,
          createNewVersion,
          userRequest,
          markdown: content,
          callIds,
        });

        return ok('Updated manuscript', { id });
      }

      // Fallback: create a new manuscript if it doesn't exist.
      // Note: create endpoint requires TipTap JSON doc, so we must convert now.
      const nextDoc = markdownToDoc(content);
      const wordCount = docWordCount(nextDoc);

      const created = await store.createObject(
        'manuscript',
        projectId,
        { doc: nextDoc, wordCount },
        language,
        { chapter_id: id },
        userRequest
      );

      return ok('Updated manuscript', { id: created.id });
    });
  }

  /**
   * Materialize all staged manuscript markdown buffers into TipTap docs and stage updateObject()
   * calls on the given store (one staged update per manuscript key).
   *
   * Important: call this BEFORE store.flush().
   */
  async stageAll(params: { store: ToolCallBatchStore; yieldToUI?: () => Promise<void> }): Promise<void> {
    const { store, yieldToUI } = params;
    for (const state of this.byKey.values()) {
      const nextDoc = markdownToDoc(state.markdown);
      const wordCount = docWordCount(nextDoc);

      // Track flush failures against every successful patch/replace call by re-staging
      // the same final update under each callId.
      for (const callId of state.callIds) {
        store.beginCall(callId);
        await store.updateObject('manuscript', state.manuscriptId, {
          data: { doc: nextDoc, wordCount },
          language: state.language,
          create_new_version: state.createNewVersion,
          user_request: state.userRequest,
        });
        store.endCall();
      }

      if (yieldToUI) await yieldToUI();
    }

    this.byKey.clear();
  }
}
