/**
 * AgentExecutor - Direct LLM execution for Agent workspace
 *
 * Uses LLMTaskExecutor directly without JourneyRuntime.
 * Manages agent-specific concerns:
 * - Message creation in agentStore
 * - Streaming via streamingStore
 * - Function call handling
 */

import { useAgentStore } from '../store/agentStore';
import { useAgentUIStore } from '../store/agentUIStore';
import { useStreamingStore } from '../store/streamingStore';
import { useSettingsStore } from '../store/settingsStore';
import { useLLMTaskStore } from '../store/llmTaskStore';
import { LLMTaskExecutor } from '../llmTask/LLMTaskExecutor';
import { LLMTaskMode, type AgentWorkspacePromptContext, type AgentTranslationPromptContext } from '../llm';
import type { OutputMode, LLMTaskResult } from '../llm/types';
import type { ContentPart } from '../llm/requestTypes';
import { getFunctionsForSet } from '../functionCall';
import {
  stageSessionEdits,
  applySessionEdits,
  rejectAllSessionEdits,
  toFunctionCallMetadata,
} from '../llmTask/functionCalls/functionCallEngine';
import type { HandlerOptions } from '../functionCall/applicator/types';
import { generateTempId } from '../utils/tempId';
import type { TaskSessionState } from '../llmTask';
import { registerSessionNotification, updateSessionNotification } from '../llmTask/notificationHelpers';

export interface AgentExecutorInput {
  projectId: string;
  agentId: string;
  mode: 'novelEditor' | 'storyObject' | 'outlineManager';
  userInput: string;
  outputLanguage: string;
  contextObjectIds?: string[];
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
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
    const streamingStore = useStreamingStore.getState();
    const settingsStore = useSettingsStore.getState();
    const llmTaskStore = useLLMTaskStore.getState();

    const settings = settingsStore.settings;
    const agentConfig = settingsStore.getFunctionConfig('agent');
    const providerConfig = settingsStore.getProviderConfig(agentConfig.provider);

    const userInput = input.userInput ?? '';
    const language = input.outputLanguage;
    const outputMode: OutputMode = settings.nativeOutputMode ? 'native_function_call' : 'tool_call';

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

    // 2) Create session for tracking
    const sessionId = `agent-${generateTempId()}`;
    const now = Date.now();

    const session: TaskSessionState<AgentExecutorInput, AgentExecutorResult> = {
      id: sessionId,
      kind: 'agent',
      input,
      label: 'AI Response',
      status: 'running',
      createdAt: now,
      updatedAt: now,
      isRead: false,
      contentParts: [],
      functionCallProgress: [],
      result: { agentId: input.agentId, assistantMessageId },
    };

    llmTaskStore.createSession(session as any);

    // Register notification
    registerSessionNotification(session as any, {
      onClick: () => useAgentUIStore.getState().openDetailModal(sessionId),
      onDismiss: () => llmTaskStore.clearSession(sessionId),
    });

    // Notify caller of sessionId immediately (for stop button to work during execution)
    onSessionCreated?.(sessionId);

    // 3) Build history (exclude the empty assistant message we just added)
    const fullHistory = agentStore.getMessages(input.projectId, input.agentId, language);
    const historyWithoutAssistant = fullHistory.slice(0, -1);

    // Remove the user message we just added (it goes into promptContext.userInput)
    const baseHistory = userInput.trim() ? historyWithoutAssistant.slice(0, -1) : historyWithoutAssistant;

    // Merge trailing user messages (failed previous runs)
    let previousHistory = baseHistory;
    const trailingUserTexts: string[] = [];
    while (previousHistory.length > 0 && previousHistory[previousHistory.length - 1].role === 'user') {
      const last = previousHistory[previousHistory.length - 1];
      trailingUserTexts.unshift(getMessageText(last.contentParts));
      previousHistory = previousHistory.slice(0, -1);
    }
    const combinedUserInput = [...trailingUserTexts, userInput].filter(Boolean).join('\n\n');

    const llmMode =
      input.mode === 'storyObject'
        ? LLMTaskMode.AGENT_STORYOBJECT
        : input.mode === 'outlineManager'
          ? LLMTaskMode.AGENT_OUTLINE_MANAGER
          : LLMTaskMode.AGENT_NOVEL_EDITOR;

    const promptContext: AgentWorkspacePromptContext = {
      userInput: combinedUserInput,
      projectId: input.projectId,
      outputLanguage: language,
      outputMode,
      enablePrefill: agentConfig.advanced.enablePrefill,
      enableThinking: agentConfig.advanced.thinkingMode === 'model',
      enableCustomThinking: agentConfig.advanced.thinkingMode === 'custom',
      functions: outputMode === 'tool_call' ? getFunctionsForSet('agent') : undefined,
      contextObjectIds: input.contextObjectIds,
    };

    // 4) Execute using LLMTaskExecutor
    const executor = new LLMTaskExecutor();
    llmTaskStore.registerAbortController(sessionId, { abort: () => executor.abort() } as AbortController);

    let finalResult: LLMTaskResult | null = null;

    const updateSession = (partial: Partial<TaskSessionState>) => {
      llmTaskStore.updateSession(sessionId, partial as any);
      const currentSession = llmTaskStore.getSessionById(sessionId);
      if (currentSession) {
        updateSessionNotification(sessionId, currentSession);
      }
    };

    try {
      await executor.execute(
        {
          mode: llmMode,
          projectId: input.projectId,
          promptContext,
          provider: agentConfig.provider,
          providerConfig,
          model: agentConfig.model,
          temperature: agentConfig.temperature,
          thinkingMode: agentConfig.advanced.thinkingMode as any,
          thinkingConfig: agentConfig.advanced.thinkingConfig,
          retryConfig: settings.retryConfig,
        },
        {
          onStreamingUpdate: (parts) => {
            // Use lightweight streamingStore during streaming
            streamingStore.setStreamingContent(assistantMessageId, parts);
            updateSession({ contentParts: parts });
          },
          onFunctionProgress: (progress) => updateSession({ functionCallProgress: progress }),
          onComplete: (r) => {
            // Clear streaming content
            streamingStore.clearStreamingContent(assistantMessageId);
            finalResult = r;
          },
          onError: () => {
            streamingStore.clearStreamingContent(assistantMessageId);
          },
        },
        previousHistory
      );
    } catch (error) {
      if (isAbortError(error)) {
        updateSession({ status: 'cancelled' });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        updateSession({ status: 'error', error: message });
      }
      return sessionId;
    } finally {
      llmTaskStore.unregisterAbortController(sessionId);
    }

    if (!finalResult) {
      updateSession({ status: 'error', error: 'AI request finished without a result.' });
      return sessionId;
    }

    const result = finalResult as LLMTaskResult;

    updateSession({
      provider: result.provider,
      model: result.model,
      usage: result.usage,
    });

    // 5) Final update + backend sync
    agentStore.updateMessageContentLocal(
      input.projectId,
      input.agentId,
      assistantMessageId,
      result.contentParts,
      language,
      result.thinkingDetails
    );

    try {
      await agentStore.updateMessage(
        input.projectId,
        input.agentId,
        assistantMessageId,
        result.contentParts,
        language,
        result.thinkingDetails
      );
    } catch (error) {
      console.error('Failed to sync message to backend:', error);
    }

    // 6) Handle function calls
    if (result.functionCalls.length > 0) {
      await stageSessionEdits({
        sessionId,
        projectId: input.projectId,
        language: settings.mainLanguage,
        functionCalls: result.functionCalls,
      });
      // Sync to agentStore
      await syncAgentFunctionCalls(sessionId);
      updateSession({ status: 'pending_confirmation' });
    } else {
      updateSession({ status: 'success' });
    }

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
    const llmTaskStore = useLLMTaskStore.getState();

    const translationConfig = settingsStore.getFunctionConfig('translation');
    const providerConfig = settingsStore.getProviderConfig(translationConfig.provider);

    // Create session for tracking
    const sessionId = `agent-translation-${generateTempId()}`;
    const now = Date.now();

    const session: TaskSessionState<AgentTranslationInput, AgentTranslationResult> = {
      id: sessionId,
      kind: 'agentTranslation',
      input,
      label: 'Agent Translation',
      status: 'running',
      createdAt: now,
      updatedAt: now,
      isRead: false,
      contentParts: [],
      functionCallProgress: [],
    };

    llmTaskStore.createSession(session as any);

    // Register notification
    registerSessionNotification(session as any, {
      onClick: () => useAgentUIStore.getState().openDetailModal(sessionId),
      onDismiss: () => llmTaskStore.clearSession(sessionId),
    });

    // Notify caller of sessionId immediately (for stop button to work during execution)
    onSessionCreated?.(sessionId);

    const promptContext: AgentTranslationPromptContext = {
      userInput: '',
      projectId: input.projectId,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      sourceContent: input.sourceContent,
      outputMode: 'raw_output',
      outputLanguage: input.targetLanguage,
      enablePrefill: translationConfig.advanced.enablePrefill,
      enableThinking: translationConfig.advanced.thinkingMode === 'model',
      enableCustomThinking: translationConfig.advanced.thinkingMode === 'custom',
    };

    const executor = new LLMTaskExecutor();
    llmTaskStore.registerAbortController(sessionId, { abort: () => executor.abort() } as AbortController);

    const resultRef: { current: LLMTaskResult | null } = { current: null };

    const updateSession = (partial: Partial<TaskSessionState>) => {
      llmTaskStore.updateSession(sessionId, partial as any);
      const currentSession = llmTaskStore.getSessionById(sessionId);
      if (currentSession) {
        updateSessionNotification(sessionId, currentSession);
      }
    };

    try {
      await executor.execute(
        {
          mode: LLMTaskMode.AGENT_TRANSLATION,
          projectId: input.projectId,
          promptContext,
          provider: translationConfig.provider,
          providerConfig,
          model: translationConfig.model,
          temperature: translationConfig.temperature,
          thinkingMode: translationConfig.advanced.thinkingMode as any,
          thinkingConfig: translationConfig.advanced.thinkingConfig,
          retryConfig: settingsStore.settings.retryConfig,
        },
        {
          onStreamingUpdate: (parts) => updateSession({ contentParts: parts }),
          onComplete: (r) => {
            resultRef.current = r;
          },
          onError: () => {},
        }
      );
    } catch (error) {
      if (isAbortError(error)) {
        updateSession({ status: 'cancelled' });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        updateSession({ status: 'error', error: message });
      }
      return sessionId;
    } finally {
      llmTaskStore.unregisterAbortController(sessionId);
    }

    const finalResult = resultRef.current;
    if (!finalResult) {
      updateSession({ status: 'error', error: 'Translation finished without a result.' });
      return sessionId;
    }

    updateSession({
      provider: finalResult.provider,
      model: finalResult.model,
      usage: finalResult.usage,
    });

    const translated = finalResult.contentParts
      .filter((p: ContentPart) => p.type === 'content')
      .map((p: ContentPart) => p.text)
      .join('')
      .trim();

    if (!translated) {
      updateSession({ status: 'error', error: 'AI did not generate a translation.' });
      return sessionId;
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

    updateSession({
      status: 'success',
      result: { agentId: input.agentId, messageId: input.messageId, targetLanguage: input.targetLanguage },
    });

    return sessionId;
  },
};

/**
 * Sync function call status from editCards to agentStore message
 */
async function syncAgentFunctionCalls(sessionId: string): Promise<void> {
  const llmTaskStore = useLLMTaskStore.getState();
  const agentStore = useAgentStore.getState();
  const session = llmTaskStore.getSessionById(sessionId);

  if (!session || session.kind !== 'agent') return;

  const agentId = (session.input as AgentExecutorInput)?.agentId;
  const projectId = (session.input as AgentExecutorInput)?.projectId;
  const assistantMessageId = (session.result as AgentExecutorResult)?.assistantMessageId;

  if (!agentId || !projectId || !assistantMessageId) return;

  const cards = session.editCards ?? [];
  if (cards.length === 0) return;

  await agentStore.updateMessageFunctionCalls(
    projectId,
    agentId,
    assistantMessageId,
    toFunctionCallMetadata(cards)
  );
}

/**
 * Stage agent edits with sync
 */
export async function stageAgentEdits(params: {
  sessionId: string;
  projectId: string;
  language: string;
  functionCalls: Parameters<typeof stageSessionEdits>[0]['functionCalls'];
}): Promise<void> {
  await stageSessionEdits(params);
  await syncAgentFunctionCalls(params.sessionId);
}

/**
 * Apply agent edits with sync
 */
export async function applyAgentEdits(params: {
  sessionId: string;
  projectId: string;
  language: string;
  selections: Record<string, boolean>;
  options: HandlerOptions;
}): Promise<void> {
  await applySessionEdits(params);
  await syncAgentFunctionCalls(params.sessionId);

  // Update notification with new status
  const session = useLLMTaskStore.getState().getSessionById(params.sessionId);
  if (session) {
    updateSessionNotification(params.sessionId, session);
  }
}

/**
 * Reject all agent edits with sync
 */
export async function rejectAllAgentEdits(params: {
  sessionId: string;
  reason?: string;
}): Promise<void> {
  rejectAllSessionEdits(params);
  await syncAgentFunctionCalls(params.sessionId);

  // Update notification with new status
  const session = useLLMTaskStore.getState().getSessionById(params.sessionId);
  if (session) {
    updateSessionNotification(params.sessionId, session);
  }
}
