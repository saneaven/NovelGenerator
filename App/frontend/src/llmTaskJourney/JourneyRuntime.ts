import type { ChatMessage, FunctionCallMetadata } from '../llm/requestTypes';
import { PromptManager } from '../llm/PromptManager';
import { useSettingsStore } from '../store/settingsStore';
import { useLLMTaskStore } from '../store/llmTaskStore';
import { useJourneyStore, type Journey } from '../store/journeyStore';
import { LLMTaskExecutor } from '../llmTask/LLMTaskExecutor';
import {
  stageSessionEdits,
  applySessionEdits,
  rejectAllSessionEdits,
  toFunctionCallMetadata,
} from '../llmTask/functionCalls/functionCallEngine';
import type { HandlerOptions } from '../functionCall/applicator/types';
import { registerJourneyNotification, updateJourneyNotification } from './notificationHelpers';
import { generateTempId } from '../utils/tempId';
import { getJourneySpec, type JourneyKind } from './journeySpecs';
import type { LLMTaskJourney, JourneySpec } from './types';
import { createChatMessage, collapseContentParts } from './types';

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

// =====================================================================
// Journey Function Call Sync Helpers (Simplified)
// =====================================================================

function findLastAssistantMessageId(journey: Journey | LLMTaskJourney): string | null {
  for (let i = journey.messages.length - 1; i >= 0; i--) {
    const msg = journey.messages[i];
    if (msg.role === 'assistant') return msg.id;
  }
  return null;
}

function updateJourneyAssistantFunctionCalls(params: {
  journeyId: string;
  assistantMessageId: string;
  functionCalls: FunctionCallMetadata[];
}): void {
  const { journeyId, assistantMessageId, functionCalls } = params;
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  if (!journey) return;

  const nextMessages = journey.messages.map((m) =>
    m.id === assistantMessageId ? { ...m, functionCalls } : m
  );
  journeyStore.updateJourney(journeyId, { messages: nextMessages });
}

function syncAssistantFunctionCallsFromCards(params: {
  journeyId: string;
  assistantMessageId: string;
}): void {
  const { journeyId, assistantMessageId } = params;
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  const cards = journey?.editCards ?? [];
  if (!cards.length) return;
  updateJourneyAssistantFunctionCalls({
    journeyId,
    assistantMessageId,
    functionCalls: toFunctionCallMetadata(cards),
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
  functionCalls: FunctionCallMetadata[];
}): Promise<void> {
  const { journeyId, assistantMessageId, projectId, language, functionCalls } = params;
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  const sessionId = journey?.sessionId;

  if (!sessionId) {
    throw new Error('No session found for journey');
  }

  // Store initial (pending) tool calls on the assistant message
  updateJourneyAssistantFunctionCalls({ journeyId, assistantMessageId, functionCalls });

  // Stage edits using journey.sessionId
  await stageSessionEdits({ sessionId, projectId, language, functionCalls });

  // Copy editCards from llmTaskStore to journeyStore
  const session = useLLMTaskStore.getState().getSessionById(sessionId);
  if (session?.editCards) {
    journeyStore.updateJourney(journeyId, { editCards: session.editCards });
  }

  // Mirror validation results back into assistant message
  syncAssistantFunctionCallsFromCards({ journeyId, assistantMessageId });
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
  const sessionId = journey?.sessionId;

  if (!sessionId) {
    throw new Error('No session found for journey');
  }

  // Use journey.sessionId for applySessionEdits
  await applySessionEdits({ sessionId, projectId, language, selections, options });

  // Copy updated editCards and status from llmTaskStore to journeyStore
  const session = useLLMTaskStore.getState().getSessionById(sessionId);
  if (session) {
    journeyStore.updateJourney(journeyId, {
      editCards: session.editCards,
      status: session.status,
      error: session.error,
    });
  }

  if (assistantMessageId) {
    syncAssistantFunctionCallsFromCards({ journeyId, assistantMessageId });
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
  const sessionId = journey?.sessionId;

  if (!sessionId) {
    console.error('No session found for journey');
    return;
  }

  // Use journey.sessionId for rejectAllSessionEdits
  rejectAllSessionEdits({ sessionId, reason });

  // Copy updated editCards and status from llmTaskStore to journeyStore
  const session = useLLMTaskStore.getState().getSessionById(sessionId);
  if (session) {
    journeyStore.updateJourney(journeyId, {
      editCards: session.editCards,
      status: session.status,
    });
  }

  if (assistantMessageId) {
    syncAssistantFunctionCallsFromCards({ journeyId, assistantMessageId });
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
  return useSettingsStore.getState().settings.mainLanguage;
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
    functions: journey.functions,
    messages: journey.messages,
  };
}

// =====================================================================
// Core Runtime Functions (Simplified like Agent)
// =====================================================================

/**
 * Initialize journey - just store initial user message and functions
 * Like Agent: store raw user message, let LLMTask render templates
 */
async function initJourney(params: { journeyId: string; kind: JourneyKind; input: any }): Promise<void> {
  const { journeyId, kind, input } = params;
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  if (!journey) return;

  const spec = getJourneySpec(kind);

  // Extract user input based on journey kind
  const userInput = (() => {
    if (kind === 'aiEdit') return (input as any).userRequest || '';
    if (kind === 'translateObjects') return (input as any).userInput || '';
    if (kind === 'imagePrompt' || kind === 'sceneImage') return (input as any).userRequest || '';
    return '';
  })();

  // Build LLM config to get functions
  const llmConfig = spec.buildLLMConfig(input, toLegacyJourney(journey));
  const functions = PromptManager.getFunctionsForMode(llmConfig.mode, llmConfig.promptContext);

  // Store initial user message as raw text (like Agent)
  journeyStore.updateJourney(journeyId, {
    messages: [
      createChatMessage({ role: 'user', content: userInput, idPrefix: 'journey-user' }),
    ],
    functions,
  });
}

/**
 * Run attempt - pass raw history to LLMTask like Agent
 * LLMTask handles all template rendering
 */
async function runAttempt(params: { journeyId: string }): Promise<void> {
  const { journeyId } = params;
  const journeyStore = useJourneyStore.getState();

  const journey = journeyStore.getJourneyById(journeyId);
  if (!journey) {
    throw new Error(`Journey not found: ${journeyId}`);
  }

  const spec = getJourneySpec(journey.kind);
  const legacyJourney = toLegacyJourney(journey);

  // Build LLM config using spec
  let llmConfig: ReturnType<typeof spec.buildLLMConfig>;
  try {
    llmConfig = spec.buildLLMConfig(journey.input, legacyJourney);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    journeyStore.updateJourney(journeyId, { status: 'error', error: message });
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    return;
  }

  // Get history BEFORE adding assistant placeholder (like Agent)
  const history = [...journey.messages];

  // Append assistant placeholder for streaming UI
  const assistantMessage = createChatMessage({ role: 'assistant', content: '', idPrefix: 'journey-assistant' });
  const assistantIndex = journey.messages.length;

  journeyStore.updateJourney(journeyId, {
    messages: [...journey.messages, assistantMessage],
    status: 'running',
    error: undefined,
    warning: undefined,
    sessionId: undefined,
    editCards: undefined,
  });

  // Update notification status
  updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);

  // Create executor and register abort controller
  const executor = new LLMTaskExecutor();
  journeyStore.registerAbortController(journeyId, { abort: () => executor.abort() } as AbortController);

  let finalResult: any = null;

  try {
    // Like Agent: pass raw history, LLMTask renders templates
    await executor.execute(
      {
        mode: llmConfig.mode,
        projectId: llmConfig.projectId,
        promptContext: llmConfig.promptContext,
        thinkingMode: llmConfig.thinkingMode,
        thinkingConfig: llmConfig.thinkingConfig,
      },
      {
        onStreamingUpdate: (parts) => {
          const currentJourney = journeyStore.getJourneyById(journeyId);
          if (!currentJourney) return;

          const nextAssistant: ChatMessage = {
            ...currentJourney.messages[assistantIndex],
            contentParts: parts,
          };
          const nextMessages = currentJourney.messages.slice();
          nextMessages[assistantIndex] = nextAssistant;

          journeyStore.updateJourney(journeyId, { messages: nextMessages });
        },
        onComplete: (session) => {
          finalResult = session;
          // Store sessionId for UI to read streaming from llmTaskStore
          journeyStore.updateJourney(journeyId, { sessionId: session.id });
        },
        onError: () => {
          // handled by catch
        },
      },
      history  // Pass raw history like Agent
    );
  } catch (error) {
    if (isAbortError(error)) {
      journeyStore.updateJourney(journeyId, { status: 'cancelled' });
    } else {
      const message = error instanceof Error ? error.message : String(error);
      journeyStore.updateJourney(journeyId, { status: 'error', error: message });
    }
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    return;
  } finally {
    journeyStore.unregisterAbortController(journeyId);
  }

  if (!finalResult) {
    journeyStore.updateJourney(journeyId, { status: 'error', error: 'AI request finished without a result.' });
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    return;
  }

  // Finalize assistant message (content + thinking + tool calls)
  const currentJourney = journeyStore.getJourneyById(journeyId)!;
  const finalizedAssistant: ChatMessage = {
    ...currentJourney.messages[assistantIndex],
    contentParts: finalResult.contentParts ?? [],
    functionCalls: finalResult.functionCalls ?? [],
    thinking_details: finalResult.thinkingDetails ?? undefined,
  };
  const finalizedMessages = currentJourney.messages.slice();
  finalizedMessages[assistantIndex] = finalizedAssistant;

  journeyStore.updateJourney(journeyId, {
    messages: finalizedMessages,
    provider: finalResult.provider,
    model: finalResult.model,
    usage: finalResult.usage,
  });

  // Determine output mode from promptContext
  const outputMode = (llmConfig.promptContext as any).outputMode ?? 'tool_call';

  // Raw output mode: delegate to spec.handleRawOutput
  if (outputMode === 'raw_output') {
    const text = collapseContentParts(finalResult.contentParts ?? []).trim();
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
        const result = await specWithHandler.handleRawOutput(journey.input, updatedLegacyJourney, text);
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
  const functionCalls = finalResult.functionCalls ?? [];
  if (!functionCalls.length) {
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
      functionCalls,
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
  start<TInput>(kind: JourneyKind, input: TInput): string {
    const journeyId = `llm-journey-${generateTempId()}`;
    const journeyStore = useJourneyStore.getState();

    const spec = getJourneySpec(kind) as JourneySpec<TInput>;
    const label = spec.label(input);
    const now = Date.now();

    // Create journey in journeyStore (permanent storage)
    const journey: Journey<TInput, unknown> = {
      id: journeyId,
      kind,
      input,
      label,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      isRead: false,
      editingTargets: spec.buildEditingTargets(input),
      functions: undefined,
      messages: [],
      sessionId: undefined,
    };

    journeyStore.createJourney(journey as any);

    // Register notification with journeyStore modal
    registerJourneyNotification(journey as any, {
      onClick: () => useJourneyStore.getState().openDetailModal(journeyId),
      onDismiss: () => useJourneyStore.getState().clearJourney(journeyId),
    });

    void (async () => {
      try {
        await initJourney({ journeyId, kind, input });
        await runAttempt({ journeyId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        journeyStore.updateJourney(journeyId, { status: 'error', error: message });
        updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
      }
    })();

    return journeyId;
  },

  /**
   * Send feedback to continue a journey (multi-turn)
   * Like Agent: just add raw user message and run attempt
   */
  sendFeedback(params: { journeyId: string; text: string }): void {
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

    void runAttempt({ journeyId });
  },
};
