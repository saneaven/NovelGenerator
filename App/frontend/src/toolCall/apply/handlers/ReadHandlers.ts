/**
 * Apply Handlers - Read
 *
 * Handlers for read operations:
 * - read_story_object: Read character, location, organization, lorebook, basic_info, or guidelines
 * - read_outline: Read outline, act, or chapter
 * - read_manuscript: Read manuscript content (with optional offset)
 */

import type { ApplicationResult } from '../../types';
import { getObjectData } from '../../types';
import type { Handler, HandlerContext } from '../types';
import { normalizeDoc } from '../../../editor/manuscript/doc';
import { docToMarkdown } from '../../../editor/manuscript/convert';
import { ragService } from '../../../api/ragService';
import { useCredentialsStore } from '../../../store/credentialsStore';
import { useRagStore } from '../../../store/ragStore';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function ok(message: string, data?: Record<string, unknown>): ApplicationResult {
  return { success: true, message, data };
}

function error(message: string): ApplicationResult {
  return { success: false, message, error: message };
}

// ============================================================================
// READ HANDLERS
// ============================================================================

/**
 * Read full content of a story object
 */
export async function readStoryObject(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, type } = args as { id?: string; type?: string };

  if (!id || !type) {
    return error('Missing id or type for read_story_object');
  }

  const obj = context.store.getObject(id);
  if (!obj) {
    return error(`Object not found: ${id}`);
  }

  const data = getObjectData(obj, context.language);
  let content: string;

  if (type === 'basic_info') {
    content = `Title: ${data.title ?? ''}\nLogline: ${data.logline ?? ''}\nGenre: ${data.genre ?? ''}`;
  } else if (type === 'guidelines') {
    content = (data.authorNote as string) ?? '';
  } else {
    content = `Name: ${data.name ?? ''}\nContent: ${data.content ?? ''}`;
  }

  return ok(content, { raw: data, objectId: id, objectType: type });
}

/**
 * Read full content of an outline item (outline, act, or chapter)
 */
export async function readOutline(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, type } = args as { id?: string; type?: string };

  if (!id) {
    return error('Missing id for read_outline');
  }

  const obj = context.store.getObject(id);
  if (!obj) {
    return error(`Outline item not found: ${id}`);
  }

  const data = getObjectData(obj, context.language);
  const content = `Name: ${data.name ?? ''}\nContent: ${data.content ?? ''}`;

  return ok(content, { raw: data, objectId: id, objectType: type ?? obj.type });
}

/**
 * Read manuscript content with optional offset
 */
export async function readManuscript(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, offset } = args as {
    id?: string;
    offset?: { from: number; to: number };
  };

  if (!id) {
    return error('Missing id for read_manuscript');
  }

  const manuscript = context.store.getObject(id);
  if (!manuscript) {
    return error(`Manuscript not found: ${id}`);
  }

  const data = getObjectData(manuscript, context.language);
  const doc = normalizeDoc((data as { doc?: unknown }).doc);
  let markdown = docToMarkdown(doc);
  const totalLength = markdown.length;

  // Apply offset if provided
  if (offset) {
    markdown = markdown.slice(offset.from, offset.to);
  }

  return ok(markdown, {
    wordCount: (data as { wordCount?: number }).wordCount,
    totalLength,
    offset: offset ?? null,
    objectId: id,
    objectType: 'manuscript',
  });
}

/**
 * RAG search over project knowledge base.
 * Stores full results in ragStore and returns a concise text payload for tool_results.
 */
export async function ragSearch(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { queries, top_k_per_query, neighbor_window } = args as {
    queries?: unknown;
    top_k_per_query?: number;
    neighbor_window?: number;
  };

  if (!Array.isArray(queries) || queries.length === 0 || !queries.every(q => typeof q === 'string' && q.trim())) {
    return error('Invalid queries for rag_search (expected non-empty string[])');
  }

  const projectId = context.projectId;
  const profile = await ragService.getProfile();
  if (!profile) {
    return error('RAG embedding profile is not configured (Settings > RAG Search)');
  }

  const provider = profile.provider;
  const creds = useCredentialsStore.getState().credentials as any;

  const config: any = {};
  if (provider === 'custom') {
    config.api_key = creds.custom?.apiKey || undefined;
    config.base_url = creds.custom?.baseUrl || undefined;
  } else {
    config.api_key = creds[provider]?.apiKey || undefined;
  }

  if (!config.api_key) {
    return error(`Missing API key for provider '${provider}' (Settings > Credentials)`);
  }
  if (provider === 'custom' && !config.base_url) {
    return error(`Missing baseUrl for custom provider (Settings > Credentials)`);
  }

  const res = await ragService.search(projectId, {
    queries: queries.map(q => String(q)),
    top_k_per_query: typeof top_k_per_query === 'number' ? top_k_per_query : undefined,
    neighbor_window: typeof neighbor_window === 'number' ? neighbor_window : undefined,
    config,
  });

  useRagStore.getState().setResults(projectId, {
    queries: queries.map(q => String(q)),
    results: res.results as any,
    receivedAt: new Date().toISOString(),
  });

  const maxReturn = 20;
  const items = (res.results ?? []).slice(0, maxReturn);

  const lines = items.map((r, i) => {
    const loc = [
      r.type_group,
      r.outline_order != null ? `outline=${r.outline_order}` : null,
      r.act_order != null ? `act=${r.act_order}` : null,
      r.chapter_order != null ? `chapter=${r.chapter_order}` : null,
      r.story_object_order != null ? `order=${r.story_object_order}` : null,
      `chunk=${r.chunk_index}`,
      `field=${r.field_path}`,
    ].filter(Boolean).join(', ');

    return `[#${i + 1}] ${r.object_type} (${loc})\n${r.text}`;
  });

  const message = lines.length
    ? `RAG results (ordered; showing ${lines.length}/${res.results.length}):\n\n${lines.join('\n\n')}`
    : 'RAG results: 0';

  return ok(message, { count: res.results.length });
}

// ============================================================================
// HANDLER REGISTRY
// ============================================================================

export const READ_HANDLERS: Record<string, Handler> = {
  read_story_object: readStoryObject,
  read_outline: readOutline,
  read_manuscript: readManuscript,
  rag_search: ragSearch,
};
