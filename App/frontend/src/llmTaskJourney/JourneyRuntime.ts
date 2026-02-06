import type { ChatMessage, ToolCallMetadata } from '../llm/requestTypes';
import { PromptManager } from '../llm/PromptManager';
import { useSettingsStore } from '../store/settingsStore';
import { useLLMSessionStore } from '../store/llmSessionStore';
import { useJourneyStore, type Journey } from '../store/journeyStore';
import { startLLMSession } from '../llmSession';
import {
  stageSessionEdits,
  applySessionEdits,
  rejectAllSessionEdits,
  toToolCallMetadata,
} from '../llmTask/toolCalls/toolCallEngine';
import type { HandlerOptions } from '../toolCall/apply/types';
import { registerJourneyNotification, updateJourneyNotification } from './notificationHelpers';
import { generateTempId } from '../utils/tempId';
import { getJourneySpec, type JourneyKind } from './journeySpecs';
import type { LLMTaskJourney, JourneySpec } from './types';
import { createChatMessage, collapseContentParts } from './types';

// =====================================================================
// Journey Tool Call Sync Helpers (Simplified)
// =====================================================================

function findLastAssistantMessageId(journey: Journey | LLMTaskJourney): string | null {
  for (let i = journey.messages.length - 1; i >= 0; i--) {
    const msg = journey.messages[i];
    if (msg.role === 'assistant') return msg.id;
  }
  return null;
}

function updateJourneyAssistantToolCalls(params: {
  journeyId: string;
  assistantMessageId: string;
  toolCalls: ToolCallMetadata[];
}): void {
  const { journeyId, assistantMessageId, toolCalls } = params;
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  if (!journey) return;

  const nextMessages = journey.messages.map((m) =>
    m.id === assistantMessageId ? { ...m, toolCalls } : m
  );
  journeyStore.updateJourney(journeyId, { messages: nextMessages });
}

function syncAssistantToolCallsFromCards(params: {
  journeyId: string;
  assistantMessageId: string;
}): void {
  const { journeyId, assistantMessageId } = params;
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  const cards = journey?.editCards ?? [];
  if (!cards.length) return;
  updateJourneyAssistantToolCalls({
    journeyId,
    assistantMessageId,
    toolCalls: toToolCallMetadata(cards),
  });
}

/**
 * Stage edits for journey - stores in both llmTaskStore and journeyStore
 */
async function stageJourneyEdits(params: {
  journeyId: string;
  assistantMessageId: string;
  projectId: string;
  language: string;
  toolCalls: ToolCallMetadata[];
}): Promise<void> {
  const { journeyId, assistantMessageId, projectId, language, toolCalls } = params;
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  const sessionId = journey?.activeSessionId;

  if (!sessionId) {
    throw new Error('No session found for journey');
  }

  // Store initial (pending) tool calls on the assistant message
  updateJourneyAssistantToolCalls({ journeyId, assistantMessageId, toolCalls });

  // Stage edits using journey.sessionId
  await stageSessionEdits({ sessionId, projectId, language, toolCalls });

  // Copy editCards from llmSessionStore to journeyStore
  const session = useLLMSessionStore.getState().getSessionById(sessionId);
  if (session?.editCards) {
    journeyStore.updateJourney(journeyId, { editCards: session.editCards });
  }

  // Mirror validation results back into assistant message
  syncAssistantToolCallsFromCards({ journeyId, assistantMessageId });
}

/**
 * Apply journey edits with sync
 */
export async function applyJourneyEdits(params: {
  journeyId: string;
  projectId: string;
  language: string;
  selections: Record<string, boolean>;
  options: HandlerOptions;
}): Promise<void> {
  const { journeyId, projectId, language, selections, options } = params;
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  const assistantMessageId = journey ? findLastAssistantMessageId(journey) : null;
  const sessionId = journey?.activeSessionId;

  if (!sessionId) {
    throw new Error('No session found for journey');
  }

  // Use journey.sessionId for applySessionEdits
  await applySessionEdits({ sessionId, projectId, language, selections, options });

  // Copy updated editCards and status from llmSessionStore to journeyStore
  const session = useLLMSessionStore.getState().getSessionById(sessionId);
  if (session) {
    journeyStore.updateJourney(journeyId, {
      editCards: session.editCards,
      status: session.status,
      error: session.error,
    });
  }

  if (assistantMessageId) {
    syncAssistantToolCallsFromCards({ journeyId, assistantMessageId });
  }

  // Update notification with new status
  const updatedJourney = journeyStore.getJourneyById(journeyId);
  if (updatedJourney) {
    updateJourneyNotification(journeyId, updatedJourney);
  }
}

/**
 * Reject all journey edits with sync
 */
export function rejectAllJourneyEdits(params: { journeyId: string; reason?: string }): void {
  const { journeyId, reason } = params;
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  const assistantMessageId = journey ? findLastAssistantMessageId(journey) : null;
  const sessionId = journey?.activeSessionId;

  if (!sessionId) {
    console.error('No session found for journey');
    return;
  }

  // Use journey.sessionId for rejectAllSessionEdits
  rejectAllSessionEdits({ sessionId, reason });

  // Copy updated editCards and status from llmSessionStore to journeyStore
  const session = useLLMSessionStore.getState().getSessionById(sessionId);
  if (session) {
    journeyStore.updateJourney(journeyId, {
      editCards: session.editCards,
      status: session.status,
    });
  }

  if (assistantMessageId) {
    syncAssistantToolCallsFromCards({ journeyId, assistantMessageId });
  }

  // Update notification with new status
  const updatedJourney = journeyStore.getJourneyById(journeyId);
  if (updatedJourney) {
    updateJourneyNotification(journeyId, updatedJourney);
  }
}

/**
 * Get language for journey based on editing targets
 */
function getJourneyLanguage(journey: Journey): string {
  const t = journey.editingTargets;
  if (t.kind === 'translateObjects') return t.targetLanguage;
  if (t.kind === 'aiEdit') return t.language;
  return useSettingsStore.getState().getSettingsOrThrow().mainLanguage;
}

/**
 * Convert Journey to LLMTaskJourney for spec compatibility
 */
function toLegacyJourney(journey: Journey): LLMTaskJourney {
  return {
    id: journey.id,
    label: journey.label,
    createdAt: journey.createdAt,
    updatedAt: journey.updatedAt,
    editingTargets: journey.editingTargets,
    tools: journey.tools,
    messages: journey.messages,
  };
}

// =====================================================================
// Core Runtime Functions (Simplified like Agent)
// =====================================================================

function extractUserInput(kind: JourneyKind, input: any): string {
  if (kind === 'aiEdit') return (input as any).userRequest || '';
  if (kind === 'translateObjects') return (input as any).userInput || '';
  if (kind === 'imagePrompt' || kind === 'sceneImage') return (input as any).userRequest || '';
  return '';
}

type AttemptContext = {
  journeyId: string;
  sessionId: string;
  assistantMessageId: string;
  llmConfig: ReturnType<JourneySpec<any>['buildLLMConfig']>;
  spec: JourneySpec<any>;
};

function createFailedSession(params: {
  kind: JourneyKind;
  label: string;
  input: any;
  error: string;
}): string {
  const { kind, label, input, error } = params;
  const sessionId = `llm-${generateTempId()}`;
  const now = Date.now();
  useLLMSessionStore.getState().createSession({
    id: sessionId,
    kind: kind as any,
    input,
    status: 'error',
    label,
    createdAt: now,
    updatedAt: now,
    contentParts: [],
    toolCallProgress: [],
    toolCalls: [],
    error,
  } as any);
  return sessionId;
}

function startAttempt(params: { journeyId: string }): AttemptContext {
  const { journeyId } = params;
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  if (!journey) {
    throw new Error(`Journey not found: ${journeyId}`);
  }

  const spec = getJourneySpec(journey.kind) as JourneySpec<any>;
  const legacyJourney = toLegacyJourney(journey);

  let llmConfig: ReturnType<JourneySpec<any>['buildLLMConfig']>;
  try {
    llmConfig = spec.buildLLMConfig(journey.input, legacyJourney);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedSessionId = createFailedSession({
      kind: journey.kind,
      label: journey.label,
      input: journey.input,
      error: message,
    });
    journeyStore.updateJourney(journeyId, { status: 'error', error: message, activeSessionId: failedSessionId });
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    return { journeyId, sessionId: failedSessionId, assistantMessageId: '', llmConfig: {} as any, spec };
  }

  const history = [...journey.messages];

  const assistantMessage = createChatMessage({ role: 'assistant', content: '', idPrefix: 'journey-assistant' });
  const assistantMessageId = assistantMessage.id;

  const tools = PromptManager.getToolsForMode(llmConfig.mode, llmConfig.promptContext);

  const handle = startLLMSession({
    kind: journey.kind as any,
    label: journey.label,
    input: journey.input,
    mode: llmConfig.mode,
    projectId: llmConfig.projectId,
    promptContext: llmConfig.promptContext,
    thinkingMode: llmConfig.thinkingMode as any,
    thinkingConfig: llmConfig.thinkingConfig as any,
    history,
  });

  const sessionHistory = [...(journey.sessionHistory ?? []), handle.sessionId];

  journeyStore.updateJourney(journeyId, {
    messages: [...journey.messages, assistantMessage],
    tools,
    status: 'running',
    error: undefined,
    warning: undefined,
    activeSessionId: handle.sessionId,
    sessionHistory,
    editCards: undefined,
  });

  updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);

  void handle.done.then((session) => finalizeAttempt({ journeyId, sessionId: handle.sessionId, assistantMessageId, llmConfig, spec }, session));

  return { journeyId, sessionId: handle.sessionId, assistantMessageId, llmConfig, spec };
}

async function finalizeAttempt(ctx: AttemptContext, session: any): Promise<void> {
  const { journeyId, assistantMessageId, llmConfig, spec } = ctx;
  const journeyStore = useJourneyStore.getState();

  const journey = journeyStore.getJourneyById(journeyId);
  if (!journey) return;

  if (session.status === 'cancelled') {
    journeyStore.updateJourney(journeyId, { status: 'cancelled' });
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    return;
  }

  if (session.status === 'error') {
    journeyStore.updateJourney(journeyId, { status: 'error', error: session.error ?? 'AI request failed.' });
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    return;
  }

  // Finalize assistant message (content + thinking + tool calls)
  const currentJourney = journeyStore.getJourneyById(journeyId);
  if (!currentJourney) return;

  const idx = currentJourney.messages.findIndex((m) => m.id === assistantMessageId);
  if (idx < 0) return;

  const finalizedAssistant: ChatMessage = {
    ...currentJourney.messages[idx],
    contentParts: session.contentParts ?? [],
    toolCalls: session.toolCalls ?? [],
    thinking_details: session.thinkingDetails ?? undefined,
  };
  const finalizedMessages = currentJourney.messages.slice();
  finalizedMessages[idx] = finalizedAssistant;

  journeyStore.updateJourney(journeyId, {
    messages: finalizedMessages,
    provider: session.provider,
    model: session.model,
    usage: session.usage,
  });

  // Determine output mode from promptContext
  const outputMode = (llmConfig.promptContext as any).outputMode ?? 'tool_call';

  // Raw output mode: delegate to spec.handleRawOutput
  if (outputMode === 'raw_output') {
    const text = collapseContentParts(session.contentParts ?? []).trim();
    if (!text) {
      journeyStore.updateJourney(journeyId, { status: 'error', error: 'AI response was empty.' });
      updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
      return;
    }

    try {
      const specWithHandler = spec as JourneySpec<any, any>;
      const updatedJourney = journeyStore.getJourneyById(journeyId)!;
      const updatedLegacyJourney = toLegacyJourney(updatedJourney);

      if (specWithHandler.handleRawOutput) {
        const result = await specWithHandler.handleRawOutput(updatedJourney.input, updatedLegacyJourney, text);
        if (result !== undefined) {
          journeyStore.updateJourney(journeyId, { result });
        }
      }
      journeyStore.updateJourney(journeyId, { status: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      journeyStore.updateJourney(journeyId, { status: 'error', error: message });
    }
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    return;
  }

  // Tool call modes: stage edit cards for confirmation
  const toolCalls = session.toolCalls ?? [];
  if (!toolCalls.length) {
    journeyStore.updateJourney(journeyId, { status: 'error', error: 'AI response did not include any actions to apply.' });
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    return;
  }

  const updatedJourney = journeyStore.getJourneyById(journeyId)!;
  const language = getJourneyLanguage(updatedJourney);

  try {
    await stageJourneyEdits({
      journeyId,
      assistantMessageId: finalizedAssistant.id,
      projectId: llmConfig.projectId,
      language,
      toolCalls,
    });
    journeyStore.updateJourney(journeyId, { status: 'pending_confirmation' });
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    journeyStore.updateJourney(journeyId, { status: 'error', error: message });
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
  }
}

// =====================================================================
// Public API
// =====================================================================

export const JourneyRuntime = {
  /**
   * Start a new journey
   * Creates journey in journeyStore (permanent) and returns journeyId
   */
  start<TInput>(kind: JourneyKind, input: TInput): { journeyId: string; sessionId: string } {
    const journeyId = `llm-journey-${generateTempId()}`;
    const journeyStore = useJourneyStore.getState();

    const spec = getJourneySpec(kind) as JourneySpec<TInput>;
    const label = spec.label(input);
    const now = Date.now();
    const userInput = extractUserInput(kind, input);
    const userMessage = createChatMessage({ role: 'user', content: userInput, idPrefix: 'journey-user' });

    // Create journey in journeyStore (permanent storage)
    const journey: Journey<TInput, unknown> = {
      id: journeyId,
      kind,
      input,
      label,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      editingTargets: spec.buildEditingTargets(input),
      tools: undefined,
      messages: [userMessage],
      activeSessionId: undefined,
      sessionHistory: undefined,
    };

    journeyStore.createJourney(journey as any);

    // Register notification with journeyStore modal
    registerJourneyNotification(journey as any, {
      onClick: () => useJourneyStore.getState().openDetailModal(journeyId),
      onDismiss: () => useJourneyStore.getState().clearJourney(journeyId),
    });

    const ctx = startAttempt({ journeyId });
    return { journeyId, sessionId: ctx.sessionId };
  },

  /**
   * Send feedback to continue a journey (multi-turn)
   * Like Agent: just add raw user message and run attempt
   */
  sendFeedback(params: { journeyId: string; text: string }): { sessionId: string } | undefined {
    const { journeyId, text } = params;
    const journeyStore = useJourneyStore.getState();
    const journey = journeyStore.getJourneyById(journeyId);

    if (!journey) {
      throw new Error(`Journey not found: ${journeyId}`);
    }

    if (journey.status === 'running' || journey.status === 'applying') {
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;

    // Like Agent: just add raw user message
    journeyStore.updateJourney(journeyId, {
      messages: [
        ...journey.messages,
        createChatMessage({ role: 'user', content: trimmed, idPrefix: 'journey-user' }),
      ],
    });

    const ctx = startAttempt({ journeyId });
    return { sessionId: ctx.sessionId };
  },
};
