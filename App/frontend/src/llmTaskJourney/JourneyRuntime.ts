import type { ChatMessage, ToolCallMetadata } from '../llm/requestTypes';
import { PromptManager } from '../llm/PromptManager';
import { useSettingsStore } from '../store/settingsStore';
import { useLLMSessionStore } from '../store/llmSessionStore';
import { useJourneyStore, type Journey } from '../store/journeyStore';
import { startLLMSession } from '../llmSession';
import {
  stageToolCalls,
  applyToolCalls,
  rejectAllToolCalls,
  markToolCallsRunning,
} from '../toolCall/runtime';
import type { HandlerOptions } from '../toolCall/apply/types';
import type { ToolCallDecisionMap } from '../toolCall/types';
import { registerJourneyNotification, updateJourneyNotification } from './notificationHelpers';
import { generateTempId } from '../utils/tempId';
import { getJourneySpec, type JourneyKind } from './journeySpecs';
import type { LLMTaskJourney, JourneySpec } from './types';
import { createChatMessage, collapseContentParts } from './types';

function findLastAssistantMessageId(journey: Journey | LLMTaskJourney): string | null {
  for (let i = journey.messages.length - 1; i >= 0; i--) {
    const message = journey.messages[i];
    if (message.role === 'assistant') return message.id;
  }
  return null;
}

function getMessageToolCalls(params: {
  journey: Journey;
  assistantMessageId: string;
}): ToolCallMetadata[] {
  const { journey, assistantMessageId } = params;
  const message = journey.messages.find((item) => item.id === assistantMessageId);
  if (!Array.isArray(message?.toolCalls)) return [];
  return message.toolCalls;
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

  const nextMessages = journey.messages.map((message) =>
    message.id === assistantMessageId ? { ...message, toolCalls } : message
  );

  journeyStore.updateJourney(journeyId, { messages: nextMessages });
}

async function stageJourneyToolCalls(params: {
  journeyId: string;
  assistantMessageId: string;
  projectId: string;
  language: string;
  toolCalls: ToolCallMetadata[];
  allowedToolNames?: string[];
}): Promise<void> {
  const { journeyId, assistantMessageId, projectId, language, toolCalls, allowedToolNames } = params;
  const journeyStore = useJourneyStore.getState();

  const staged = await stageToolCalls({
    projectId,
    language,
    toolCalls,
    allowedToolNames,
  });

  updateJourneyAssistantToolCalls({
    journeyId,
    assistantMessageId,
    toolCalls: staged.toolCalls,
  });

  journeyStore.updateJourney(journeyId, {
    status: staged.status,
    error: staged.error,
    warning: staged.warning,
    activeSessionId: undefined,
  });
}

/**
 * Apply journey tool calls from journey.messages[lastAssistant].toolCalls.
 */
export async function applyJourneyEdits(params: {
  journeyId: string;
  projectId: string;
  language: string;
  decisions: ToolCallDecisionMap;
  options: HandlerOptions;
}): Promise<void> {
  const { journeyId, projectId, language, decisions, options } = params;
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  if (!journey) {
    throw new Error(`Journey not found: ${journeyId}`);
  }

  const assistantMessageId = findLastAssistantMessageId(journey);
  if (!assistantMessageId) {
    throw new Error('No assistant message found for journey');
  }

  const currentToolCalls = getMessageToolCalls({ journey, assistantMessageId });
  if (currentToolCalls.length === 0) {
    return;
  }

  journeyStore.updateJourney(journeyId, {
    status: 'applying',
    error: undefined,
    warning: undefined,
  });

  const runningToolCalls = markToolCallsRunning({
    toolCalls: currentToolCalls,
    decisions,
  });

  updateJourneyAssistantToolCalls({
    journeyId,
    assistantMessageId,
    toolCalls: runningToolCalls,
  });

  const applied = await applyToolCalls({
    projectId,
    language,
    toolCalls: runningToolCalls,
    decisions,
    options,
  });

  updateJourneyAssistantToolCalls({
    journeyId,
    assistantMessageId,
    toolCalls: applied.toolCalls,
  });

  journeyStore.updateJourney(journeyId, {
    status: applied.status,
    error: applied.error,
    warning: applied.warning,
    activeSessionId: undefined,
  });

  const updatedJourney = journeyStore.getJourneyById(journeyId);
  if (updatedJourney) {
    updateJourneyNotification(journeyId, updatedJourney);
  }
}

/**
 * Reject all pending journey tool calls.
 */
export function rejectAllJourneyEdits(params: { journeyId: string; reason?: string }): void {
  const { journeyId, reason } = params;
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  if (!journey) return;

  const assistantMessageId = findLastAssistantMessageId(journey);
  if (!assistantMessageId) return;

  const currentToolCalls = getMessageToolCalls({ journey, assistantMessageId });
  if (currentToolCalls.length === 0) return;

  const rejected = rejectAllToolCalls({
    toolCalls: currentToolCalls,
    reason,
  });

  updateJourneyAssistantToolCalls({
    journeyId,
    assistantMessageId,
    toolCalls: rejected.toolCalls,
  });

  journeyStore.updateJourney(journeyId, {
    status: rejected.status,
    error: rejected.error,
    warning: rejected.warning,
    activeSessionId: undefined,
  });

  const updatedJourney = journeyStore.getJourneyById(journeyId);
  if (updatedJourney) {
    updateJourneyNotification(journeyId, updatedJourney);
  }
}

/**
 * Get language for journey based on editing targets
 */
function getJourneyLanguage(journey: Journey): string {
  const targets = journey.editingTargets;
  if (targets.kind === 'translateObjects') return targets.targetLanguage;
  if (targets.kind === 'aiEdit') return targets.language;
  return useSettingsStore.getState().getSettings().mainLanguage;
}

/**
 * Convert Journey to LLMTaskJourney for spec compatibility
 */
function toSpecJourney(journey: Journey): LLMTaskJourney {
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

function extractUserInput(kind: JourneyKind, input: unknown): string {
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
  input: unknown;
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
  const specJourney = toSpecJourney(journey);

  let llmConfig: ReturnType<JourneySpec<any>['buildLLMConfig']>;
  try {
    llmConfig = spec.buildLLMConfig(journey.input, specJourney);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedSessionId = createFailedSession({
      kind: journey.kind,
      label: journey.label,
      input: journey.input,
      error: message,
    });

    journeyStore.updateJourney(journeyId, {
      status: 'error',
      error: message,
      activeSessionId: undefined,
    });
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);

    return {
      journeyId,
      sessionId: failedSessionId,
      assistantMessageId: '',
      llmConfig: {} as any,
      spec,
    };
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
    thinking_mode: llmConfig.thinking_mode as any,
    thinking_config: llmConfig.thinking_config as any,
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
  });

  updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);

  void handle.done.then((session) => {
    void finalizeAttempt(
      {
        journeyId,
        sessionId: handle.sessionId,
        assistantMessageId,
        llmConfig,
        spec,
      },
      session
    );
  });

  return { journeyId, sessionId: handle.sessionId, assistantMessageId, llmConfig, spec };
}

async function finalizeAttempt(ctx: AttemptContext, session: any): Promise<void> {
  const { journeyId, assistantMessageId, llmConfig, spec } = ctx;
  const journeyStore = useJourneyStore.getState();

  const journey = journeyStore.getJourneyById(journeyId);
  if (!journey) return;

  if (session.status === 'cancelled') {
    journeyStore.updateJourney(journeyId, { status: 'cancelled', activeSessionId: undefined });
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    return;
  }

  if (session.status === 'error') {
    journeyStore.updateJourney(journeyId, {
      status: 'error',
      error: session.error ?? 'AI request failed.',
      activeSessionId: undefined,
    });
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    return;
  }

  // Finalize assistant message (content + thinking + tool calls)
  const currentJourney = journeyStore.getJourneyById(journeyId);
  if (!currentJourney) return;

  const assistantIndex = currentJourney.messages.findIndex((message) => message.id === assistantMessageId);
  if (assistantIndex < 0) return;

  const finalizedAssistant: ChatMessage = {
    ...currentJourney.messages[assistantIndex],
    contentParts: session.contentParts ?? [],
    toolCalls: session.toolCalls ?? [],
    thinking_details: session.thinkingDetails ?? undefined,
  };

  const finalizedMessages = currentJourney.messages.slice();
  finalizedMessages[assistantIndex] = finalizedAssistant;

  journeyStore.updateJourney(journeyId, {
    messages: finalizedMessages,
    provider: session.provider,
    model: session.model,
    usage: session.usage,
  });

  const outputMode = (llmConfig.promptContext as any).outputMode ?? 'tool_call';

  if (outputMode === 'raw_output') {
    const text = collapseContentParts(session.contentParts ?? []).trim();
    if (!text) {
      journeyStore.updateJourney(journeyId, {
        status: 'error',
        error: 'AI response was empty.',
        activeSessionId: undefined,
      });
      updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
      return;
    }

    try {
      const specWithHandler = spec as JourneySpec<any, any>;
      const updatedJourney = journeyStore.getJourneyById(journeyId)!;
      const updatedSpecJourney = toSpecJourney(updatedJourney);

      if (specWithHandler.handleRawOutput) {
        const result = await specWithHandler.handleRawOutput(updatedJourney.input, updatedSpecJourney, text);
        if (result !== undefined) {
          journeyStore.updateJourney(journeyId, { result });
        }
      }

      journeyStore.updateJourney(journeyId, {
        status: 'success',
        activeSessionId: undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      journeyStore.updateJourney(journeyId, {
        status: 'error',
        error: message,
        activeSessionId: undefined,
      });
    }

    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    return;
  }

  const toolCalls = session.toolCalls ?? [];
  if (!toolCalls.length) {
    journeyStore.updateJourney(journeyId, {
      status: 'error',
      error: 'AI response did not include any actions to apply.',
      activeSessionId: undefined,
    });
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    return;
  }

  const updatedJourney = journeyStore.getJourneyById(journeyId)!;
  const language = getJourneyLanguage(updatedJourney);
  const allowedToolNames = (updatedJourney.tools ?? [])
    .map((tool) => tool.name)
    .filter((name): name is string => Boolean(name && name.trim()));

  try {
    await stageJourneyToolCalls({
      journeyId,
      assistantMessageId: finalizedAssistant.id,
      projectId: llmConfig.projectId,
      language,
      toolCalls,
      allowedToolNames: allowedToolNames.length > 0 ? allowedToolNames : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    journeyStore.updateJourney(journeyId, {
      status: 'error',
      error: message,
      activeSessionId: undefined,
    });
  }

  updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
}

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

    registerJourneyNotification(journey as any, {
      onClick: () => useJourneyStore.getState().openDetailModal(journeyId),
      onDismiss: () => useJourneyStore.getState().clearJourney(journeyId),
    });

    const context = startAttempt({ journeyId });
    return { journeyId, sessionId: context.sessionId };
  },

  /**
   * Send feedback to continue a journey (multi-turn)
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

    journeyStore.updateJourney(journeyId, {
      messages: [
        ...journey.messages,
        createChatMessage({ role: 'user', content: trimmed, idPrefix: 'journey-user' }),
      ],
    });

    const context = startAttempt({ journeyId });
    return { sessionId: context.sessionId };
  },
};
