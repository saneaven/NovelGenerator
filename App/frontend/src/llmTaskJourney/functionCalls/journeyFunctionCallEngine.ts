import type { FunctionCallMetadata } from '../../llm/requestTypes';
import { useLLMTaskStore } from '../../store/llmTaskStore';
import type { HandlerOptions } from '../../functionCall/applicator/types';
import type { StoredEditCard } from '../../llmTask/uiTypes';
import {
  applySessionEdits,
  rejectAllSessionEdits,
  stageSessionEdits,
} from '../../llmTask/functionCalls/functionCallEngine';
import type { LLMTaskJourney } from '../types';

function toFunctionCallMetadata(cards: StoredEditCard[]): FunctionCallMetadata[] {
  return cards.map((card) => ({
    id: card.functionCall.id,
    function_name: card.functionCall.functionName,
    arguments: card.functionCall.arguments,
    status: card.functionCall.status,
    reason: card.functionCall.reason,
    failureType: card.functionCall.failureType,
    result: card.functionCall.result,
    acceptedAt: card.functionCall.acceptedAt,
  }));
}

function findLastAssistantMessageId(journey: LLMTaskJourney): string | null {
  for (let i = journey.messages.length - 1; i >= 0; i--) {
    const msg = journey.messages[i];
    if (msg.role === 'assistant') return msg.id;
  }
  return null;
}

function updateJourneyAssistantFunctionCalls(params: {
  sessionId: string;
  assistantMessageId: string;
  functionCalls: FunctionCallMetadata[];
}): void {
  const { sessionId, assistantMessageId, functionCalls } = params;
  const store = useLLMTaskStore.getState();
  const session = store.getSessionById(sessionId);
  const journey = session?.journey;
  if (!journey) return;

  const nextMessages = journey.messages.map((m) =>
    m.id === assistantMessageId ? { ...m, functionCalls } : m
  );
  const nextJourney: LLMTaskJourney = {
    ...journey,
    messages: nextMessages,
    updatedAt: Date.now(),
  };
  store.updateSession(sessionId, { journey: nextJourney } as any);
}

function syncAssistantFunctionCallsFromCards(params: {
  sessionId: string;
  assistantMessageId: string;
}): void {
  const { sessionId, assistantMessageId } = params;
  const store = useLLMTaskStore.getState();
  const session = store.getSessionById(sessionId);
  const cards = session?.editCards ?? [];
  if (!cards.length) return;
  updateJourneyAssistantFunctionCalls({
    sessionId,
    assistantMessageId,
    functionCalls: toFunctionCallMetadata(cards),
  });
}

export async function stageJourneyEdits(params: {
  sessionId: string;
  assistantMessageId: string;
  projectId: string;
  language: string;
  functionCalls: FunctionCallMetadata[];
}): Promise<void> {
  const { sessionId, assistantMessageId, projectId, language, functionCalls } = params;

  // Store the initial (pending) tool calls on the assistant message.
  updateJourneyAssistantFunctionCalls({ sessionId, assistantMessageId, functionCalls });

  await stageSessionEdits({ sessionId, projectId, language, functionCalls });

  // Mirror validation results back into the assistant message for tool_results.
  syncAssistantFunctionCallsFromCards({ sessionId, assistantMessageId });
}

export async function applyJourneyEdits(params: {
  sessionId: string;
  projectId: string;
  language: string;
  selections: Record<string, boolean>;
  options: HandlerOptions;
}): Promise<void> {
  const { sessionId, projectId, language, selections, options } = params;
  const store = useLLMTaskStore.getState();
  const session = store.getSessionById(sessionId);
  const journey = session?.journey;
  const assistantMessageId = journey ? findLastAssistantMessageId(journey) : null;

  await applySessionEdits({ sessionId, projectId, language, selections, options });

  if (assistantMessageId) {
    syncAssistantFunctionCallsFromCards({ sessionId, assistantMessageId });
  }
}

export function rejectAllJourneyEdits(params: { sessionId: string; reason?: string }): void {
  const { sessionId, reason } = params;
  const store = useLLMTaskStore.getState();
  const session = store.getSessionById(sessionId);
  const journey = session?.journey;
  const assistantMessageId = journey ? findLastAssistantMessageId(journey) : null;

  rejectAllSessionEdits({ sessionId, reason });

  if (assistantMessageId) {
    syncAssistantFunctionCallsFromCards({ sessionId, assistantMessageId });
  }
}

