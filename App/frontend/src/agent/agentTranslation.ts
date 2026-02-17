import type { ContentPart } from '../types/chat';
import ChatEngine from './chatEngine';
import { threadService } from '../api/threadService';
import { registerJourneyNotification } from '../llmTaskJourney';
import { getJourneySpec } from '../llmTaskJourney/journeySpecs';
import { useJourneyStore } from '../store/journeyStore';
import { useNotificationStore } from '../store/notificationStore';

export interface AgentTranslationInput {
  projectId: string;
  agentId: string;
  threadId: string;
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

export async function runAgentTranslation(
  input: AgentTranslationInput,
  _onSessionCreated?: (sessionId: string) => void,
): Promise<string> {
  const spec = getJourneySpec('translateObjects');
  const journeyId = crypto.randomUUID();
  const journeyInput = {
    projectId: input.projectId,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    userInput: input.sourceContent,
    objectIds: [],
    contextObjectIds: [],
  };

  useJourneyStore.getState().createJourney({
    id: journeyId,
    kind: 'translateObjects',
    input: journeyInput,
    editingTargets: spec.buildEditingTargets(journeyInput),
    label: spec.label(journeyInput),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  registerJourneyNotification(
    useJourneyStore.getState().journeys[journeyId] as any,
    {
      onClick: () => useJourneyStore.getState().openDetailModal(journeyId),
      onDismiss: () => useJourneyStore.getState().clearJourney(journeyId),
    },
  );

  try {
    const created = await threadService.createJourneyThread(input.projectId, 'translation');
    useJourneyStore.getState().updateJourney(journeyId, {
      threadId: created.thread_id,
    });

    const engine = new ChatEngine({
      threadId: created.thread_id,
      projectId: input.projectId,
      threadType: 'journey',
    });
    await engine.init();
    await engine.send(input.sourceContent, {
      input_payload: journeyInput,
      surface: 'story-object',
      language: input.targetLanguage,
    });
    _onSessionCreated?.(created.thread_id);
    return created.thread_id;
  } catch (error: any) {
    const message = error?.message ?? 'Failed to start translation';
    useJourneyStore.getState().updateJourney(journeyId, { error: message });
    useNotificationStore.getState().update(journeyId, {
      status: 'error',
      message,
    });
    throw error;
  }
}
