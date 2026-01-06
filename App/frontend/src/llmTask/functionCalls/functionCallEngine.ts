import type { FunctionCallMetadata } from '../../llm/requestTypes';
import { useLLMTaskStore } from '../../store/llmTaskStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useAgentStore } from '../../store/agentStore';
import {
  UnifiedApplicator,
  createStoreActions,
  buildEditCards,
  applyValidationResults,
  validate,
  normalizeFunctionCall,
  type RawFunctionCall,
  type NormalizedFunctionCall,
  type EditCard,
} from '../../functionCall';
import type { HandlerOptions } from '../../functionCall/applicator/types';
import type { StoredEditCard } from '../uiTypes';
import type { ApplicationResult, FunctionCallFailureType, FunctionCallStatus } from '../../functionCall/types';

function stripCallbacks(card: EditCard): StoredEditCard {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { onApply, onReject, ...rest } = card;
  return rest;
}

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

async function syncAgentFunctionCallsIfNeeded(params: {
  sessionId: string;
  projectId: string;
  cards: StoredEditCard[];
}): Promise<void> {
  const { sessionId, projectId, cards } = params;
  const store = useLLMTaskStore.getState();
  const session = store.getSessionById(sessionId);

  if (session?.kind !== 'agent') return;

  const agentId = (session.input as any)?.agentId as string | undefined;
  const assistantMessageId = (session.result as any)?.assistantMessageId as string | undefined;
  if (!agentId || !assistantMessageId) return;

  await useAgentStore.getState().updateMessageFunctionCalls(
    projectId,
    agentId,
    assistantMessageId,
    toFunctionCallMetadata(cards)
  );
}

function getFailureTypeFromResult(params: {
  functionName: string;
  result?: ApplicationResult;
}): FunctionCallFailureType | undefined {
  const { functionName, result } = params;
  if (!result || result.success) return undefined;

  if (functionName.startsWith('patch_')) {
    const successCount = (result.data as any)?.successCount;
    const failureCount = (result.data as any)?.failureCount;
    if (typeof successCount === 'number' && typeof failureCount === 'number') {
      if (successCount > 0 && failureCount > 0) return 'partial';
    }
  }

  return 'execution';
}

export async function stageSessionEdits(params: {
  sessionId: string;
  projectId: string;
  language: string;
  functionCalls: FunctionCallMetadata[];
}): Promise<void> {
  const { sessionId, projectId, language, functionCalls } = params;
  const store = useLLMTaskStore.getState();

  const rawCalls: RawFunctionCall[] = functionCalls.map(fc => ({
    id: fc.id,
    function_name: fc.function_name,
    arguments: fc.arguments,
  }));

  const validatingCards = buildEditCards(rawCalls, { initialStatus: 'validating' });
  store.updateSession(sessionId, { editCards: validatingCards.map(stripCallbacks) });

  const normalized: NormalizedFunctionCall[] = rawCalls.map(fc => normalizeFunctionCall(fc));
  const validationResults = await validate(normalized, { projectId, language });
  const finalCards = applyValidationResults(validatingCards, validationResults);

  store.updateSession(sessionId, { editCards: finalCards.map(stripCallbacks) });
  await syncAgentFunctionCallsIfNeeded({ sessionId, projectId, cards: finalCards.map(stripCallbacks) });

  const hasAnyPending = finalCards.some(c => c.functionCall.status === 'pending');
  if (hasAnyPending) {
    store.updateSession(sessionId, { status: 'pending_confirmation' });
    return;
  }

  if (finalCards.length === 0) {
    store.updateSession(sessionId, {
      status: 'error',
      error: 'AI response did not include any applicable actions.',
    });
    return;
  }

  store.updateSession(sessionId, {
    status: 'error',
    error: 'All proposed actions failed validation.',
  });

  console.warn('[stageSessionEdits] All validation failed', { sessionId, projectId, language });
}

export async function applySessionEdits(params: {
  sessionId: string;
  projectId: string;
  language: string;
  selections: Record<string, boolean>;
  options: HandlerOptions;
}): Promise<void> {
  const { sessionId, projectId, language, selections, options } = params;
  const store = useLLMTaskStore.getState();
  const session = store.getSessionById(sessionId);
  if (!session?.editCards || session.editCards.length === 0) return;

  store.updateSession(sessionId, { status: 'applying' });

  const storeActions = createStoreActions(useUnifiedObjectStore.getState());
  const applicator = new UnifiedApplicator({ store: storeActions });

  const nextCards: StoredEditCard[] = [];

  for (const card of session.editCards) {
    const normalized: NormalizedFunctionCall = {
      id: card.functionCall.id,
      functionName: card.functionCall.functionName,
      arguments: card.functionCall.arguments,
    };

    // Skip validation failures
    if (card.functionCall.status === 'failed' && card.functionCall.failureType === 'validation') {
      nextCards.push(card);
      continue;
    }

    const isSelected = selections[card.id] ?? true;
    if (!isSelected) {
      nextCards.push({
        ...card,
        functionCall: {
          ...card.functionCall,
          status: 'rejected',
          reason: 'User rejected',
          failureType: undefined,
        },
      });
      continue;
    }

    const rawFunctionCall: RawFunctionCall = {
      id: normalized.id,
      function_name: normalized.functionName,
      arguments: normalized.arguments,
    };

    try {
      const result = await applicator.apply(rawFunctionCall, { projectId, language, options });
      if (result.success) {
        nextCards.push({
          ...card,
          functionCall: {
            ...card.functionCall,
            status: 'accepted',
            reason: undefined,
            failureType: undefined,
            result,
            acceptedAt: new Date(),
          },
        });
      } else {
        nextCards.push({
          ...card,
          functionCall: {
            ...card.functionCall,
            status: 'failed',
            failureType: getFailureTypeFromResult({ functionName: normalized.functionName, result }),
            reason: result.error || result.message,
            result,
          },
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      nextCards.push({
        ...card,
        functionCall: {
          ...card.functionCall,
          status: 'failed',
          failureType: 'execution',
          reason: errorMessage,
        },
      });
    }
  }

  store.updateSession(sessionId, { editCards: nextCards });
  await syncAgentFunctionCallsIfNeeded({ sessionId, projectId, cards: nextCards });

  const acceptedCount = nextCards.filter(c => c.functionCall.status === 'accepted').length;
  const failedCount = nextCards.filter(c => c.functionCall.status === 'failed').length;

  if (acceptedCount === 0 && failedCount === 0) {
    store.updateSession(sessionId, { status: 'cancelled' });
    return;
  }

  if (failedCount > 0) {
    store.updateSession(sessionId, {
      status: 'error',
      error: `${failedCount} action(s) failed to apply.`,
    });
    return;
  }

  store.updateSession(sessionId, { status: 'success' });
}

export function rejectAllSessionEdits(params: { sessionId: string; reason?: string }): void {
  const { sessionId, reason } = params;
  const store = useLLMTaskStore.getState();
  const session = store.getSessionById(sessionId);
  if (!session?.editCards || session.editCards.length === 0) return;

  const next = session.editCards.map(card => ({
    ...card,
    functionCall: {
      ...card.functionCall,
      status: 'rejected' as const,
      reason: reason ?? 'User rejected all',
      failureType: undefined,
    },
  }));

  store.updateSession(sessionId, { editCards: next, status: 'cancelled' });

  const projectId = (session.input as any)?.projectId as string | undefined;
  if (projectId) {
    void syncAgentFunctionCallsIfNeeded({ sessionId, projectId, cards: next });
  }
}

export async function applyFunctionCallsDirect(params: {
  projectId: string;
  language: string;
  functionCalls: FunctionCallMetadata[];
  selections: Record<string, boolean>;
  options: HandlerOptions;
}): Promise<FunctionCallMetadata[]> {
  const { projectId, language, functionCalls, selections, options } = params;

  const storeActions = createStoreActions(useUnifiedObjectStore.getState());
  const applicator = new UnifiedApplicator({ store: storeActions });

  const nextCalls: FunctionCallMetadata[] = [];

  for (const fc of functionCalls) {
    const status = (fc.status ?? 'pending') as FunctionCallStatus;

    if (status === 'failed' && fc.failureType === 'validation') {
      nextCalls.push(fc);
      continue;
    }

    if (status !== 'pending' && status !== 'validating') {
      nextCalls.push(fc);
      continue;
    }

    const isSelected = selections[fc.id] ?? true;
    if (!isSelected) {
      nextCalls.push({
        ...fc,
        status: 'rejected',
        reason: 'User rejected',
        failureType: undefined,
      });
      continue;
    }

    const rawFunctionCall: RawFunctionCall = {
      id: fc.id,
      function_name: fc.function_name,
      arguments: fc.arguments,
    };

    try {
      const result = await applicator.apply(rawFunctionCall, { projectId, language, options });
      if (result.success) {
        nextCalls.push({
          ...fc,
          status: 'accepted',
          reason: undefined,
          failureType: undefined,
          result,
          acceptedAt: new Date(),
        });
      } else {
        nextCalls.push({
          ...fc,
          status: 'failed',
          reason: result.error || result.message,
          failureType: getFailureTypeFromResult({ functionName: fc.function_name, result }),
          result,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      nextCalls.push({
        ...fc,
        status: 'failed',
        reason: errorMessage,
        failureType: 'execution',
      });
    }
  }

  return nextCalls;
}
