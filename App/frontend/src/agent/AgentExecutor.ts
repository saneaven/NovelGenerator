/**
 * AgentExecutor - Direct LLM execution for Agent workspace
 *
 * Uses LLMTask directly and persists tool call state into agentStore messages.
 * llmSessionStore is used only for streaming/cancellation lifecycle.
 */

import { useAgentStore } from '../store/agentStore';
import { useAgentUIStore } from '../store/agentUIStore';
import { useSettingsStore } from '../store/settingsStore';
import { useCredentialsStore } from '../store/credentialsStore';
import { useLLMSessionStore } from '../store/llmSessionStore';
import { useSubAgentStore } from '../store/subAgentStore';
import { useErrorStore } from '../store/errorStore';
import { startLLMSession } from '../llmSession';
import { LLMTaskMode, type AgentPromptContext, type AgentTranslationPromptContext, createEmptyUserHistory } from '../llm';
import type { OutputMode } from '../llm/types';
import type { ChatMessage, ContentPart, ToolCallMetadata } from '../llm/requestTypes';
import { getToolsForSet } from '../toolCall';
import { buildCallToolSchema } from '../subAgent/tools/SubAgentCallTools';
import type { AgentRunMode, WorkspaceSurface, InvocationCaller } from '../types/agentRuntime';
import {
  stageToolCalls,
  applyToolCalls,
  rejectAllToolCalls,
  markToolCallsRunning,
} from '../toolCall/runtime';
import type { HandlerOptions } from '../toolCall/apply/types';
import type { ToolCallDecisionMap, ToolCallStatus } from '../toolCall/types';
import { isReadTool } from '../toolCall/schemas/schemaRegistry';
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
    .filter((part) => part.type === 'content')
    .map((part) => part.text)
    .join('');
}

function getAllowedToolNames(tools: Array<{ name?: unknown }> | undefined): string[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  const names = tools
    .map((tool) => (typeof tool?.name === 'string' ? tool.name : null))
    .filter((name): name is string => Boolean(name && name.trim()));
  return names.length > 0 ? names : undefined;
}

function getMessageToolCalls(params: {
  projectId: string;
  agentId: string;
  assistantMessageId: string;
}): ToolCallMetadata[] {
  const { projectId, agentId, assistantMessageId } = params;
  const agent = useAgentStore.getState().getAgent(projectId, agentId);
  const message = agent?.messages.find((item) => item.id === assistantMessageId);
  if (!Array.isArray(message?.toolCalls)) return [];
  return message.toolCalls;
}

async function removePlaceholderMessage(params: {
  projectId: string;
  agentId: string;
  assistantMessageId: string;
}): Promise<void> {
  const { projectId, agentId, assistantMessageId } = params;
  try {
    await useAgentStore.getState().deleteMessage(projectId, agentId, assistantMessageId);
  } catch (error) {
    console.error('Failed to remove placeholder assistant message:', error);
  }
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
        .filter((subAgent) => subAgent.enabled && subAgent.allowed_invocation_modes.includes(input.runMode))
        .sort((left, right) => left.display_name.localeCompare(right.display_name))
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
        await removePlaceholderMessage({
          projectId: input.projectId,
          agentId: input.agentId,
          assistantMessageId,
        });

        const message =
          finalSession.status === 'cancelled'
            ? 'Agent request was cancelled.'
            : (finalSession.error ?? 'Agent request failed.');
        useErrorStore.getState().showError('Agent Request Failed', message);
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

      // 5) Stage tool calls directly into the assistant message
      if (finalSession.toolCalls.length > 0) {
        try {
          const allowedToolNames = getAllowedToolNames((mergedPromptContext as any).tools);
          const staged = await stageToolCalls({
            projectId: input.projectId,
            language: settings.mainLanguage,
            toolCalls: finalSession.toolCalls,
            allowedToolNames,
          });

          await agentStore.updateMessageToolCalls(
            input.projectId,
            input.agentId,
            assistantMessageId,
            staged.toolCalls
          );
        } catch (error) {
          console.error('Failed to stage agent tool calls:', error);
          useErrorStore.getState().showError(
            'Tool Call Error',
            error instanceof Error ? error.message : String(error)
          );
        }
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
      registerSessionNotification(initialSession, {
        onClick: () => useAgentUIStore.getState().openDetailModal(sessionId),
        onDismiss: () => sessionStore.clearSession(sessionId),
      });
    }

    onSessionCreated?.(sessionId);

    void handle.done.then(async (finalSession) => {
      const currentSession = useLLMSessionStore.getState().getSessionById(sessionId);
      if (currentSession) updateSessionNotification(sessionId, currentSession);

      if (finalSession.status !== 'success') {
        return;
      }

      const translated = finalSession.contentParts
        .filter((part: ContentPart) => part.type === 'content')
        .map((part: ContentPart) => part.text)
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
 * Execute confirmed agent tool calls from message.toolCalls.
 * After read operations are confirmed, tool_results will be included in the next LLM call.
 */
export async function executeAgentToolCalls(params: {
  projectId: string;
  agentId: string;
  assistantMessageId: string;
  language: string;
  decisions: ToolCallDecisionMap;
  options: HandlerOptions;
  invocationCaller?: InvocationCaller;
}): Promise<{ hasAcceptedReads: boolean; hasPendingDecisions: boolean }> {
  const { projectId, agentId, assistantMessageId, language, decisions, options, invocationCaller } = params;
  const agentStore = useAgentStore.getState();

  const toolCalls = getMessageToolCalls({ projectId, agentId, assistantMessageId });
  if (toolCalls.length === 0) {
    return { hasAcceptedReads: false, hasPendingDecisions: false };
  }

  const effectiveOptions: HandlerOptions = {
    ...options,
    agentId: options.agentId ?? agentId,
    parentAgentMessageId: options.parentAgentMessageId ?? assistantMessageId,
  };

  const runningToolCalls = markToolCallsRunning({ toolCalls, decisions });
  await agentStore.updateMessageToolCalls(projectId, agentId, assistantMessageId, runningToolCalls);

  const applied = await applyToolCalls({
    projectId,
    language,
    toolCalls: runningToolCalls,
    decisions,
    options: effectiveOptions,
    invocationCaller,
  });

  await agentStore.updateMessageToolCalls(projectId, agentId, assistantMessageId, applied.toolCalls);

  const hasAcceptedReads = applied.toolCalls.some(
    (toolCall) => toolCall.status === 'accepted' && isReadTool(toolCall.tool_name)
  );

  const hasPendingDecisions = applied.toolCalls.some((toolCall) => {
    const status = (toolCall.status ?? 'pending') as ToolCallStatus;
    return status === 'pending' || status === 'validating' || status === 'running';
  });

  return { hasAcceptedReads, hasPendingDecisions };
}

/**
 * Reject all pending agent tool calls in message.toolCalls.
 */
export async function rejectAllAgentEdits(params: {
  projectId: string;
  agentId: string;
  assistantMessageId: string;
  reason?: string;
}): Promise<void> {
  const { projectId, agentId, assistantMessageId, reason } = params;
  const agentStore = useAgentStore.getState();

  const toolCalls = getMessageToolCalls({ projectId, agentId, assistantMessageId });
  if (toolCalls.length === 0) return;

  const rejected = rejectAllToolCalls({ toolCalls, reason });
  await agentStore.updateMessageToolCalls(projectId, agentId, assistantMessageId, rejected.toolCalls);
}
