/**
 * Unified run context builder.
 *
 * buildRunContext(run)  — single entry point for ALL run types, ALL steps.
 * prepareRunMemory()    — archive/RAG/summarize, returns MemoryContext.
 *
 * The orchestrator calls these instead of scattering history/memory logic.
 */

import type { Run } from '../types';
import type {
  RunContext,
  RunExecutionConfig,
  RunTypeConfig,
  MemoryContext,
  PrepareMemoryParams,
  MemoryPreflightStage,
} from './types';
import type {
  AgentPromptContext,
  SubAgentPromptContext,
  MemorySummaryPromptContext,
} from '../../llm/types';
import type { ChatMessage, ContentPart, ToolCallMetadata } from '../../llm/requestTypes';
import type { ToolCallSchema } from '../../toolCall';
import { LLMTaskMode } from '../../llm/types';
import { PromptManager } from '../../llm/PromptManager';
import { createEmptyUserHistory } from '../../llm/requestTypes';
import { buildConversationBlocksWithMeta } from '../../llm/conversation/buildConversationBlocks';
import { startLLMSession } from '../../llmSession';
import { memoryService } from '../../api/memoryService';
import { useAgentStore } from '../../store/agentStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useCredentialsStore } from '../../store/credentialsStore';
import { useLLMSessionStore } from '../../store/llmSessionStore';
import { useAgentUIStore } from '../../store/agentUIStore';
import { useRuntimeStore } from '../store/runtimeStore';
import { useSubAgentStore } from '../../store/subAgentStore';
import { registerSessionNotification, updateSessionNotification } from '../../llmTask/notificationHelpers';
import { countTokens } from '../../services/tokenCountingService';
import { generateTempId } from '../../utils/tempId';
import { buildRunHistory, buildRunBackedHistory, buildSubAgentBackedHistory } from './buildRunHistory';
import { resolveRunTypeConfig } from './resolveRunTypeConfig';

// ---------------------------------------------------------------------------
// buildRunContext — the single entry point
// ---------------------------------------------------------------------------

/**
 * Build the complete context for a run step.
 * Works for root runs AND child runs — one pipeline.
 */
export async function buildRunContext(run: Run): Promise<RunContext> {
  const history = buildRunHistory(run);
  const memoryContext = getRunMemoryContext(run);
  const typeConfig = await resolveRunTypeConfig(run);
  const executionConfig = buildExecutionConfig(run, history, memoryContext, typeConfig);
  return { history, memoryContext, executionConfig };
}

// ---------------------------------------------------------------------------
// buildExecutionConfig — generic, never branches on run type
// ---------------------------------------------------------------------------

function buildExecutionConfig(
  run: Run,
  history: ChatMessage[],
  memoryContext: MemoryContext | null,
  typeConfig: RunTypeConfig,
): RunExecutionConfig {
  const settings = useSettingsStore.getState().getSettings();
  const outputMode = settings.nativeOutputMode ? 'native_tool_call' : 'tool_call';
  const memory = memoryContext ?? { previousSummaries: [], relevantChats: [] };

  const promptContext: AgentPromptContext | SubAgentPromptContext = {
    projectId: run.projectId,
    outputLanguage: run.language,
    outputMode,
    enable_prefill: typeConfig.enable_prefill,
    thinking_mode: typeConfig.thinkingMode,
    frozenProjectData: typeConfig.frozenProjectData as any,
    tools: typeConfig.toolSchemas,
    ...memory,
    ...typeConfig.promptFields,
  } as AgentPromptContext | SubAgentPromptContext;

  return {
    mode: typeConfig.mode,
    kind: typeConfig.kind,
    label: typeConfig.label,
    provider: typeConfig.provider,
    providerConfig: typeConfig.providerConfig,
    model: typeConfig.model,
    temperature: typeConfig.temperature,
    thinkingMode: typeConfig.thinkingMode,
    thinkingConfig: typeConfig.thinkingConfig,
    requestFormat: typeConfig.requestFormat,
    thinkingFormat: typeConfig.thinkingFormat,
    history,
    promptContext,
    toolSchemas: typeConfig.toolSchemas,
    toolChoice: typeConfig.toolChoice,
  };
}

// ---------------------------------------------------------------------------
// getRunMemoryContext — reads from run itself
// ---------------------------------------------------------------------------

function getRunMemoryContext(run: Run): MemoryContext | null {
  return run.memoryContext ?? null;
}

// ---------------------------------------------------------------------------
// prepareRunMemory — refactored from AgentMemoryManager.prepare()
// ---------------------------------------------------------------------------

const DEFAULT_POLICY = {
  maxContextTokens: 8192,
  reservedCompletionTokens: 2048,
  safetyMarginTokens: 256,
  maxArchiveLoops: 3,
} as const;

function getMessageText(msg: ChatMessage): string {
  return msg.contentParts
    .filter((p) => p.type === 'content')
    .map((p) => p.text)
    .join('');
}

function serializeConversationBlock(block: any): string {
  const contentText = Array.isArray(block.contentParts)
    ? block.contentParts.map((p: any) => p?.text ?? '').join('')
    : '';
  const toolCalls = block.tool_calls ? `\n<tool_calls>\n${JSON.stringify(block.tool_calls)}\n</tool_calls>` : '';
  const toolResults = block.tool_results ? `\n<tool_results>\n${JSON.stringify(block.tool_results)}\n</tool_results>` : '';
  return `${block.role}\n${contentText}${toolCalls}${toolResults}`.trim();
}

async function estimateTokens(text: string): Promise<number> {
  const res = await countTokens(text, 'openai', 'gpt-5');
  return res.tokenCount;
}

function sliceAfterBoundary(history: ChatMessage[], boundaryMessageId: string | null): ChatMessage[] {
  if (!boundaryMessageId) return history;
  const idx = history.findIndex((m) => m.id === boundaryMessageId);
  if (idx === -1) return history;
  return history.slice(idx + 1);
}

function chooseArchiveBoundaryForBudget(
  orderedMessageIds: string[],
  messageTokenMap: Record<string, number>,
  totalTokens: number,
  budgetTokens: number
): string | null {
  if (orderedMessageIds.length === 0) return null;
  const requiredRemoval = totalTokens - budgetTokens;
  if (requiredRemoval <= 0) return null;

  let acc = 0;
  let boundary: string | null = null;
  for (const id of orderedMessageIds) {
    acc += messageTokenMap[id] || 0;
    boundary = id;
    if (acc >= requiredRemoval) break;
  }
  if (!boundary) return null;
  if (acc <= 0) return null;
  return boundary;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

function parseCustomAdditionalHeaders(raw: unknown): Record<string, string> | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const headers = Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, value]) => typeof value === 'string')
    ) as Record<string, string>;
    return Object.keys(headers).length > 0 ? headers : undefined;
  } catch {
    return undefined;
  }
}

function getLlmMode(runMode: string) {
  return runMode === 'planMode' ? LLMTaskMode.AGENT_PLAN_MODE : LLMTaskMode.AGENT_AGENT_MODE;
}

type ToolCallLocator = { kind: 'id'; id: string } | { kind: 'index'; index: number };

function parseToolCallLocatorFromFieldPath(fieldPath?: string | null): ToolCallLocator | null {
  if (!fieldPath) return null;
  if (!fieldPath.startsWith('tool_calls/')) return null;
  const rest = fieldPath.slice('tool_calls/'.length);
  if (!rest) return null;

  if (rest.startsWith('index/')) {
    const raw = rest.slice('index/'.length).split('/')[0] ?? '';
    const index = Number(raw);
    if (!Number.isFinite(index)) return null;
    const i = Math.trunc(index);
    if (i < 0) return null;
    return { kind: 'index', index: i };
  }

  const id = rest.split('/')[0] ?? '';
  if (!id) return null;
  return { kind: 'id', id };
}

type RelevantChatToolCall = {
  id?: string;
  name: string;
  status: string;
  result: string;
};

function getResultMessageOrReason(status: string | undefined, toolCall?: any): string {
  const s = String(status || '').trim();
  if (s === 'accepted') return String(toolCall?.result?.message || 'Applied successfully');
  if (s === 'rejected') return String(toolCall?.reason || 'User rejected');
  if (s === 'failed') return String(toolCall?.reason || 'Unknown error');
  return 'Pending';
}

function toRelevantChatToolCall(tc: any): RelevantChatToolCall {
  const status = String(tc?.status || 'pending');
  return {
    id: typeof tc?.id === 'string' ? tc.id : undefined,
    name: String(tc?.tool_name || ''),
    status,
    result: getResultMessageOrReason(status, tc),
  };
}

function getToolCallsForPrompt(msg?: ChatMessage): RelevantChatToolCall[] | undefined {
  if (!msg?.toolCalls || msg.toolCalls.length === 0) return undefined;
  return msg.toolCalls.map((tc) => toRelevantChatToolCall(tc));
}

function getMatchedToolCallForPrompt(args: {
  fieldPath?: string | null;
  localMessage?: ChatMessage;
}): RelevantChatToolCall | undefined {
  const fieldPath = args.fieldPath || null;
  const all = getToolCallsForPrompt(args.localMessage);
  if (!fieldPath || !fieldPath.startsWith('tool_calls/')) return undefined;
  if (!all || all.length === 0) return undefined;

  const locator = parseToolCallLocatorFromFieldPath(fieldPath);
  if (!locator) return undefined;

  const matched =
    locator.kind === 'index'
      ? all[locator.index]
      : all.find((tc) => tc.id && tc.id === locator.id);

  return matched || undefined;
}

function formatMessageForSummary(msg: ChatMessage): string {
  const contentText = getMessageText(msg).trim();
  const parts: string[] = [];
  if (contentText) parts.push(contentText);

  if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
    for (const tc of msg.toolCalls) {
      const toolName = String((tc as any)?.tool_name || '');
      const status = String((tc as any)?.status || 'pending');
      const result = getResultMessageOrReason(status, tc);
      parts.push(
        [`<function_call name="${toolName}" status="${status}">`, `<result>${result}</result>`, `</function_call>`]
          .filter(Boolean)
          .join('\n')
      );
    }
  }

  return parts.join('\n\n').trim();
}

// ---------------------------------------------------------------------------
// Memory search (RAG)
// ---------------------------------------------------------------------------

type MemoryRelevantChat = {
  messageId: string;
  role: string;
  matched_snippet?: string;
  match?: {
    kind: 'content' | 'tool_call' | 'unknown';
    fieldPath?: string | null;
    chunkIndex?: number | null;
  };
  toolCall?: RelevantChatToolCall;
  original?: {
    content_parts: ContentPart[];
    tool_calls: ToolCallMetadata[];
  };
};

async function buildMemorySearch(
  params: PrepareMemoryParams,
  status: Awaited<ReturnType<typeof memoryService.status>>,
  activeHistory: ChatMessage[],
  fullHistory: ChatMessage[],
  signal?: AbortSignal,
): Promise<MemoryContext> {
  const previousSummaries = status.lastSummaryText ? [status.lastSummaryText] : [];

  const lastAssistant = [...activeHistory].reverse().find((m) => m.role === 'assistant');
  const lastAssistantText = lastAssistant ? getMessageText(lastAssistant).trim() : '';
  const query = [lastAssistantText, params.userInput?.trim()].filter(Boolean).join('\n\n').trim();

  if (!status.hasMemory || !query) {
    return { previousSummaries, relevantChats: [] };
  }

  const settings = useSettingsStore.getState().getSettings();
  if (!settings.ragSearchEnabled) {
    return { previousSummaries, relevantChats: [] };
  }

  const topK = settings.agentMemoryTopKPerQuery ?? 20;
  const neighborWindow = settings.agentMemoryNeighborWindow ?? 0;
  const maxPrimary = settings.agentMemoryMaxPrimaryMessages ?? 20;
  const maxTotal = settings.agentMemoryMaxTotalMessages ?? 60;
  const profile = settings.embeddingConfigs?.agentMemory;
  if (!profile?.provider || !profile.model) {
    throw new Error('Missing agent-memory embedding profile (Settings > Search & Memory > Agent Memory).');
  }

  const creds = useCredentialsStore.getState().credentials as any;
  const config: any = {};
  if (profile.provider === 'custom') {
    config.api_key = creds.custom?.apiKey || undefined;
    config.base_url = creds.custom?.baseUrl || undefined;
    const additionalHeaders = parseCustomAdditionalHeaders(creds.custom?.additionalHeadersJson);
    if (additionalHeaders) {
      config.additional_headers = additionalHeaders;
    }
  } else {
    config.api_key = creds?.[profile.provider]?.apiKey || undefined;
  }

  if (!config.api_key) {
    throw new Error(`Missing API key for embedding provider '${profile.provider}' (Settings > Credentials).`);
  }
  if (profile.provider === 'custom' && !config.base_url) {
    throw new Error('Missing baseUrl for custom embedding provider (Settings > Credentials).');
  }

  const ownerId = params.subAgentId ?? undefined;
  const messageById = new Map<string, ChatMessage>(fullHistory.map((m) => [m.id, m]));

  const resp = await memoryService.search(params.projectId, params.agentId, {
    language: params.language,
    queries: [query],
    top_k_per_query: topK,
    config,
  }, { signal, ownerId });

  throwIfAborted(signal);

  const baseChats: MemoryRelevantChat[] = (resp.results || []).map((r: any) => {
    const local = messageById.get(r.message_id);
    const fieldPath = r.field_path ?? null;
    const matchedSnippet = String(r.content || '').trim();
    const kind: 'content' | 'tool_call' | 'unknown' =
      !fieldPath || fieldPath === 'content'
        ? 'content'
        : fieldPath.startsWith('tool_calls/')
          ? 'tool_call'
          : 'unknown';
    return {
      messageId: r.message_id,
      role: r.role,
      matched_snippet: matchedSnippet,
      match: {
        kind,
        fieldPath,
        chunkIndex: r.chunk_index ?? null,
      },
      toolCall: kind === 'tool_call' ? getMatchedToolCallForPrompt({ fieldPath, localMessage: local }) : undefined,
      original: {
        content_parts: Array.isArray(local?.contentParts) ? local!.contentParts : [],
        tool_calls: Array.isArray(local?.toolCalls) ? local!.toolCalls : [],
      },
    };
  });

  const maxPrimaryClamped = Math.max(1, Math.min(200, Math.trunc(Number(maxPrimary) || 20)));
  const maxTotalClamped = Math.max(1, Math.min(500, Math.trunc(Number(maxTotal) || 60)));

  const primaryChats = baseChats.slice(0, maxPrimaryClamped);

  if (neighborWindow <= 0 || primaryChats.length === 0) {
    return { previousSummaries, relevantChats: primaryChats.slice(0, maxTotalClamped) };
  }

  const idToIndex = new Map<string, number>(fullHistory.map((m, i) => [m.id, i]));
  const baseById = new Map<string, MemoryRelevantChat>(primaryChats.map((c) => [c.messageId, c]));

  const includeIds = new Set<string>();
  outer: for (const c of primaryChats) {
    const idx = idToIndex.get(c.messageId);
    if (idx == null) {
      includeIds.add(c.messageId);
      if (includeIds.size >= maxTotalClamped) break;
      continue;
    }
    const start = Math.max(0, idx - neighborWindow);
    const end = Math.min(fullHistory.length - 1, idx + neighborWindow);
    for (let j = start; j <= end; j++) {
      includeIds.add(fullHistory[j].id);
      if (includeIds.size >= maxTotalClamped) break outer;
    }
  }

  const expanded: MemoryRelevantChat[] = [];
  for (const m of fullHistory) {
    if (!includeIds.has(m.id)) continue;
    const base = baseById.get(m.id);
    expanded.push({
      messageId: m.id,
      role: m.role,
      matched_snippet: base?.matched_snippet,
      match: base?.match,
      toolCall: base?.toolCall,
      original: {
        content_parts: Array.isArray(m.contentParts) ? m.contentParts : [],
        tool_calls: Array.isArray(m.toolCalls) ? m.toolCalls : [],
      },
    });
    if (expanded.length >= maxTotalClamped) break;
  }

  for (const c of primaryChats) {
    if (expanded.length >= maxTotalClamped) break;
    if (!expanded.some((e) => e.messageId === c.messageId)) {
      expanded.push(c);
    }
  }

  return {
    previousSummaries,
    relevantChats: expanded
      .filter(
        (c) =>
          (c.matched_snippet || '').trim() ||
          c.toolCall != null
      )
      .slice(0, maxTotalClamped),
  };
}

// ---------------------------------------------------------------------------
// Memory summary session
// ---------------------------------------------------------------------------

async function runMemorySummarySession(args: {
  projectId: string;
  agentId: string;
  language: string;
  archiveUntilMessageId: string;
  previousSummaryText: string;
  messagesToArchive: ChatMessage[];
}, signal?: AbortSignal): Promise<string> {
  const settingsStore = useSettingsStore.getState();
  const credentialsStore = useCredentialsStore.getState();
  const sessionStore = useLLMSessionStore.getState();

  const summaryConfig = settingsStore.getTaskConfig('summary');
  const providerConfig = credentialsStore.getProviderConfigForBackend(summaryConfig.provider);

  const promptContext: MemorySummaryPromptContext = {
    projectId: args.projectId,
    outputLanguage: args.language,
    outputMode: 'raw_output',
    enable_prefill: summaryConfig.advanced.enable_prefill,
    thinking_mode: summaryConfig.advanced.thinking_mode,
    memorySummary: {
      previousSummary: args.previousSummaryText || '',
      messages: args.messagesToArchive.map((m) => ({
        role: m.role,
        content: formatMessageForSummary(m),
        messageId: m.id,
        createdAt: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
      })),
      language: args.language,
      archiveUntilMessageId: args.archiveUntilMessageId,
    },
  };

  type SummaryInput = {
    projectId: string;
    agentId: string;
    language: string;
    archiveUntilMessageId: string;
  };

  const handle = startLLMSession<SummaryInput, { summaryText: string }>({
    kind: 'agentMemorySummary',
    label: 'Memory Summary',
    input: {
      projectId: args.projectId,
      agentId: args.agentId,
      language: args.language,
      archiveUntilMessageId: args.archiveUntilMessageId,
    },
    mode: LLMTaskMode.AGENT_MEMORY_SUMMARY,
    projectId: args.projectId,
    promptContext,
    provider: summaryConfig.provider,
    providerConfig,
    model: summaryConfig.model,
    temperature: summaryConfig.temperature,
    thinking_mode: summaryConfig.advanced.thinking_mode as any,
    thinking_config: summaryConfig.advanced.thinking_config,
    retryConfig: settingsStore.getSettings().retryConfig,
    history: createEmptyUserHistory(),
  });

  const sessionId = handle.sessionId;
  const initialSession = sessionStore.getSessionById(sessionId);
  if (initialSession) {
    registerSessionNotification(initialSession, {
      onClick: () => useAgentUIStore.getState().openDetailModal(sessionId),
      onDismiss: () => sessionStore.clearSession(sessionId),
      onCancel: () => sessionStore.cancelSession(sessionId),
    });
  }

  if (signal) {
    if (signal.aborted) {
      handle.abort();
      throw new DOMException('Aborted', 'AbortError');
    }
    signal.addEventListener('abort', () => handle.abort(), { once: true });
  }

  const finalSession = await handle.done;
  const currentSession = useLLMSessionStore.getState().getSessionById(sessionId);
  if (currentSession) updateSessionNotification(sessionId, currentSession);

  if (finalSession.status !== 'success') {
    if (finalSession.status === 'cancelled' || isAbortError(finalSession.error)) {
      throw new DOMException('Aborted', 'AbortError');
    }
    throw new Error(finalSession.error || 'Memory summary failed.');
  }

  const summaryText = (finalSession.contentParts || [])
    .filter((p: any) => p.type === 'content')
    .map((p: any) => p.text)
    .join('')
    .trim();

  if (!summaryText) {
    throw new Error('AI did not generate a memory summary.');
  }

  return summaryText;
}

// ---------------------------------------------------------------------------
// prepareRunMemory — the main preflight pipeline
// ---------------------------------------------------------------------------

/**
 * Prepare memory before a run starts or resumes.
 * Handles archiving, token budgeting, RAG search.
 * Returns MemoryContext to be stored on the run.
 *
 * Supports both root agents (owner_id = agentId) and
 * sub-agents (owner_id = subAgentId).
 */
export async function prepareRunMemory(params: PrepareMemoryParams): Promise<MemoryContext> {
  const settingsStore = useSettingsStore.getState();
  const settings = settingsStore.getSettings();

  const isSubAgent = Boolean(params.subAgentId);
  const ownerId = params.subAgentId ?? undefined;

  params.onStageChange?.('checking');
  throwIfAborted(params.signal);

  const status = await memoryService.status(
    params.projectId,
    params.agentId,
    { signal: params.signal, ownerId }
  );
  const archivedUntilMessageId = status.archivedUntilMessageId ?? null;

  // Build initial active history from current boundary
  const fullHistory = isSubAgent
    ? buildSubAgentBackedHistory(params.projectId, params.agentId, params.subAgentId!, null, params.language)
    : buildRunBackedHistory(params.projectId, params.agentId, null, params.language);
  let activeHistory = sliceAfterBoundary(fullHistory, archivedUntilMessageId);

  // Append the current user message (not yet stored), so we can budget correctly.
  const syntheticUserId = `mem-${generateTempId()}`;
  if (params.userInput.trim()) {
    activeHistory = [
      ...activeHistory,
      {
        id: syntheticUserId,
        role: 'user',
        contentParts: [{ type: 'content', text: params.userInput }],
        timestamp: new Date(),
      },
    ];
  }

  let currentBoundary = archivedUntilMessageId;
  let memory = await buildMemorySearch(params, status, activeHistory, fullHistory, params.signal);

  // Use appropriate task config for token budgeting
  const taskConfigKey = isSubAgent ? 'subAgent' : 'agent';
  const taskConfig = settingsStore.getTaskConfig(taskConfigKey as any);
  const contextWindowTokens = taskConfig.context_window_tokens;
  const context_window_tokens =
    typeof contextWindowTokens === 'number' ? contextWindowTokens : Number.POSITIVE_INFINITY;
  const reservedCompletionTokens =
    typeof taskConfig.max_output_tokens === 'number'
      ? taskConfig.max_output_tokens
      : DEFAULT_POLICY.reservedCompletionTokens;

  const budgetTokens = Number.isFinite(context_window_tokens)
    ? context_window_tokens - reservedCompletionTokens - DEFAULT_POLICY.safetyMarginTokens
    : Number.POSITIVE_INFINITY;

  if (Number.isFinite(budgetTokens) && budgetTokens <= 0) {
    throw new Error(
      `Invalid token budget. context_window_tokens=${context_window_tokens}, max_output_tokens=${reservedCompletionTokens}, safetyMarginTokens=${DEFAULT_POLICY.safetyMarginTokens}`
    );
  }

  for (let loop = 0; loop < DEFAULT_POLICY.maxArchiveLoops; loop++) {
    throwIfAborted(params.signal);

    // Build prompt context for token estimation
    let promptContext: AgentPromptContext | SubAgentPromptContext;
    let llmMode: string;

    if (isSubAgent) {
      await useSubAgentStore.getState().ensureLoaded();
      const subAgentDef = params.subAgentId
        ? useSubAgentStore.getState().getById(params.subAgentId)
        : undefined;
      if (params.subAgentId && !subAgentDef) {
        throw new Error(`SubAgent definition not found: ${params.subAgentId}`);
      }
      llmMode = LLMTaskMode.SUB_AGENT;
      promptContext = {
        projectId: params.projectId,
        outputLanguage: params.language,
        outputMode: settings.nativeOutputMode ? 'native_tool_call' : 'tool_call',
        enable_prefill: taskConfig.advanced.enable_prefill,
        thinking_mode: taskConfig.advanced.thinking_mode,
        agentName: subAgentDef!.agent_name,
        ...(memory as any),
      } as SubAgentPromptContext;
    } else {
      llmMode = getLlmMode(params.runMode);
      promptContext = {
        projectId: params.projectId,
        outputLanguage: params.language,
        outputMode: settings.nativeOutputMode ? 'native_tool_call' : 'tool_call',
        enable_prefill: taskConfig.advanced.enable_prefill,
        thinking_mode: taskConfig.advanced.thinking_mode,
        runMode: params.runMode as any,
        surface: params.surface as any,
        contextObjectIds: params.contextObjectIds,
        ...(memory as any),
      } as AgentPromptContext;
    }

    const promptBundle = await PromptManager.generatePromptBundle(llmMode as any, promptContext);
    const blocksWithMeta = buildConversationBlocksWithMeta(activeHistory, promptBundle, {
      toolCallHistoryLimit: settings.toolCallHistoryLimit,
      thinkingHistoryLimit: settings.thinkingHistoryLimit,
      includePrefill: true,
    });

    const perMessageTokens: Record<string, number> = {};
    let totalTokens = 0;
    for (const item of blocksWithMeta) {
      throwIfAborted(params.signal);
      const text = serializeConversationBlock(item.block);
      const tokens = await estimateTokens(text);
      totalTokens += tokens;
      if (item.meta.sourceMessageId) {
        perMessageTokens[item.meta.sourceMessageId] = (perMessageTokens[item.meta.sourceMessageId] || 0) + tokens;
      }
    }

    if (totalTokens <= budgetTokens) {
      // Budget fits — update boundary for root agents only
      if (!isSubAgent) {
        useAgentStore.getState().setArchivedUntilMessageId(params.projectId, params.agentId, currentBoundary);
      }
      return { ...memory, archiveBoundary: currentBoundary };
    }

    // Choose a boundary that frees enough tokens
    const archivableIds = activeHistory
      .filter((m) => m.id !== syntheticUserId)
      .map((m) => m.id);

    const boundary = chooseArchiveBoundaryForBudget(
      archivableIds,
      perMessageTokens,
      totalTokens,
      budgetTokens
    );

    if (!boundary) {
      throw new Error('Token overflow: could not determine a safe archive boundary.');
    }

    // Validate embedding config before blocking summary
    if (!settings.ragSearchEnabled) {
      throw new Error('Embeddings are disabled (Settings > Search & Memory). Enable embeddings to use agent memory.');
    }

    const profile = settings.embeddingConfigs?.agentMemory;
    if (!profile?.provider || !profile.model) {
      throw new Error('Missing agent-memory embedding profile (Settings > Search & Memory > Agent Memory).');
    }

    const creds = useCredentialsStore.getState().credentials as any;
    const embedding_config: any = {};
    if (profile.provider === 'custom') {
      embedding_config.api_key = creds.custom?.apiKey || undefined;
      embedding_config.base_url = creds.custom?.baseUrl || undefined;
      const additionalHeaders = parseCustomAdditionalHeaders(creds.custom?.additionalHeadersJson);
      if (additionalHeaders) {
        embedding_config.additional_headers = additionalHeaders;
      }
    } else {
      embedding_config.api_key = creds?.[profile.provider]?.apiKey || undefined;
    }
    if (!embedding_config.api_key) {
      throw new Error(`Missing API key for embedding provider '${profile.provider}' (Settings > Credentials).`);
    }
    if (profile.provider === 'custom' && !embedding_config.base_url) {
      throw new Error('Missing baseUrl for custom embedding provider (Settings > Credentials).');
    }

    const messagesToArchive = activeHistory
      .filter((m) => m.id !== syntheticUserId)
      .slice(0, activeHistory.findIndex((m) => m.id === boundary) + 1);

    params.onStageChange?.('summarizing');
    const summaryText = await runMemorySummarySession({
      projectId: params.projectId,
      agentId: params.agentId,
      language: params.language,
      archiveUntilMessageId: boundary,
      previousSummaryText: memory.previousSummaries[memory.previousSummaries.length - 1] || '',
      messagesToArchive,
    }, params.signal);

    throwIfAborted(params.signal);

    params.onStageChange?.('archiving');
    const archiveResp = await memoryService.archive(
      params.projectId,
      params.agentId,
      {
        language: params.language,
        archive_until_message_id: boundary,
        summary_text: summaryText,
        archived_messages: messagesToArchive.map((m) => ({
          message_id: m.id,
          role: m.role,
          content: getMessageText(m),
          created_at: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
          tool_calls: m.toolCalls ? (m.toolCalls as any) : undefined,
        })),
        embedding_config,
      },
      { signal: params.signal, ownerId }
    );

    currentBoundary = archiveResp.archived_until_message_id ?? currentBoundary;
    // Only update agent store boundary for root agents
    if (!isSubAgent) {
      useAgentStore.getState().setArchivedUntilMessageId(params.projectId, params.agentId, currentBoundary ?? null);
    }
    const nextSummary = archiveResp.summary_text ?? '';
    memory = {
      previousSummaries: nextSummary ? [nextSummary] : memory.previousSummaries,
      relevantChats: memory.relevantChats,
    };

    // Remove archived messages from active window
    const boundaryIdx = activeHistory.findIndex((m) => m.id === (currentBoundary ?? boundary));
    activeHistory = boundaryIdx >= 0 ? activeHistory.slice(boundaryIdx + 1) : activeHistory;

    // Re-run search after new archive
    params.onStageChange?.('searching');
    const refreshedStatus = await memoryService.status(
      params.projectId,
      params.agentId,
      { signal: params.signal, ownerId }
    );

    // Rebuild full history for neighbor window after archive
    const refreshedFullHistory = isSubAgent
      ? buildSubAgentBackedHistory(params.projectId, params.agentId, params.subAgentId!, null, params.language)
      : buildRunBackedHistory(params.projectId, params.agentId, null, params.language);

    memory = await buildMemorySearch(params, refreshedStatus, activeHistory, refreshedFullHistory, params.signal);
  }

  // Give up on further archiving — return best-effort results
  if (!isSubAgent) {
    useAgentStore.getState().setArchivedUntilMessageId(params.projectId, params.agentId, currentBoundary);
  }
  return { ...memory, archiveBoundary: currentBoundary };
}
