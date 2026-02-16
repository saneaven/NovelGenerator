import { threadService, type ThreadEvent, type StreamHandle } from '../api/threadService';
import type { ToolCallDecisionMap } from '../toolCall/types';
import { useJourneyStore, type Journey } from '../store/journeyStore';
import type { ToolCallMetadata } from '../llm/requestTypes';
import { registerJourneyNotification, updateJourneyNotification } from './notificationHelpers';
import { generateTempId } from '../utils/tempId';
import { getJourneySpec, type JourneyKind } from './journeySpecs';
import type { JourneySpec } from './types';
import { createChatMessage } from './types';


const streamByJourneyId = new Map<string, StreamHandle>();
const lastEventSeqByJourneyId = new Map<string, number>();
const deltaMessageIdByJourneyId = new Map<string, string>();


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

function mapToolCalls(raw: any[] | undefined): ToolCallMetadata[] {
  const rows = Array.isArray(raw) ? raw : [];
  return rows.map((row, idx) => ({
    id: String(row?.id ?? idx + 1),
    tool_name: String(row?.tool_name ?? ''),
    arguments: (row?.arguments && typeof row.arguments === 'object' ? row.arguments : {}) as Record<string, unknown>,
    status: (row?.status ?? 'pending') as ToolCallMetadata['status'],
    reason: row?.reason ?? undefined,
    failureType: row?.failure_type ?? undefined,
    result: row?.result ?? undefined,
    acceptedAt: row?.accepted_at ? new Date(row.accepted_at) : undefined,
  }));
}

function normalizeStatus(status: string | undefined): Journey['status'] {
  if (status === 'running') return 'running';
  if (status === 'waiting' || status === 'paused') return 'pending_confirmation';
  if (status === 'completed') return 'success';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'error') return 'error';
  return 'running';
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
    // imagePrompt + sceneImage
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

function withUpdatedAssistantMessage(
  journey: Journey,
  messageId: string,
  updater: (current: any | undefined) => any,
): Journey['messages'] {
  const index = journey.messages.findIndex((msg) => msg.id === messageId);
  if (index < 0) {
    const next = updater(undefined);
    return [...journey.messages, next];
  }
  return journey.messages.map((msg, idx) => (idx === index ? updater(msg) : msg));
}

async function handleRunEvent(journeyId: string, event: ThreadEvent): Promise<void> {
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  if (!journey) return;

  const envelope = event.data ?? {};
  const seqRaw = envelope?.event_seq;
  const seq = typeof seqRaw === 'number' ? seqRaw : Number(seqRaw);
  if (Number.isFinite(seq) && seq > 0) {
    const last = lastEventSeqByJourneyId.get(journeyId) ?? 0;
    if (seq <= last) return;
    lastEventSeqByJourneyId.set(journeyId, seq);
  }

  const payload = envelope?.payload ?? {};

  // Extract threadId from event
  const threadId = envelope?.thread_id ? String(envelope.thread_id) : journey.threadId;
  if (threadId && !journey.threadId) {
    journeyStore.updateJourney(journeyId, { threadId });
  }

  if (event.event === 'run:status') {
    const nextStatus = normalizeStatus(payload?.status);
    journeyStore.updateJourney(journeyId, {
      status: nextStatus,
      error: payload?.error,
    });
    if (nextStatus === 'cancelled' || nextStatus === 'error' || nextStatus === 'success' || nextStatus === 'pending_confirmation') {
      const stream = streamByJourneyId.get(journeyId);
      if (stream) {
        stream.abort();
        streamByJourneyId.delete(journeyId);
      }
    }
    const updated = journeyStore.getJourneyById(journeyId);
    if (updated) updateJourneyNotification(journeyId, updated);
    return;
  }

  if (event.event === 'run:llm_final') {
    const pendingDeltaId = deltaMessageIdByJourneyId.get(journeyId);
    if (pendingDeltaId) {
      const filtered = journey.messages.filter((msg) => msg.id !== pendingDeltaId);
      journeyStore.updateJourney(journeyId, { messages: filtered });
      deltaMessageIdByJourneyId.delete(journeyId);
    }

    const refreshed = journeyStore.getJourneyById(journeyId);
    if (!refreshed) return;

    const messageId = String(payload?.message_id ?? '');
    if (!messageId) return;

    const contentParts = Array.isArray(payload?.content_parts) ? payload.content_parts : [];
    const thinkingDetails = Array.isArray(payload?.thinking_details) ? payload.thinking_details : [];
    const toolCalls = mapToolCalls(payload?.tool_calls);

    const nextMessages = withUpdatedAssistantMessage(refreshed, messageId, (current) => {
      if (current) {
        return {
          ...current,
          contentParts,
          thinking_details: thinkingDetails,
          toolCalls: toolCalls.length > 0 ? toolCalls : current.toolCalls,
          timestamp: new Date(),
        };
      }
      return {
        id: messageId,
        role: 'assistant',
        contentParts,
        thinking_details: thinkingDetails,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        timestamp: new Date(),
      };
    });

    journeyStore.updateJourney(journeyId, { messages: nextMessages });
    const updated = journeyStore.getJourneyById(journeyId);
    if (updated) updateJourneyNotification(journeyId, updated);
    return;
  }

  if (event.event === 'run:llm_delta') {
    const contentDelta = typeof payload?.content_delta === 'string' ? payload.content_delta : '';
    const thinkingDelta = typeof payload?.thinking_delta === 'string' ? payload.thinking_delta : '';
    const text = contentDelta || thinkingDelta;
    if (!text) return;

    const current = journeyStore.getJourneyById(journeyId);
    if (!current) return;

    let deltaId = deltaMessageIdByJourneyId.get(journeyId);
    if (!deltaId) {
      deltaId = `delta:${journeyId}`;
      deltaMessageIdByJourneyId.set(journeyId, deltaId);
      journeyStore.updateJourney(journeyId, {
        messages: [
          ...current.messages,
          {
            id: deltaId,
            role: 'assistant',
            contentParts: [{ type: 'content', text }],
            timestamp: new Date(),
          } as any,
        ],
      });
      return;
    }

    const nextMessages = withUpdatedAssistantMessage(current, deltaId, (existing) => {
      const currentParts = Array.isArray(existing?.contentParts) ? existing.contentParts : [];
      const last = currentParts[currentParts.length - 1];
      const contentParts =
        last && last.type === 'content'
          ? [...currentParts.slice(0, -1), { type: 'content', text: `${String(last.text || '')}${text}` }]
          : [...currentParts, { type: 'content', text }];
      return {
        ...(existing || {
          id: deltaId,
          role: 'assistant',
          timestamp: new Date(),
        }),
        contentParts,
        timestamp: new Date(),
      };
    });
    journeyStore.updateJourney(journeyId, { messages: nextMessages });
    return;
  }

  if (event.event === 'run:tool_calls' || event.event === 'run:tool_calls_executed') {
    const messageId = String(payload?.message_id ?? '');
    if (!messageId) return;
    const toolCalls = mapToolCalls(payload?.tool_calls);
    const nextMessages = withUpdatedAssistantMessage(journey, messageId, (current) => ({
      ...(current || {
        id: messageId,
        role: 'assistant',
        contentParts: [],
        timestamp: new Date(),
      }),
      toolCalls,
      timestamp: new Date(),
    }));
    journeyStore.updateJourney(journeyId, {
      messages: nextMessages,
      status: event.event === 'run:tool_calls' ? 'pending_confirmation' : journey.status,
    });
    const updated = journeyStore.getJourneyById(journeyId);
    if (updated) updateJourneyNotification(journeyId, updated);
    return;
  }

  if (event.event === 'run:complete') {
    deltaMessageIdByJourneyId.delete(journeyId);
    journeyStore.updateJourney(journeyId, { status: 'success', error: undefined, activeSessionId: undefined });
    const updated = journeyStore.getJourneyById(journeyId);
    if (updated) updateJourneyNotification(journeyId, updated);
    return;
  }

  if (event.event === 'run:error') {
    deltaMessageIdByJourneyId.delete(journeyId);
    journeyStore.updateJourney(journeyId, {
      status: 'error',
      error: String(payload?.error || 'Run failed'),
      activeSessionId: undefined,
    });
    const updated = journeyStore.getJourneyById(journeyId);
    if (updated) updateJourneyNotification(journeyId, updated);
  }
}

async function openJourneyStream(params: {
  journeyId: string;
  projectId: string;
  streamFactory: () => Promise<StreamHandle>;
}): Promise<void> {
  const { journeyId, projectId, streamFactory } = params;
  const existing = streamByJourneyId.get(journeyId);
  if (existing) {
    existing.abort();
    streamByJourneyId.delete(journeyId);
  }

  const handle = await streamFactory();
  streamByJourneyId.set(journeyId, handle);

  void handle.done
    .catch((error) => {
      const journey = useJourneyStore.getState().getJourneyById(journeyId);
      if (journey) {
        useJourneyStore.getState().updateJourney(journeyId, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          activeSessionId: undefined,
        });
        const updated = useJourneyStore.getState().getJourneyById(journeyId);
        if (updated) updateJourneyNotification(journeyId, updated);
      }
    })
    .finally(() => {
      if (streamByJourneyId.get(journeyId) === handle) {
        streamByJourneyId.delete(journeyId);
      }
      void projectId;
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

  const normalized: Record<string, 'accept' | 'reject'> = {};
  for (const [id, decision] of Object.entries(decisions || {})) {
    normalized[normalizeDecisionKey(id)] = decision;
  }

  journeyStore.updateJourney(journeyId, { status: 'applying', error: undefined });

  const projectId = getProjectId(journey.kind as JourneyKind, journey.input);

  await openJourneyStream({
    journeyId,
    projectId,
    streamFactory: () =>
      threadService.toolDecisions(
        projectId,
        journey.threadId!,
        {
          message_id: lastAssistant.id,
          decisions: normalized,
          options: (options && typeof options === 'object') ? options as Record<string, unknown> : undefined,
        },
        (event) => {
          void handleRunEvent(journeyId, event);
        },
        undefined,
        lastEventSeqByJourneyId.get(journeyId),
      ),
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

    void openJourneyStream({
      journeyId,
      projectId,
      streamFactory: () =>
        threadService.dispatch(
          projectId,
          payload as any,
          (event) => {
            void handleRunEvent(journeyId, event);
          },
        ),
    });

    return { journeyId, sessionId: `journey-thread-${journeyId}` };
  },

  /**
   * Send feedback to continue a journey (dispatch with existing thread).
   */
  sendFeedback(params: { journeyId: string; text: string }): { sessionId: string } | undefined {
    const { journeyId, text } = params;
    const trimmed = text.trim();
    if (!trimmed) return;

    const journeyStore = useJourneyStore.getState();
    const journey = journeyStore.getJourneyById(journeyId);
    if (!journey?.threadId) {
      throw new Error('Journey thread is not ready yet');
    }

    if (journey.status === 'running' || journey.status === 'applying') {
      return;
    }

    const projectId = getProjectId(journey.kind as JourneyKind, journey.input);
    const language = getJourneyLanguage(journey);

    journeyStore.updateJourney(journeyId, {
      status: 'running',
      messages: [
        ...journey.messages,
        createChatMessage({ role: 'user', content: trimmed, idPrefix: 'journey-user' }),
      ],
    });

    void openJourneyStream({
      journeyId,
      projectId,
      streamFactory: () =>
        threadService.dispatch(
          projectId,
          {
            thread_type: 'journey',
            thread_id: journey.threadId!,
            input_text: trimmed,
            language,
            journey_kind: journey.kind === 'translateObjects' ? 'translation' : journey.kind === 'sceneImage' ? 'imagePrompt' : journey.kind,
          },
          (event) => {
            void handleRunEvent(journeyId, event);
          },
          undefined,
          lastEventSeqByJourneyId.get(journeyId),
        ),
    });

    return { sessionId: `journey-thread-${journey.threadId}` };
  },
};
