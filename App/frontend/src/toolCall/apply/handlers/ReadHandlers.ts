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
import { ragService, type RagSearchResult as ApiRagSearchResult } from '../../../api/ragService';
import { useCredentialsStore } from '../../../store/credentialsStore';
import { useRagStore } from '../../../store/ragStore';
import { useSettingsStore } from '../../../store/settingsStore';

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
  const { queries } = args as {
    queries?: unknown;
  };

  if (!Array.isArray(queries) || queries.length === 0 || !queries.every(q => typeof q === 'string' && q.trim())) {
    return error('Invalid queries for rag_search (expected non-empty string[])');
  }

  const settings = useSettingsStore.getState().getSettingsOrThrow();
  const ragEnabled = settings.ragSearchEnabled;
  if (!ragEnabled) {
    return error('Embeddings are disabled (Settings > Search & Memory)');
  }

  const topKPerQuery = Math.max(1, settings.ragSearchTopKPerQuery);
  const neighborWindow = Math.max(0, settings.ragSearchNeighborWindow);
  const maxPrimary = Math.max(1, settings.ragSearchMaxPrimaryChunks);
  const maxTotal = Math.max(maxPrimary, settings.ragSearchMaxTotalChunks);

  const projectId = context.projectId;
  const profile = settings.embeddingConfigs?.ragSearch;
  if (!profile?.provider || !profile.model) {
    return error('RAG embedding profile is not configured (Settings > Search & Memory)');
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
    top_k_per_query: topKPerQuery,
    neighbor_window: neighborWindow,
    config,
  });

  useRagStore.getState().setResults(projectId, {
    queries: queries.map(q => String(q)),
    results: res.results as any,
    receivedAt: new Date().toISOString(),
  });

  const all = (Array.isArray(res.results) ? res.results : []) as ApiRagSearchResult[];
  if (all.length === 0) {
    return ok('RAG Results: 0', { count: 0 });
  }

  const primary = all.filter(r => typeof r.distance === 'number').slice(0, maxPrimary);

  const selected: ApiRagSearchResult[] = [...primary];
  const selectedChunkIds = new Set(primary.map(r => r.chunk_id));

  if (neighborWindow > 0 && selected.length < maxTotal) {
    const sourceIds = new Set(primary.map(r => r.source_id));
    for (const r of all) {
      if (selected.length >= maxTotal) break;
      if (!sourceIds.has(r.source_id)) continue;
      if (typeof r.distance === 'number') continue;
      if (selectedChunkIds.has(r.chunk_id)) continue;
      selectedChunkIds.add(r.chunk_id);
      selected.push(r);
    }
  }

  type Group = {
    objectType: string;
    objectId: string;
    bestDistance: number | null;
    items: ApiRagSearchResult[];
  };

  const groupsByObject = new Map<string, Group>();
  for (const r of selected) {
    const key = `${r.object_type}:${r.object_id}`;
    const existing = groupsByObject.get(key);
    if (!existing) {
      groupsByObject.set(key, {
        objectType: r.object_type,
        objectId: r.object_id,
        bestDistance: typeof r.distance === 'number' ? r.distance : null,
        items: [r],
      });
      continue;
    }
    existing.items.push(r);
    if (typeof r.distance === 'number') {
      existing.bestDistance = existing.bestDistance == null ? r.distance : Math.min(existing.bestDistance, r.distance);
    }
  }

  const groups = Array.from(groupsByObject.values()).sort((a, b) => {
    const ad = a.bestDistance ?? Number.POSITIVE_INFINITY;
    const bd = b.bestDistance ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    if (a.objectType !== b.objectType) return a.objectType.localeCompare(b.objectType);
    return a.objectId.localeCompare(b.objectId);
  });

  const lines: string[] = [];
  lines.push('RAG Results:');

  for (const g of groups) {
    const obj = context.store.getObject(g.objectId);
    let displayName = g.objectId;
    if (obj) {
      const data = getObjectData(obj, context.language);
      displayName = String((data as any).name ?? g.objectId);
    }

    if (neighborWindow > 0) {
      g.items.sort((a, b) => (a.chunk_index ?? 0) - (b.chunk_index ?? 0));
    } else {
      g.items.sort((a, b) => {
        const ad = typeof a.distance === 'number' ? a.distance : Number.POSITIVE_INFINITY;
        const bd = typeof b.distance === 'number' ? b.distance : Number.POSITIVE_INFINITY;
        if (ad !== bd) return ad - bd;
        return (a.chunk_index ?? 0) - (b.chunk_index ?? 0);
      });
    }

    lines.push('');
    lines.push(`<object type="${g.objectType}" id="${g.objectId}">`);
    lines.push(`${displayName}`);
    for (const item of g.items) {
      lines.push('<result>');
      lines.push(item.text);
      lines.push('</result>');
    }
    lines.push('</object>');
  }

  return ok(lines.join('\n'), { count: all.length, returned_chunks: selected.length, returned_objects: groups.length });
}

/**
 * Keyword search over already-indexed RAG chunks (no embeddings).
 */
export async function keywordSearch(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const keyword = args.keyword;
  const rawPage = args.page;

  if (typeof keyword !== 'string' || !keyword.trim()) {
    return error('Invalid keyword for keyword_search (expected non-empty string)');
  }

  const pageNumRaw = Number(rawPage ?? 1);
  const page = Number.isFinite(pageNumRaw) ? Math.max(1, Math.trunc(pageNumRaw)) : 1;

  const projectId = context.projectId;
  const res = await ragService.keywordSearch(projectId, keyword.trim(), page);

  const all = (Array.isArray(res.results) ? res.results : []) as ApiRagSearchResult[];
  if (all.length === 0) {
    return ok('Keyword Search Results: 0', { total: res.total, page: res.page, page_size: res.page_size, returned_chunks: 0 });
  }

  type Group = {
    objectType: string;
    objectId: string;
    items: ApiRagSearchResult[];
  };

  const groupsByObject = new Map<string, Group>();
  for (const r of all) {
    const key = `${r.object_type}:${r.object_id}`;
    const existing = groupsByObject.get(key);
    if (!existing) {
      groupsByObject.set(key, {
        objectType: r.object_type,
        objectId: r.object_id,
        items: [r],
      });
      continue;
    }
    existing.items.push(r);
  }

  const groups = Array.from(groupsByObject.values());

  const lines: string[] = [];
  lines.push('Keyword Search Results:');
  lines.push(`keyword: ${keyword.trim()}`);
  lines.push(`page: ${res.page} (page_size: ${res.page_size}, total: ${res.total}, returned: ${all.length})`);

  for (const g of groups) {
    const obj = context.store.getObject(g.objectId);
    let displayName = g.objectId;
    if (obj) {
      const data = getObjectData(obj, context.language);
      displayName = String((data as any).name ?? g.objectId);
    }

    g.items.sort((a, b) => {
      const ai = a.chunk_index ?? 0;
      const bi = b.chunk_index ?? 0;
      if (ai !== bi) return ai - bi;
      return String(a.field_path ?? '').localeCompare(String(b.field_path ?? ''));
    });

    lines.push('');
    lines.push(`<object type="${g.objectType}" id="${g.objectId}">`);
    lines.push(`${displayName}`);
    for (const item of g.items) {
      lines.push('<result>');
      lines.push(item.text);
      lines.push('</result>');
    }
    lines.push('</object>');
  }

  return ok(lines.join('\n'), { total: res.total, page: res.page, page_size: res.page_size, returned_chunks: all.length, returned_objects: groups.length });
}

// ============================================================================
// HANDLER REGISTRY
// ============================================================================

export const READ_HANDLERS: Record<string, Handler> = {
  read_story_object: readStoryObject,
  read_outline: readOutline,
  read_manuscript: readManuscript,
  keyword_search: keywordSearch,
  rag_search: ragSearch,
};
