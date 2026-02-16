import type { ToolCallDecisionMap } from '../toolCall/types';
import { useJourneyStore, type Journey } from '../store/journeyStore';
import type { ChatMessage, ToolCallMetadata } from '../llm/requestTypes';
import { registerJourneyNotification, updateJourneyNotification } from './notificationHelpers';
import { generateTempId } from '../utils/tempId';
import { getJourneySpec, type JourneyKind } from './journeySpecs';
import type { JourneySpec } from './types';
import { createChatMessage } from './types';
import { threadOrchestrator, useThreadStore, resolveRunMessageDisplay, type ThreadMessage, type ThreadToolCall } from '../runtime';

let threadStoreSubscribed = false;

function extractUserInput(kind: JourneyKind, input: unknown): string {
  if (kind === 'aiEdit') return (input as any).userRequest || '';
  if (kind === 'translateObjects') return (input as any).userInput || '';
  if (kind === 'imagePrompt' || kind === 'sceneImage') return (input as any).userRequest || '';
  return '';
}

function getProjectId(kind: JourneyKind, input: unknown): string {
  if (kind === 'aiEdit') return (input as any).projectId || '';
  if (kind === 'translateObjects') return (input as any).projectId || '';
  if (kind === 'imagePrompt' || kind === 'sceneImage') return (input as any).projectId || '';
  return '';
}

function getJourneyLanguage(journey: Journey): string {
  const targets = journey.editingTargets;
  if (targets.kind === 'translateObjects') return targets.targetLanguage;
  if (targets.kind === 'aiEdit') return targets.language;
  return 'English';
}

function normalizeDecisionKey(id: string): string {
  if (!id.includes(':')) return id;
  return id.split(':').pop() || id;
}

function buildJourneyDispatchPayload(kind: JourneyKind, input: any, threadId?: string) {
  const base: Record<string, unknown> = {
    thread_type: 'journey',
    thread_id: threadId,
    input_text: extractUserInput(kind, input),
    language: 'English',
    journey_kind: kind === 'translateObjects' ? 'translation' : kind === 'sceneImage' ? 'imagePrompt' : kind,
  };

  if (kind === 'aiEdit') {
    const isManuscript = input.category === 'manuscript';
    const targetId = typeof input.targetId === 'string' ? input.targetId : '';
    const selectedContextIds = Array.isArray(input.selectedContextIds) ? input.selectedContextIds : [];
    base.journey_target_ids = targetId ? [targetId] : [];
    base.input_payload = {
      mode: isManuscript ? 'manuscript' : 'storyObject',
      editAssistant: {
        manuscript: {
          currentId: '',
          currentChapterId: targetId,
          currentChapterName: '',
          currentChapterManuscript: '',
          objectIds: selectedContextIds,
        },
        storyObject: {
          targetIds: targetId ? [targetId] : [],
          contextIds: selectedContextIds,
          categoryName: String(input.category || ''),
          editScope: 'partial',
        },
      },
      feedback: {
        editingObjectIds: selectedContextIds,
      },
    };
  } else if (kind === 'translateObjects') {
    const objectIds = Array.isArray(input.objectIds) ? input.objectIds : [];
    base.language = String(input.targetLanguage || 'English');
    base.journey_target_ids = objectIds;
    base.input_payload = {
      translation: {
        sourceLanguage: String(input.sourceLanguage || ''),
        targetLanguage: String(input.targetLanguage || ''),
        objectIds,
        currentTranslatedContents: [],
        contextObjectIds: Array.isArray(input.contextObjectIds) ? input.contextObjectIds : [],
      },
      feedback: {
        editingObjectIds: objectIds,
      },
    };
  } else {
    const selectedObjectIds = Array.isArray(input.selectedObjectIds) ? input.selectedObjectIds : [];
    base.journey_target_ids = selectedObjectIds;
    base.input_payload = {
      variant: kind === 'sceneImage' ? 'scene' : (input.contextType === 'cover_image' ? 'coverImage' : 'object'),
      imagePrompt: {
        promptMode: String(input.promptMode || 'natural'),
        contextType: String(input.contextType || 'object'),
        currentObject: {},
        selectedObjectIds,
        sceneContext: input.sceneContext ?? undefined,
      },
      feedback: {
        editingObjectIds: selectedObjectIds,
      },
    };
  }

  return base;
}

function mapToolCallToMetadata(toolCall: ThreadToolCall): ToolCallMetadata {
  return {
    id: toolCall.llmCallId,
    tool_name: toolCall.toolName,
    arguments: toolCall.arguments,
    status: toolCall.status,
    reason: toolCall.reason ?? undefined,
    result: toolCall.result as any,
    acceptedAt: toolCall.acceptedAt ? new Date(toolCall.acceptedAt) : undefined,
  };
}

function mapThreadMessageToChatMessage(message: ThreadMessage, language: string): ChatMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null;
  const resolved = resolveRunMessageDisplay(message, language, '_streaming');
  return {
    id: message.id,
    role: message.role,
    contentParts: resolved.contentParts as any,
    timestamp: new Date(message.createdAt),
    seq: message.seqInThread ?? undefined,
  };
}

function deriveJourneyStatus(params: {
  previousStatus: Journey['status'];
  threadStatus: string | undefined;
  hasPendingToolCalls: boolean;
  streamActive: boolean;
}): Journey['status'] {
  const { previousStatus, threadStatus, hasPendingToolCalls, streamActive } = params;
  if (previousStatus === 'cancelled') return 'cancelled';
  if (streamActive) return previousStatus === 'applying' ? 'applying' : 'running';
  if (threadStatus === 'error') return 'error';
  if (hasPendingToolCalls) return 'pending_confirmation';
  if (threadStatus === 'waiting_tools' || threadStatus === 'paused') return 'pending_confirmation';
  if (threadStatus === 'running') return previousStatus === 'applying' ? 'applying' : 'running';
  if (threadStatus === 'idle') return 'success';
  return previousStatus;
}

function syncJourneyFromThread(journeyId: string): void {
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  if (!journey?.threadId) return;

  const threadState = useThreadStore.getState();
  const thread = threadState.threadsById[journey.threadId];
  if (!thread) return;

  const threadMessages = [...(threadState.messagesByThreadId[journey.threadId] ?? [])].sort((a, b) => {
    const aSeq = a.seqInThread ?? Number.MAX_SAFE_INTEGER;
    const bSeq = b.seqInThread ?? Number.MAX_SAFE_INTEGER;
    if (aSeq !== bSeq) return aSeq - bSeq;
    return a.createdAt.localeCompare(b.createdAt);
  });

  const language = getJourneyLanguage(journey);
  const chatMessages: ChatMessage[] = [];
  for (const message of threadMessages) {
    const mapped = mapThreadMessageToChatMessage(message, language);
    if (!mapped) continue;
    const toolCalls = threadState.toolCallsByMessageId[message.id] ?? [];
    if (mapped.role === 'assistant' && toolCalls.length > 0) {
      mapped.toolCalls = toolCalls.map(mapToolCallToMetadata);
    }
    chatMessages.push(mapped);
  }

  const lastAssistant = [...chatMessages].reverse().find((msg) => msg.role === 'assistant');
  const hasPendingToolCalls = Boolean(
    lastAssistant?.toolCalls?.some((tc) => tc.status === 'pending' || tc.status === 'running'),
  );

  const streamActive = threadState.isThreadStreamActive(journey.threadId);
  const nextStatus = deriveJourneyStatus({
    previousStatus: journey.status,
    threadStatus: thread.status,
    hasPendingToolCalls,
    streamActive,
  });

  journeyStore.updateJourney(journeyId, {
    messages: chatMessages.length > 0 ? chatMessages : journey.messages,
    status: nextStatus,
    error: nextStatus === 'error' ? (thread.lastError ?? journey.error) : undefined,
    warning: undefined,
  });

  const updated = journeyStore.getJourneyById(journeyId);
  if (updated) updateJourneyNotification(journeyId, updated);
}

function syncAllJourneysFromThreadStore(): void {
  const journeyStore = useJourneyStore.getState();
  const journeys = Object.values(journeyStore.journeys).filter((j): j is Journey => Boolean(j));
  for (const journey of journeys) {
    if (!journey.threadId) continue;
    syncJourneyFromThread(journey.id);
  }
}

function ensureThreadStoreSubscription(): void {
  if (threadStoreSubscribed) return;
  threadStoreSubscribed = true;
  useThreadStore.subscribe(() => {
    syncAllJourneysFromThreadStore();
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
  options: unknown;
}): Promise<void> {
  void params.projectId;
  void params.language;

  const { journeyId, decisions, options } = params;
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  if (!journey?.threadId) {
    throw new Error('Journey thread is not ready yet');
  }

  const lastAssistant = [...journey.messages].reverse().find((msg) => msg.role === 'assistant');
  if (!lastAssistant) {
    throw new Error('No assistant message found');
  }

  const normalized: Record<string, 'accept' | 'reject' | 'cancel'> = {};
  for (const [id, decision] of Object.entries(decisions || {})) {
    normalized[normalizeDecisionKey(id)] = decision;
  }

  journeyStore.updateJourney(journeyId, { status: 'applying', error: undefined, warning: undefined });

  await threadOrchestrator.toolDecisions({
    projectId: getProjectId(journey.kind as JourneyKind, journey.input),
    threadId: journey.threadId,
    messageId: lastAssistant.id,
    decisions: normalized,
    options: (options && typeof options === 'object') ? options as Record<string, unknown> : undefined,
  });
}

/**
 * Reject all pending journey tool calls.
 */
export function rejectAllJourneyEdits(params: { journeyId: string; reason?: string }): void {
  const { journeyId } = params;
  const journey = useJourneyStore.getState().getJourneyById(journeyId);
  if (!journey) return;

  const lastAssistant = [...journey.messages].reverse().find((msg) => msg.role === 'assistant');
  const toolCalls = Array.isArray(lastAssistant?.toolCalls) ? lastAssistant!.toolCalls : [];
  const decisions: ToolCallDecisionMap = {};
  for (const toolCall of toolCalls) {
    if (toolCall.status === 'pending' || toolCall.status === 'running') {
      decisions[toolCall.id] = 'reject';
    }
  }

  if (Object.keys(decisions).length === 0) {
    return;
  }

  void applyJourneyEdits({
    journeyId,
    projectId: getProjectId(journey.kind as JourneyKind, journey.input),
    language: getJourneyLanguage(journey),
    decisions,
    options: {},
  });
}

export const JourneyRuntime = {
  /**
   * Start a new journey.
   */
  start<TInput>(kind: JourneyKind, input: TInput): { journeyId: string; sessionId: string } {
    ensureThreadStoreSubscription();

    const journeyId = `llm-journey-${generateTempId()}`;
    const journeyStore = useJourneyStore.getState();
    const spec = getJourneySpec(kind) as JourneySpec<TInput, unknown>;

    const label = spec.label(input);
    const now = Date.now();
    const userInput = extractUserInput(kind, input);
    const userMessage = createChatMessage({ role: 'user', content: userInput, idPrefix: 'journey-user' });
    const projectId = getProjectId(kind, input);

    const journey: Journey<TInput, unknown> = {
      id: journeyId,
      kind,
      input,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      editingTargets: spec.buildEditingTargets(input),
      tools: undefined,
      messages: [userMessage],
      activeSessionId: undefined,
      sessionHistory: undefined,
      label,
    };

    journeyStore.createJourney(journey as any);
    registerJourneyNotification(journey as any, {
      onClick: () => useJourneyStore.getState().openDetailModal(journeyId),
      onDismiss: () => useJourneyStore.getState().clearJourney(journeyId),
    });

    const payload = buildJourneyDispatchPayload(kind, input);

    void threadOrchestrator.dispatch({
      projectId,
      threadType: 'journey',
      inputText: String(payload.input_text ?? ''),
      language: String(payload.language ?? 'English'),
      journeyKind: payload.journey_kind as string,
      inputPayload: payload.input_payload as Record<string, unknown> | undefined,
      journeyTargetIds: payload.journey_target_ids as string[] | undefined,
    }).then(({ threadId }) => {
      useJourneyStore.getState().updateJourney(journeyId, { threadId, warning: undefined });
      syncJourneyFromThread(journeyId);
    }).catch((error) => {
      useJourneyStore.getState().updateJourney(journeyId, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      const updated = useJourneyStore.getState().getJourneyById(journeyId);
      if (updated) updateJourneyNotification(journeyId, updated);
    });

    return { journeyId, sessionId: `journey-thread-${journeyId}` };
  },

  /**
   * Send feedback to continue a journey (dispatch with existing thread).
   */
  sendFeedback(params: { journeyId: string; text: string }): { sessionId: string } | undefined {
    ensureThreadStoreSubscription();

    const { journeyId, text } = params;
    const trimmed = text.trim();
    const journeyStore = useJourneyStore.getState();
    const journey = journeyStore.getJourneyById(journeyId);
    if (!journey?.threadId) {
      throw new Error('Journey thread is not ready yet');
    }

    if (!trimmed) {
      journeyStore.updateJourney(journeyId, {
        status: 'running',
        error: undefined,
        warning: undefined,
      });

      const projectId = getProjectId(journey.kind as JourneyKind, journey.input);
      void threadOrchestrator.resume({
        projectId,
        threadId: journey.threadId,
      }).catch((error) => {
        journeyStore.updateJourney(journeyId, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      });

      return { sessionId: `journey-thread-${journey.threadId}` };
    }

    const projectId = getProjectId(journey.kind as JourneyKind, journey.input);
    const language = getJourneyLanguage(journey);

    journeyStore.updateJourney(journeyId, {
      status: 'running',
      warning: undefined,
      messages: [
        ...journey.messages,
        createChatMessage({ role: 'user', content: trimmed, idPrefix: 'journey-user' }),
      ],
    });

    const payload = buildJourneyDispatchPayload(journey.kind as JourneyKind, journey.input, journey.threadId);
    payload.input_text = trimmed;
    payload.language = language;

    void threadOrchestrator.dispatch({
      projectId,
      threadType: 'journey',
      threadId: journey.threadId,
      inputText: String(payload.input_text ?? ''),
      language: String(payload.language ?? 'English'),
      journeyKind: payload.journey_kind as string,
      inputPayload: payload.input_payload as Record<string, unknown> | undefined,
      journeyTargetIds: payload.journey_target_ids as string[] | undefined,
    }).then(() => {
      syncJourneyFromThread(journeyId);
    }).catch((error) => {
      journeyStore.updateJourney(journeyId, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return { sessionId: `journey-thread-${journey.threadId}` };
  },
};
