import { agentMemoryService } from '../../api/agentMemoryService';
import { PromptManager, LLMTaskMode, type ChatMessage, type AgentWorkspacePromptContext } from '../../llm';
import { buildConversationBlocksWithMeta } from '../../llm/conversation/buildConversationBlocks';
import { useAgentStore } from '../../store/agentStore';
import { useCredentialsStore } from '../../store/credentialsStore';
import { useSettingsStore } from '../../store/settingsStore';
import { countTokens } from '../../services/tokenCountingService';
import { generateTempId } from '../../utils/tempId';

type MemoryRelevantChat = {
  messageId: string;
  role: string;
  content: string;
  createdAt?: string;
  distance?: number | null;
};

export type AgentMemoryContext = {
  previousSummary: string[];
  relevantChats: MemoryRelevantChat[];
};

export type PreSessionInput = {
  projectId: string;
  agentId: string;
  mode: 'novelEditor' | 'storyObject' | 'outlineManager';
  userInput: string;
  outputLanguage: string;
  outputMode: 'tool_call' | 'native_tool_call' | 'raw_output';
  enablePrefill: boolean;
  thinkingMode: 'off' | 'model' | 'custom';
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
  archiveTargetRatio: 0.5,
  maxArchiveLoops: 3,
} as const;

function getLlmMode(mode: PreSessionInput['mode']): typeof LLMTaskMode[keyof typeof LLMTaskMode] {
  return mode === 'storyObject'
    ? LLMTaskMode.AGENT_STORYOBJECT
    : mode === 'outlineManager'
      ? LLMTaskMode.AGENT_OUTLINE_MANAGER
      : LLMTaskMode.AGENT_NOVEL_EDITOR;
}

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

function chooseArchiveBoundary(
  orderedMessageIds: string[],
  messageTokenMap: Record<string, number>,
  ratio: number
): string | null {
  if (orderedMessageIds.length === 0) return null;

  const total = orderedMessageIds.reduce((sum, id) => sum + (messageTokenMap[id] || 0), 0);
  if (total <= 0) return null;

  const target = total * ratio;
  let acc = 0;
  let boundary: string | null = null;
  for (const id of orderedMessageIds) {
    acc += messageTokenMap[id] || 0;
    boundary = id;
    if (acc >= target) break;
  }
  return boundary;
}

async function buildMemoryContext(
  input: PreSessionInput,
  status: Awaited<ReturnType<typeof agentMemoryService.status>>,
  activeHistory: ChatMessage[]
): Promise<AgentMemoryContext> {
  const previousSummary = status.lastSummaryText ? [status.lastSummaryText] : [];

  const lastAssistant = [...activeHistory].reverse().find((m) => m.role === 'assistant');
  const lastAssistantText = lastAssistant ? getMessageText(lastAssistant).trim() : '';
  const query = [lastAssistantText, input.userInput?.trim()].filter(Boolean).join('\n\n').trim();

  if (!status.hasMemory || !query) {
    return { previousSummary, relevantChats: [] };
  }

  try {
    const settings = useSettingsStore.getState().settings;
    if (!settings.ragSearchEnabled) {
      // Embeddings disabled globally: keep summary only.
      return { previousSummary, relevantChats: [] };
    }
    const topK = settings.agentMemoryTopKPerQuery ?? 20;
    const neighborWindow = settings.agentMemoryNeighborWindow ?? 0;
    const maxPrimary = settings.agentMemoryMaxPrimaryMessages ?? 20;
    const maxTotal = settings.agentMemoryMaxTotalMessages ?? 60;
    const profile = settings.embeddingConfigs?.agentMemory;
    if (!profile?.provider || !profile.model) {
      return { previousSummary, relevantChats: [] };
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
      return { previousSummary, relevantChats: [] };
    }
    if (profile.provider === 'custom' && !config.base_url) {
      return { previousSummary, relevantChats: [] };
    }

    const resp = await agentMemoryService.search(input.projectId, input.agentId, {
      language: input.outputLanguage,
      queries: [query],
      top_k_per_query: topK,
      config,
    });

    const baseChats: MemoryRelevantChat[] = (resp.results || []).map((r) => ({
      messageId: r.message_id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
      distance: r.distance ?? null,
    }));

    const maxPrimaryClamped = Math.max(1, Math.min(200, Math.trunc(Number(maxPrimary) || 20)));
    const maxTotalClamped = Math.max(1, Math.min(500, Math.trunc(Number(maxTotal) || 60)));

    const primaryChats = baseChats.slice(0, maxPrimaryClamped);

    if (neighborWindow <= 0 || primaryChats.length === 0) {
      return { previousSummary, relevantChats: primaryChats.slice(0, maxTotalClamped) };
    }

    // Expand by nearby messages in local chat history (UI keeps full history even when archived).
    const agentStore = useAgentStore.getState();
    const fullHistory = agentStore.getMessages(input.projectId, input.agentId, input.outputLanguage);
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
        content: getMessageText(m),
        createdAt: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
        distance: base?.distance ?? null,
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

    return { previousSummary, relevantChats: expanded.slice(0, maxTotalClamped) };
  } catch (error) {
    console.warn('AgentMemory: search failed, continuing without relevantChats', error);
    return { previousSummary, relevantChats: [] };
  }
}

async function renderMemorySummaryPrompts(args: {
  projectId: string;
  agentId: string;
  agentMode: 'storyObject' | 'novelEditor' | 'outlineManager';
  promptContext: AgentWorkspacePromptContext;
  previousSummaryText: string;
  messagesToArchive: ChatMessage[];
  language: string;
  archiveUntilMessageId: string;
}): Promise<Array<{ role: 'system' | 'user'; content: string }>> {
  const settingsStore = useSettingsStore.getState();

  const [systemT, userT] = await Promise.all([
    settingsStore.loadPrompt('agent', 'systemPrompt', 'memorySummary'),
    settingsStore.loadPrompt('agent', 'userPrompt', 'memorySummary'),
  ]);

  // Reuse the same base template data as the Agent prompt bundle, and add memorySummary group.
  const agentBundle = await PromptManager.generatePromptBundle(
    getLlmMode(
      args.agentMode === 'storyObject'
        ? 'storyObject'
        : args.agentMode === 'outlineManager'
          ? 'outlineManager'
          : 'novelEditor'
    ),
    args.promptContext
  );

  const memorySummary = {
    previousSummary: args.previousSummaryText || '',
    messages: args.messagesToArchive.map((m) => ({
      role: m.role,
      content: getMessageText(m),
      messageId: m.id,
      createdAt: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
    })),
    language: args.language,
    archiveUntilMessageId: args.archiveUntilMessageId,
  };

  const renderedSystem = PromptManager.renderTemplate(systemT, {
    ...agentBundle.templateData,
    memorySummary,
  });
  const renderedUser = PromptManager.renderTemplate(userT, {
    ...agentBundle.templateData,
    memorySummary,
  });

  return [
    { role: 'system', content: renderedSystem },
    { role: 'user', content: renderedUser },
  ];
}

export const AgentMemoryManager = {
  async prepare(input: PreSessionInput): Promise<PreSessionOutput> {
    const agentStore = useAgentStore.getState();
    const settingsStore = useSettingsStore.getState();
    const settings = settingsStore.settings;

    const status = await agentMemoryService.status(input.projectId, input.agentId);
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
    let memory = await buildMemoryContext(input, status, activeHistory);

    const budgetTokens =
      DEFAULT_POLICY.maxContextTokens -
      DEFAULT_POLICY.reservedCompletionTokens -
      DEFAULT_POLICY.safetyMarginTokens;

    for (let loop = 0; loop < DEFAULT_POLICY.maxArchiveLoops; loop++) {
      const llmMode = getLlmMode(input.mode);
      const promptContext: AgentWorkspacePromptContext = {
        projectId: input.projectId,
        outputLanguage: input.outputLanguage,
        outputMode: input.outputMode,
        enablePrefill: input.enablePrefill,
        thinkingMode: input.thinkingMode,
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

      // Pick oldest 50% tokens (excluding current synthetic user input)
      const archivableIds = activeHistory
        .filter((m) => m.id !== syntheticUserId)
        .map((m) => m.id);

      const boundary = chooseArchiveBoundary(
        archivableIds,
        perMessageTokens,
        DEFAULT_POLICY.archiveTargetRatio
      );

      if (!boundary) {
        // As a fallback, just proceed with last messages (no archive).
        console.warn('AgentMemory: token overflow but no archive boundary could be determined');
        return {
          historyForLLM: activeHistory.filter((m) => m.id !== syntheticUserId),
          memory,
          archivedUntilMessageId: currentBoundary,
        };
      }

      // Render summary prompts and archive on backend
      const messagesToArchive = activeHistory
        .filter((m) => m.id !== syntheticUserId)
        .slice(0, activeHistory.findIndex((m) => m.id === boundary) + 1);

      const summaryMessages = await renderMemorySummaryPrompts({
        projectId: input.projectId,
        agentId: input.agentId,
        agentMode: input.mode === 'storyObject' ? 'storyObject' : input.mode === 'outlineManager' ? 'outlineManager' : 'novelEditor',
        promptContext,
        previousSummaryText: memory.previousSummary[memory.previousSummary.length - 1] || '',
        messagesToArchive,
        language: input.outputLanguage,
        archiveUntilMessageId: boundary,
      });

      const creds = useCredentialsStore.getState().credentials as any;

      const summaryProvider = settings.taskConfigs.summary?.provider ?? settings.taskConfigs.agent.provider;
      const summary_config: any = {};
      if (summaryProvider === 'custom') {
        summary_config.api_key = creds.custom?.apiKey || undefined;
        summary_config.base_url = creds.custom?.baseUrl || undefined;
      } else {
        summary_config.api_key = creds?.[summaryProvider]?.apiKey || undefined;
      }

      if (!summary_config.api_key) {
        throw new Error(`Missing API key for provider '${summaryProvider}' (Settings > Credentials)`);
      }
      if (summaryProvider === 'custom' && !summary_config.base_url) {
        throw new Error('Missing baseUrl for custom provider (Settings > Credentials)');
      }

      const memProvider = settings.embeddingConfigs?.agentMemory?.provider;
      const embedding_config: any = {};
      if (memProvider === 'custom') {
        embedding_config.api_key = creds.custom?.apiKey || undefined;
        embedding_config.base_url = creds.custom?.baseUrl || undefined;
      } else if (typeof memProvider === 'string' && memProvider) {
        embedding_config.api_key = creds?.[memProvider]?.apiKey || undefined;
      }

      const archiveResp = await agentMemoryService.archive(input.projectId, input.agentId, {
        language: input.outputLanguage,
        archive_until_message_id: boundary,
        summary_messages: summaryMessages,
        summary_config,
        embedding_config,
      });

      currentBoundary = archiveResp.archived_until_message_id ?? currentBoundary;
      agentStore.setArchivedUntilMessageId(input.projectId, input.agentId, currentBoundary ?? null);
      const nextSummary = archiveResp.summary_text ?? '';
      memory = {
        previousSummary: nextSummary ? [nextSummary] : memory.previousSummary,
        relevantChats: memory.relevantChats,
      };

      // Remove archived messages from active window
      const boundaryIdx = activeHistory.findIndex((m) => m.id === (currentBoundary ?? boundary));
      activeHistory = boundaryIdx >= 0 ? activeHistory.slice(boundaryIdx + 1) : activeHistory;

      // Re-run search after new archive so relevantChats can use latest index
      const refreshedStatus = await agentMemoryService.status(input.projectId, input.agentId);
      memory = await buildMemoryContext(input, refreshedStatus, activeHistory);
    }

    // Give up on further archiving; proceed with best-effort active history.
    return {
      historyForLLM: activeHistory.filter((m) => m.id !== syntheticUserId),
      memory,
      archivedUntilMessageId: currentBoundary,
    };
  },
};
