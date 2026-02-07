/**
 * AgentExecutor - Direct LLM execution for Agent workspace
 *
 * Uses LLMTaskExecutor directly without JourneyRuntime.
 * Manages agent-specific concerns:
 * - Message creation in agentStore
 * - Streaming via llmTaskStore (LLMTask handles session management)
 * - Tool call handling
 */

import { useAgentStore } from '../store/agentStore';
import { useAgentUIStore } from '../store/agentUIStore';
import { useSettingsStore } from '../store/settingsStore';
import { useCredentialsStore } from '../store/credentialsStore';
import { useLLMSessionStore } from '../store/llmSessionStore';
import { useSubAgentStore } from '../store/subAgentStore';
import { startLLMSession } from '../llmSession';
import { LLMTaskMode, type AgentPromptContext, type AgentTranslationPromptContext, createEmptyUserHistory } from '../llm';
import type { OutputMode } from '../llm/types';
import type { ChatMessage, ContentPart } from '../llm/requestTypes';
import { getToolsForSet } from '../toolCall';
import { buildCallToolSchema } from '../subAgent/tools/SubAgentCallTools';
import type { AgentRunMode, WorkspaceSurface, InvocationCaller } from '../types/agentRuntime';
import {
  stageSessionEdits,
  applySessionEdits,
  rejectAllSessionEdits,
  toToolCallMetadata,
} from '../llmTask/toolCalls/toolCallEngine';
import type { HandlerOptions } from '../toolCall/apply/types';
import { generateTempId } from '../utils/tempId';
import { registerSessionNotification, updateSessionNotification } from '../llmTask/notificationHelpers';

export interface AgentExecutorInput {
  projectId: string;
  agentId: string;
  runMode: AgentRunMode;
  surface: WorkspaceSurface;
  userInput: string;
  outputLanguage: string;
  contextObjectIds?: string[];
  historyOverride?: ChatMessage[]; // LLM history base (excludes current userInput)
  promptContextOverride?: Partial<AgentPromptContext>;
}

export interface AgentExecutorResult {
  agentId: string;
  assistantMessageId: string;
}

export interface AgentTranslationInput {
  projectId: string;
  agentId: string;
  messageId: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceContent: string;
  originalContentParts: ContentPart[];
}

export interface AgentTranslationResult {
  agentId: string;
  messageId: string;
  targetLanguage: string;
}

function getMessageText(contentParts: Array<{ type: string; text: string }>): string {
  return contentParts
    .filter((p) => p.type === 'content')
    .map((p) => p.text)
    .join('');
}

export const AgentExecutor = {
  /**
   * Start an agent request
   * Returns sessionId for tracking
   * @param input - Agent executor input parameters
   * @param onSessionCreated - Optional callback called immediately after session creation (for stop button)
   */
  async start(input: AgentExecutorInput, onSessionCreated?: (sessionId: string) => void): Promise<string> {
    const agentStore = useAgentStore.getState();
    const settingsStore = useSettingsStore.getState();
    const credentialsStore = useCredentialsStore.getState();
    const sessionStore = useLLMSessionStore.getState();

    const settings = settingsStore.getSettings();
    const agentConfig = settingsStore.getTaskConfig('agent');
    const providerConfig = credentialsStore.getProviderConfigForBackend(agentConfig.provider);

    const userInput = input.userInput ?? '';
    const language = input.outputLanguage;
    const outputMode: OutputMode = settings.nativeOutputMode ? 'native_tool_call' : 'tool_call';

    // 1) Create user message (if any) and assistant placeholder
    if (userInput.trim()) {
      await agentStore.addMessage(input.projectId, input.agentId, {
        id: generateTempId(),
        role: 'user',
        contentParts: [{ type: 'content', text: userInput }],
        timestamp: new Date(),
      }, language);
    }

    const assistantMessageId = await agentStore.addMessage(input.projectId, input.agentId, {
      id: generateTempId(),
      role: 'assistant',
      contentParts: [],
      timestamp: new Date(),
    }, language);

    // 2) Build history (exclude the empty assistant message we just added, keep current user)
    const fullHistory = agentStore.getMessages(input.projectId, input.agentId, language);
    const historyWithoutAssistant = fullHistory.slice(0, -1);

    // Build base history:
    // - Default: from agentStore (includes current userInput message that we just added)
    // - Override: provided by AgentMemoryManager (excludes current userInput)
    let history = [...(input.historyOverride ?? historyWithoutAssistant)];

    // Merge trailing user messages (failed previous runs) into one
    const trailingUserTexts: string[] = [];
    while (history.length > 0 && history[history.length - 1].role === 'user') {
      const last = history[history.length - 1];
      trailingUserTexts.unshift(getMessageText(last.contentParts));
      history = history.slice(0, -1);
    }
    if (trailingUserTexts.length > 0) {
      history.push({
        id: generateTempId(),
        role: 'user' as const,
        contentParts: [{ type: 'content', text: trailingUserTexts.join('\n\n') }],
        timestamp: new Date(),
      });
    }

    // If historyOverride is provided, append the current userInput for the LLM request.
    // (The store message created above is for UI/backend persistence, not used in historyOverride.)
    if (input.historyOverride && userInput.trim()) {
      history.push({
        id: generateTempId(),
        role: 'user',
        contentParts: [{ type: 'content', text: userInput }],
        timestamp: new Date(),
      });
    }

    const llmMode =
      input.runMode === 'planMode'
        ? LLMTaskMode.AGENT_PLAN_MODE
        : LLMTaskMode.AGENT_AGENT_MODE;

    const toolSet = input.runMode === 'planMode' ? 'agent_plan_mode' : 'agent_agent_mode';

    const baseTools =
      outputMode === 'tool_call'
        ? getToolsForSet(toolSet, { ragSearchEnabled: settings.ragSearchEnabled })
        : undefined;

    let tools = baseTools;
    if (outputMode === 'tool_call') {
      const subAgentStore = useSubAgentStore.getState();
      if (subAgentStore.subAgents.length === 0 && !subAgentStore.isLoading) {
        await subAgentStore.loadSubAgents();
      }

      const dynamicSubAgentTools = subAgentStore.subAgents
        .filter((s) => s.enabled && s.allowed_invocation_modes.includes(input.runMode))
        .sort((a, b) => a.display_name.localeCompare(b.display_name))
        .map(buildCallToolSchema);

      tools = [...(baseTools ?? []), ...dynamicSubAgentTools];
    }

    const promptContext: AgentPromptContext = {
      projectId: input.projectId,
      outputLanguage: language,
      outputMode,
      enablePrefill: agentConfig.advanced.enablePrefill,
      thinkingMode: agentConfig.advanced.thinkingMode,
      tools,
      runMode: input.runMode,
      surface: input.surface,
      contextObjectIds: input.contextObjectIds,
    };
    const mergedPromptContext: AgentPromptContext = {
      ...promptContext,
      ...(input.promptContextOverride ?? {}),
    };

    // 3) Start session + stream via llmSessionStore
    const handle = startLLMSession<AgentExecutorInput, AgentExecutorResult>({
      kind: 'agent',
      label: 'AI Response',
      input,
      mode: llmMode,
      projectId: input.projectId,
      promptContext: mergedPromptContext,
      provider: agentConfig.provider,
      providerConfig,
      model: agentConfig.model,
      temperature: agentConfig.temperature,
      thinkingMode: agentConfig.advanced.thinkingMode as any,
      thinkingConfig: agentConfig.advanced.thinkingConfig,
      retryConfig: settings.retryConfig,
      history,
    });

    const sessionId = handle.sessionId;

    // Attach agent-specific result immediately (so AgentPanel can map streaming session -> message)
    sessionStore.updateSession(sessionId, {
      result: { agentId: input.agentId, assistantMessageId },
    } as any);

    // Notify caller of sessionId
    onSessionCreated?.(sessionId);

    void handle.done.then(async (finalSession) => {

      if (finalSession.status !== 'success') {
        return;
      }

      // 4) Final update + backend sync
      agentStore.updateMessageContentLocal(
        input.projectId,
        input.agentId,
        assistantMessageId,
        finalSession.contentParts,
        language,
        finalSession.thinkingDetails
      );

      try {
        await agentStore.updateMessage(
          input.projectId,
          input.agentId,
          assistantMessageId,
          finalSession.contentParts,
          language,
          finalSession.thinkingDetails
        );
      } catch (error) {
        console.error('Failed to sync message to backend:', error);
      }

      // 5) Handle tool calls
      if (finalSession.toolCalls.length > 0) {
        await stageSessionEdits({
          sessionId,
          projectId: input.projectId,
          language: settings.mainLanguage,
          toolCalls: finalSession.toolCalls,
        });
        // Sync to agentStore
        await syncAgentToolCalls(sessionId);
      }
    });

    return sessionId;
  },

  /**
   * Translate an agent message
   * Returns sessionId for tracking
   * @param input - Translation input parameters
   * @param onSessionCreated - Optional callback called immediately after session creation (for stop button)
   */
  async translate(input: AgentTranslationInput, onSessionCreated?: (sessionId: string) => void): Promise<string> {
    const agentStore = useAgentStore.getState();
    const settingsStore = useSettingsStore.getState();
    const credentialsStore = useCredentialsStore.getState();
    const sessionStore = useLLMSessionStore.getState();

    const translationConfig = settingsStore.getTaskConfig('translation');
    const providerConfig = credentialsStore.getProviderConfigForBackend(translationConfig.provider);

    const promptContext: AgentTranslationPromptContext = {
      projectId: input.projectId,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      sourceContent: input.sourceContent,
      outputMode: 'raw_output',
      outputLanguage: input.targetLanguage,
      enablePrefill: translationConfig.advanced.enablePrefill,
      thinkingMode: translationConfig.advanced.thinkingMode,
    };

    const handle = startLLMSession<AgentTranslationInput, AgentTranslationResult>({
      kind: 'agentTranslation',
      label: 'Agent Translation',
      input,
      mode: LLMTaskMode.AGENT_TRANSLATION,
      projectId: input.projectId,
      promptContext,
      provider: translationConfig.provider,
      providerConfig,
      model: translationConfig.model,
      temperature: translationConfig.temperature,
      thinkingMode: translationConfig.advanced.thinkingMode as any,
      thinkingConfig: translationConfig.advanced.thinkingConfig,
      retryConfig: settingsStore.getSettings().retryConfig,
      history: createEmptyUserHistory(),
    });

    const sessionId = handle.sessionId;

    const initialSession = sessionStore.getSessionById(sessionId);
    if (initialSession) {
      // Register notification now that we have sessionId
      registerSessionNotification(initialSession, {
        onClick: () => useAgentUIStore.getState().openDetailModal(sessionId),
        onDismiss: () => sessionStore.clearSession(sessionId),
      });
    }

    // Notify caller of sessionId
    onSessionCreated?.(sessionId);

    void handle.done.then(async (finalSession) => {
      const currentSession = useLLMSessionStore.getState().getSessionById(sessionId);
      if (currentSession) updateSessionNotification(sessionId, currentSession);

      if (finalSession.status !== 'success') {
        return;
      }

      const translated = finalSession.contentParts
        .filter((p: ContentPart) => p.type === 'content')
        .map((p: ContentPart) => p.text)
        .join('')
        .trim();

      if (!translated) {
        useLLMSessionStore.getState().updateSession(sessionId, {
          status: 'error',
          error: 'AI did not generate a translation.',
        } as any);
        const updated = useLLMSessionStore.getState().getSessionById(sessionId);
        if (updated) updateSessionNotification(sessionId, updated);
        return;
      }

      // Replace content in original content parts
      const translatedContentParts = input.originalContentParts.map((part) => {
        if (part.type === 'content') {
          return { ...part, text: translated };
        }
        return part;
      });

      await agentStore.addTranslatedMessage(
        input.projectId,
        input.agentId,
        input.messageId,
        { contentParts: translatedContentParts },
        input.targetLanguage
      );

      useLLMSessionStore.getState().updateSession(sessionId, {
        status: 'success',
        result: { agentId: input.agentId, messageId: input.messageId, targetLanguage: input.targetLanguage },
      } as any);
      const updated = useLLMSessionStore.getState().getSessionById(sessionId);
      if (updated) updateSessionNotification(sessionId, updated);
    });

    return sessionId;
  },
};

/**
 * Sync tool call status from editCards to agentStore message
 */
async function syncAgentToolCalls(sessionId: string): Promise<void> {
  const sessionStore = useLLMSessionStore.getState();
  const agentStore = useAgentStore.getState();
  const session = sessionStore.getSessionById(sessionId);

  if (!session || session.kind !== 'agent') return;

  const agentId = (session.input as AgentExecutorInput)?.agentId;
  const projectId = (session.input as AgentExecutorInput)?.projectId;
  const assistantMessageId = (session.result as AgentExecutorResult)?.assistantMessageId;

  if (!agentId || !projectId || !assistantMessageId) return;

  const cards = session.editCards ?? [];
  if (cards.length === 0) return;

  await agentStore.updateMessageToolCalls(
    projectId,
    agentId,
    assistantMessageId,
    toToolCallMetadata(cards)
  );
}

/**
 * Execute confirmed agent tool calls with sync.
 * After read operations are confirmed, tool_results will be included in the next LLM call.
 */
export async function executeAgentToolCalls(params: {
  sessionId: string;
  projectId: string;
  language: string;
  selections: Record<string, boolean>;
  options: HandlerOptions;
  invocationCaller?: InvocationCaller;
}): Promise<{ hasAcceptedReads: boolean }> {
  await applySessionEdits(params);
  await syncAgentToolCalls(params.sessionId);

  // Check if we have accepted read operations that need continuation
  const session = useLLMSessionStore.getState().getSessionById(params.sessionId);
  if (!session?.editCards) return { hasAcceptedReads: false };

  const { isReadTool } = await import('../toolCall/schemas/schemaRegistry');
  const hasAcceptedReads = session.editCards.some(
    c => c.toolCall.status === 'accepted' && isReadTool(c.toolCall.toolName)
  );

  // Return whether continuation is needed - caller handles the continuation
  return { hasAcceptedReads };
}

/** @deprecated Use executeAgentToolCalls instead */
export const applyAgentEdits = executeAgentToolCalls;

/**
 * Reject all agent edits with sync
 */
export async function rejectAllAgentEdits(params: {
  sessionId: string;
  reason?: string;
}): Promise<void> {
  rejectAllSessionEdits(params);
  await syncAgentToolCalls(params.sessionId);
}
