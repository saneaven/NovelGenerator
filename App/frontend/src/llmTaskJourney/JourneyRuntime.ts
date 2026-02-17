import { useJourneyStore, type Journey } from '../store/journeyStore';
import { registerJourneyNotification, updateJourneyNotificationFromThread } from './notificationHelpers';
import { generateTempId } from '../utils/tempId';
import { getJourneySpec, type JourneyKind } from './journeySpecs';
import type { JourneySpec } from './types';
import { threadOrchestrator, useThreadStore } from '../runtime';

// Track notification subscriptions per journey for cleanup
const notificationUnsubscribers = new Map<string, () => void>();

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

/**
 * Subscribe to ThreadStore for a journey's thread — updates notifications on status changes.
 */
function subscribeToThreadForNotifications(journeyId: string, threadId: string): void {
  // Clean up previous subscription if any
  const prev = notificationUnsubscribers.get(journeyId);
  if (prev) prev();

  const unsubscribe = useThreadStore.subscribe((state) => {
    const thread = state.threadsById[threadId];
    if (!thread) return;
    const journey = useJourneyStore.getState().getJourneyById(journeyId);
    if (!journey) {
      // Journey was cleared — clean up subscription
      unsubscribe();
      notificationUnsubscribers.delete(journeyId);
      return;
    }
    const isStreamActive = Boolean(state.activeStreamByThread[threadId]);
    updateJourneyNotificationFromThread(journeyId, journey, thread, isStreamActive);
  });

  notificationUnsubscribers.set(journeyId, unsubscribe);
}

export const JourneyRuntime = {
  /**
   * Start a new journey.
   */
  start<TInput>(kind: JourneyKind, input: TInput): { journeyId: string } {
    const journeyId = `llm-journey-${generateTempId()}`;
    const journeyStore = useJourneyStore.getState();
    const spec = getJourneySpec(kind) as JourneySpec<TInput>;

    const label = spec.label(input);
    const now = Date.now();
    const projectId = getProjectId(kind, input);

    const journey: Journey<TInput> = {
      id: journeyId,
      kind,
      input,
      editingTargets: spec.buildEditingTargets(input),
      label,
      createdAt: now,
      updatedAt: now,
    };

    journeyStore.createJourney(journey as any);
    registerJourneyNotification(journey as any, {
      onClick: () => useJourneyStore.getState().openDetailModal(journeyId),
      onDismiss: () => {
        // Clean up notification subscription
        const unsub = notificationUnsubscribers.get(journeyId);
        if (unsub) { unsub(); notificationUnsubscribers.delete(journeyId); }
        useJourneyStore.getState().clearJourney(journeyId);
      },
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
      useJourneyStore.getState().updateJourney(journeyId, { threadId });
      subscribeToThreadForNotifications(journeyId, threadId);
    }).catch((error) => {
      useJourneyStore.getState().updateJourney(journeyId, {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return { journeyId };
  },

  /**
   * Send feedback to continue a journey (dispatch with existing thread).
   */
  sendFeedback(params: { journeyId: string; text: string }): void {
    const { journeyId, text } = params;
    const trimmed = text.trim();
    const journeyStore = useJourneyStore.getState();
    const journey = journeyStore.getJourneyById(journeyId);
    if (!journey?.threadId) {
      throw new Error('Journey thread is not ready yet');
    }

    const projectId = getProjectId(journey.kind as JourneyKind, journey.input);

    if (!trimmed) {
      void threadOrchestrator.resume({
        projectId,
        threadId: journey.threadId,
      }).catch((error) => {
        console.error('Journey resume failed:', error);
      });
      return;
    }

    const language = getJourneyLanguage(journey);
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
    }).catch((error) => {
      console.error('Journey feedback failed:', error);
    });
  },
};
