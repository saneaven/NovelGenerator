import { journeyService } from '../api/journeyService';
import { getJourneySpec } from '../llmTaskJourney/journeySpecs';
import { useJourneyStore } from '../store/journeyStore';

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

  try {
    const created = await journeyService.create(input.projectId, {
      kind: 'messageTranslation',
      display_label: spec.label(journeyInput),
      input_text: input.sourceContent,
      input_payload: payload,
      surface: 'story-object',
      language: input.targetLanguage,
    });
    useJourneyStore.getState().updateJourney(journeyId, {
      threadId: created.thread_id,
    });

    return {
      journeyId,
      journeyThreadId: created.thread_id,
    };
  } catch (error: any) {
    const message = error?.message ?? 'Failed to start message translation';
    useJourneyStore.getState().updateJourney(journeyId, { error: message });
    throw error;
  }
}
