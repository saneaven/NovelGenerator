import type { HandlerOptions } from '../../functionCall/apply/types';
import type { ApplicationResult } from '../../functionCall/types';
import { getObjectData } from '../../functionCall/types';
import { applySingleReplacement } from '../../utils/patchUtils';
import { docToMarkdown, markdownToDoc } from '../../editor/manuscript/convert';
import { docWordCount, normalizeDoc } from '../../editor/manuscript/doc';
import { FunctionCallBatchStore } from './FunctionCallBatchStore';

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

async function ensureManuscript(store: FunctionCallBatchStore, manuscriptId: string): Promise<any> {
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

  async applyPatch(params: {
    callId: string;
    args: Record<string, unknown>;
    store: FunctionCallBatchStore;
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
  }

  async applyReplace(params: {
    callId: string;
    args: Record<string, unknown>;
    store: FunctionCallBatchStore;
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

    // If manuscript exists, stage via markdown buffer (convert doc only once at flush).
    let manuscript = store.getObject(id);
    if (!manuscript) {
      await store.fetchObject('manuscript', id);
      manuscript = store.getObject(id);
    }

    if (manuscript) {
      const key = buildKey({ manuscriptId: id, language, createNewVersion });
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

    // Fallback: create a new manuscript if it doesn't exist (legacy behavior).
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
  }

  /**
   * Materialize all staged manuscript markdown buffers into TipTap docs and stage updateObject()
   * calls on the given store (one staged update per manuscript key).
   *
   * Important: call this BEFORE store.flush().
   */
  async stageAll(params: { store: FunctionCallBatchStore; yieldToUI?: () => Promise<void> }): Promise<void> {
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
