import { threadService } from '../api/threadService';
import { registerJourneyNotification } from '../llmTaskJourney';
import { getJourneySpec } from '../llmTaskJourney/journeySpecs';
import { useJourneyStore } from '../store/journeyStore';
import { useNotificationStore } from '../store/notificationStore';
import { sendThreadMessage } from '../runtime/threadCommands';

export interface MessageTranslationInput {
  projectId: string;
  sourceThreadId: string;
  sourceMessageId: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceContent: string;
}

export interface MessageTranslationResult {
  journeyId: string;
  journeyThreadId: string;
}

export async function runMessageTranslation(
  input: MessageTranslationInput,
): Promise<MessageTranslationResult> {
  const spec = getJourneySpec('messageTranslation');
  const journeyId = crypto.randomUUID();
  const journeyInput = {
    projectId: input.projectId,
    sourceThreadId: input.sourceThreadId,
    sourceMessageId: input.sourceMessageId,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
  };
  const payload = {
    projectId: input.projectId,
    rawMode: true,
    outputMode: 'raw_output' as const,
    translation: {
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      sourceThreadId: input.sourceThreadId,
      sourceMessageId: input.sourceMessageId,
      messages: [
        {
          messageId: input.sourceMessageId,
          role: 'assistant' as const,
          content: input.sourceContent,
        },
      ],
    },
  };

  useJourneyStore.getState().createJourney({
    id: journeyId,
    kind: 'messageTranslation',
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
    const created = await threadService.createJourneyThread(input.projectId, 'messageTranslation');
    useJourneyStore.getState().updateJourney(journeyId, {
      threadId: created.thread_id,
    });

    await sendThreadMessage({
      threadId: created.thread_id,
      projectId: input.projectId,
      threadType: 'journey',
      inputText: input.sourceContent,
      request: {
        input_payload: payload,
        surface: 'story-object',
        language: input.targetLanguage,
      },
    });

    return {
      journeyId,
      journeyThreadId: created.thread_id,
    };
  } catch (error: any) {
    const message = error?.message ?? 'Failed to start message translation';
    useJourneyStore.getState().updateJourney(journeyId, { error: message });
    useNotificationStore.getState().update(journeyId, {
      status: 'error',
      message,
    });
    throw error;
  }
}
