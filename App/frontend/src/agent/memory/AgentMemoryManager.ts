import { agentMemoryService } from '../../api/agentMemoryService';
import {
  PromptManager,
  LLMTaskMode,
  createEmptyUserHistory,
  type ChatMessage,
  type AgentPromptContext,
  type AgentMemorySummaryPromptContext,
  type ContentPart,
  type ToolCallMetadata,
} from '../../llm';
import type { AgentRunMode, WorkspaceSurface } from '../../types/agentRuntime';
import { buildConversationBlocksWithMeta } from '../../llm/conversation/buildConversationBlocks';
import { startLLMSession } from '../../llmSession';
import { useAgentStore } from '../../store/agentStore';
import { useAgentUIStore } from '../../store/agentUIStore';
import { useCredentialsStore } from '../../store/credentialsStore';
import { useLLMSessionStore } from '../../store/llmSessionStore';
import { useSettingsStore } from '../../store/settingsStore';
import { registerSessionNotification, updateSessionNotification } from '../../llmTask/notificationHelpers';
import { countTokens } from '../../services/tokenCountingService';
import { generateTempId } from '../../utils/tempId';

type MemoryRelevantChat = {
  messageId: string;
  role: string;
  // Snippet matched by memory search (best chunk text)
  matched_snippet?: string;
  // Match metadata (for template branching; avoid exposing createdAt/distance)
  match?: {
    kind: 'content' | 'tool_call' | 'unknown';
    fieldPath?: string | null;
    chunkIndex?: number | null;
  };
  // Matched tool call (summary only; raw args not included)
  toolCall?: RelevantChatToolCall;
  // Original message payload (for user-defined templates; avoid pre-formatting)
  original?: {
    content_parts: ContentPart[];
    tool_calls: ToolCallMetadata[];
  };
};

export type AgentMemoryContext = {
  previousSummaries: string[];
  relevantChats: MemoryRelevantChat[];
};

export type PreSessionInput = {
  projectId: string;
  agentId: string;
  runMode: AgentRunMode;
  surface: WorkspaceSurface;
  userInput: string;
  outputLanguage: string;
  outputMode: 'tool_call' | 'native_tool_call' | 'raw_output';
  enable_prefill: boolean;
  thinking_mode: 'off' | 'model' | 'custom';
  contextObjectIds?: string[];
};

export type PreSessionOutput = {
  historyForLLM: ChatMessage[];
  memory: AgentMemoryContext;
  archivedUntilMessageId: string | null;
};

const DEFAULT_POLICY = {
  // Conservative defaults; can be made configurable later.
  maxContextTokens: 8192,
  reservedCompletionTokens: 2048,
  safetyMarginTokens: 256,
  maxArchiveLoops: 3,
} as const;

function getLlmMode(runMode: PreSessionInput['runMode']): typeof LLMTaskMode[keyof typeof LLMTaskMode] {
  return runMode === 'planMode' ? LLMTaskMode.AGENT_PLAN_MODE : LLMTaskMode.AGENT_AGENT_MODE;
}

function getMessageText(msg: ChatMessage): string {
  return msg.contentParts
    .filter((p) => p.type === 'content')
    .map((p) => p.text)
    .join('');
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

function serializeConversationBlock(block: any): string {
  const contentText = Array.isArray(block.contentParts)
    ? block.contentParts.map((p: any) => p?.text ?? '').join('')
    : '';
  const toolCalls = block.tool_calls ? `\n<tool_calls>\n${JSON.stringify(block.tool_calls)}\n</tool_calls>` : '';
  const toolResults = block.tool_results ? `\n<tool_results>\n${JSON.stringify(block.tool_results)}\n</tool_results>` : '';
  return `${block.role}\n${contentText}${toolCalls}${toolResults}`.trim();
}

async function estimateTokens(text: string): Promise<number> {
  // Always use local tiktoken for pre-session estimates to avoid backend token-count spam.
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
  // If we couldn't estimate meaningful token contributions, avoid archiving blindly.
  if (acc <= 0) return null;
  return boundary;
}

export type AgentMemoryPreflightStage =
  | 'checking'
  | 'summarizing'
  | 'archiving'
  | 'searching';

export type AgentMemoryPrepareOptions = {
  signal?: AbortSignal;
  onStageChange?: (stage: AgentMemoryPreflightStage) => void;
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

async function buildMemoryContext(
  input: PreSessionInput,
  status: Awaited<ReturnType<typeof agentMemoryService.status>>,
  activeHistory: ChatMessage[],
  options?: AgentMemoryPrepareOptions
): Promise<AgentMemoryContext> {
  const previousSummaries = status.lastSummaryText ? [status.lastSummaryText] : [];

  const lastAssistant = [...activeHistory].reverse().find((m) => m.role === 'assistant');
  const lastAssistantText = lastAssistant ? getMessageText(lastAssistant).trim() : '';
  const query = [lastAssistantText, input.userInput?.trim()].filter(Boolean).join('\n\n').trim();

  if (!status.hasMemory || !query) {
    return { previousSummaries, relevantChats: [] };
  }

  const settings = useSettingsStore.getState().getSettings();
  if (!settings.ragSearchEnabled) {
    // Embeddings disabled globally: keep summary only.
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
  } else {
    config.api_key = creds?.[profile.provider]?.apiKey || undefined;
  }

  if (!config.api_key) {
    throw new Error(`Missing API key for embedding provider '${profile.provider}' (Settings > Credentials).`);
  }
  if (profile.provider === 'custom' && !config.base_url) {
    throw new Error('Missing baseUrl for custom embedding provider (Settings > Credentials).');
  }

  const agentStore = useAgentStore.getState();
  const fullHistory = agentStore.getMessages(input.projectId, input.agentId, input.outputLanguage);
  const messageById = new Map<string, ChatMessage>(fullHistory.map((m) => [m.id, m]));

  const resp = await agentMemoryService.search(input.projectId, input.agentId, {
    language: input.outputLanguage,
    queries: [query],
    top_k_per_query: topK,
    config,
  }, options?.signal ? { signal: options.signal } : undefined);

  throwIfAborted(options?.signal);

  const baseChats: MemoryRelevantChat[] = (resp.results || []).map((r) => {
    const local = messageById.get(r.message_id);
    const fieldPath = r.field_path ?? null;
    const chunkIndex = r.chunk_index ?? null;
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
        chunkIndex,
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

  // Expand by nearby messages in local chat history (UI keeps full history even when archived).
  const idToIndex = new Map<string, number>(fullHistory.map((m, i) => [m.id, i]));
  const baseById = new Map<string, MemoryRelevantChat>(primaryChats.map((c) => [c.messageId, c]));

  // Select up to maxTotal messages by expanding around best hits first
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

  // Include any primary results that aren't present in local store (up to cap)
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

type AgentMemorySummaryInput = {
  projectId: string;
  agentId: string;
  language: string;
  archiveUntilMessageId: string;
};

async function runMemorySummarySession(args: {
  projectId: string;
  agentId: string;
  language: string;
  archiveUntilMessageId: string;
  previousSummaryText: string;
  messagesToArchive: ChatMessage[];
}, options?: AgentMemoryPrepareOptions): Promise<string> {
  const settingsStore = useSettingsStore.getState();
  const credentialsStore = useCredentialsStore.getState();
  const sessionStore = useLLMSessionStore.getState();

  const summaryConfig = settingsStore.getTaskConfig('summary');
  const providerConfig = credentialsStore.getProviderConfigForBackend(summaryConfig.provider);

  const promptContext: AgentMemorySummaryPromptContext = {
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

  const handle = startLLMSession<AgentMemorySummaryInput, { summaryText: string }>({
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

  // Link outer AbortSignal to the LLMSession cancellation (Stop button).
  if (options?.signal) {
    if (options.signal.aborted) {
      handle.abort();
      throw new DOMException('Aborted', 'AbortError');
    }
    options.signal.addEventListener('abort', () => handle.abort(), { once: true });
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

export const AgentMemoryManager = {
  async prepare(input: PreSessionInput, options?: AgentMemoryPrepareOptions): Promise<PreSessionOutput> {
    const agentStore = useAgentStore.getState();
    const settingsStore = useSettingsStore.getState();
    const settings = settingsStore.getSettings();

    options?.onStageChange?.('checking');
    throwIfAborted(options?.signal);

    const status = await agentMemoryService.status(
      input.projectId,
      input.agentId,
      options?.signal ? { signal: options.signal } : undefined
    );
    const archivedUntilMessageId = status.archivedUntilMessageId ?? null;
    agentStore.setArchivedUntilMessageId(input.projectId, input.agentId, archivedUntilMessageId);

    // Build initial active history from current boundary
    const fullHistory = agentStore.getMessages(input.projectId, input.agentId, input.outputLanguage);
    let activeHistory = sliceAfterBoundary(fullHistory, archivedUntilMessageId);

    // Append the current user message (not yet stored), so we can budget correctly.
    const syntheticUserId = `mem-${generateTempId()}`;
    if (input.userInput.trim()) {
      activeHistory = [
        ...activeHistory,
        {
          id: syntheticUserId,
          role: 'user',
          contentParts: [{ type: 'content', text: input.userInput }],
          timestamp: new Date(),
        },
      ];
    }

    let currentBoundary = archivedUntilMessageId;
    let memory = await buildMemoryContext(input, status, activeHistory, options);

    const agentTaskConfig = settingsStore.getTaskConfig('agent');
    const contextWindowTokens = agentTaskConfig.context_window_tokens;
    const context_window_tokens =
      typeof contextWindowTokens === 'number' ? contextWindowTokens : Number.POSITIVE_INFINITY;
    const reservedCompletionTokens =
      typeof agentTaskConfig.max_output_tokens === 'number'
        ? agentTaskConfig.max_output_tokens
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
      throwIfAborted(options?.signal);
      const llmMode = getLlmMode(input.runMode);
      const promptContext: AgentPromptContext = {
        projectId: input.projectId,
        outputLanguage: input.outputLanguage,
        outputMode: input.outputMode,
        enable_prefill: input.enable_prefill,
        thinking_mode: input.thinking_mode,
        runMode: input.runMode,
        surface: input.surface,
        contextObjectIds: input.contextObjectIds,
        // Memory injection (PromptManager will expose these on templateData.agent.*)
        ...(memory as any),
      };

      const promptBundle = await PromptManager.generatePromptBundle(llmMode, promptContext);
      const blocksWithMeta = buildConversationBlocksWithMeta(activeHistory, promptBundle, {
        toolCallHistoryLimit: settings.toolCallHistoryLimit,
        thinkingHistoryLimit: settings.thinkingHistoryLimit,
        includePrefill: true,
      });

      // Token estimation
      const perMessageTokens: Record<string, number> = {};
      let totalTokens = 0;
      for (const item of blocksWithMeta) {
        throwIfAborted(options?.signal);
        const text = serializeConversationBlock(item.block);
        const tokens = await estimateTokens(text);
        totalTokens += tokens;
        if (item.meta.sourceMessageId) {
          perMessageTokens[item.meta.sourceMessageId] = (perMessageTokens[item.meta.sourceMessageId] || 0) + tokens;
        }
      }

      if (totalTokens <= budgetTokens) {
        return {
          historyForLLM: activeHistory.filter((m) => m.id !== syntheticUserId),
          memory,
          archivedUntilMessageId: currentBoundary,
        };
      }

      // Choose a boundary that frees enough tokens to fit the budget (excluding current synthetic user input).
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

      // Validate embedding config before doing a blocking summary.
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

      options?.onStageChange?.('summarizing');
      const summaryText = await runMemorySummarySession({
        projectId: input.projectId,
        agentId: input.agentId,
        language: input.outputLanguage,
        archiveUntilMessageId: boundary,
        previousSummaryText: memory.previousSummaries[memory.previousSummaries.length - 1] || '',
        messagesToArchive,
      }, options);

      throwIfAborted(options?.signal);

      options?.onStageChange?.('archiving');
      const archiveResp = await agentMemoryService.archive(
        input.projectId,
        input.agentId,
        {
          language: input.outputLanguage,
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
        options?.signal ? { signal: options.signal } : undefined
      );

      currentBoundary = archiveResp.archived_until_message_id ?? currentBoundary;
      agentStore.setArchivedUntilMessageId(input.projectId, input.agentId, currentBoundary ?? null);
      const nextSummary = archiveResp.summary_text ?? '';
      memory = {
        previousSummaries: nextSummary ? [nextSummary] : memory.previousSummaries,
        relevantChats: memory.relevantChats,
      };

      // Remove archived messages from active window
      const boundaryIdx = activeHistory.findIndex((m) => m.id === (currentBoundary ?? boundary));
      activeHistory = boundaryIdx >= 0 ? activeHistory.slice(boundaryIdx + 1) : activeHistory;

      // Re-run search after new archive so relevantChats can use latest index
      options?.onStageChange?.('searching');
      const refreshedStatus = await agentMemoryService.status(
        input.projectId,
        input.agentId,
        options?.signal ? { signal: options.signal } : undefined
      );
      memory = await buildMemoryContext(input, refreshedStatus, activeHistory, options);
    }

    // Give up on further archiving; proceed with best-effort active history.
    return {
      historyForLLM: activeHistory.filter((m) => m.id !== syntheticUserId),
      memory,
      archivedUntilMessageId: currentBoundary,
    };
  },
};
