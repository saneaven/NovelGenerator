/**
 * AgentExecutor - Direct LLM execution for Agent workspace
 *
 * Uses LLMTaskExecutor directly without JourneyRuntime.
 * Manages agent-specific concerns:
 * - Message creation in agentStore
 * - Streaming via llmTaskStore (LLMTask handles session management)
 * - Function call handling
 */

import { useAgentStore } from '../store/agentStore';
import { useAgentUIStore } from '../store/agentUIStore';
import { useSettingsStore } from '../store/settingsStore';
import { useCredentialsStore } from '../store/credentialsStore';
import { useLLMSessionStore } from '../store/llmSessionStore';
import { startLLMSession } from '../llmSession';
import { LLMTaskMode, type AgentWorkspacePromptContext, type AgentTranslationPromptContext, createEmptyUserHistory } from '../llm';
import type { OutputMode } from '../llm/types';
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

    const settings = settingsStore.settings;
    const agentConfig = settingsStore.getFunctionConfig('agent');
    const providerConfig = credentialsStore.getProviderConfigForBackend(agentConfig.provider);

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

    // 2) Build history (exclude the empty assistant message we just added, keep current user)
    const fullHistory = agentStore.getMessages(input.projectId, input.agentId, language);
    const historyWithoutAssistant = fullHistory.slice(0, -1);

    // Merge trailing user messages (failed previous runs) into one
    let history = [...historyWithoutAssistant];
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

    const llmMode =
      input.mode === 'storyObject'
        ? LLMTaskMode.AGENT_STORYOBJECT
        : input.mode === 'outlineManager'
          ? LLMTaskMode.AGENT_OUTLINE_MANAGER
          : LLMTaskMode.AGENT_NOVEL_EDITOR;

    const promptContext: AgentWorkspacePromptContext = {
      projectId: input.projectId,
      outputLanguage: language,
      outputMode,
      enablePrefill: agentConfig.advanced.enablePrefill,
      enableThinking: agentConfig.advanced.thinkingMode === 'model',
      enableCustomThinking: agentConfig.advanced.thinkingMode === 'custom',
      functions: outputMode === 'tool_call' ? getFunctionsForSet('agent') : undefined,
      contextObjectIds: input.contextObjectIds,
    };

    // 3) Start session + stream via llmSessionStore
    const handle = startLLMSession<AgentExecutorInput, AgentExecutorResult>({
      kind: 'agent',
      label: 'AI Response',
      input,
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

      // 5) Handle function calls
      if (finalSession.functionCalls.length > 0) {
        await stageSessionEdits({
          sessionId,
          projectId: input.projectId,
          language: settings.mainLanguage,
          functionCalls: finalSession.functionCalls,
        });
        // Sync to agentStore
        await syncAgentFunctionCalls(sessionId);
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

    const translationConfig = settingsStore.getFunctionConfig('translation');
    const providerConfig = credentialsStore.getProviderConfigForBackend(translationConfig.provider);

    const promptContext: AgentTranslationPromptContext = {
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
      retryConfig: settingsStore.settings.retryConfig,
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
 * Sync function call status from editCards to agentStore message
 */
async function syncAgentFunctionCalls(sessionId: string): Promise<void> {
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

  await agentStore.updateMessageFunctionCalls(
    projectId,
    agentId,
    assistantMessageId,
    toFunctionCallMetadata(cards)
  );
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
}
