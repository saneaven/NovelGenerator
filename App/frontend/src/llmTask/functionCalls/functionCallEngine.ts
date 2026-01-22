import type { FunctionCallMetadata } from '../../llm/requestTypes';
import { useLLMSessionStore } from '../../store/llmSessionStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import {
  buildEditCards,
  applyValidationResults,
  validate,
  normalizeFunctionCall,
  type RawFunctionCall,
  type NormalizedFunctionCall,
  type EditCard,
} from '../../functionCall';
import type { HandlerContext, Handler, HandlerOptions, StoreActions } from '../../functionCall/apply/types';
import type { StoredEditCard } from '../uiTypes';
import type { ApplicationResult, FunctionCallFailureType, FunctionCallStatus } from '../../functionCall/types';
import { CRUD_HANDLERS } from '../../functionCall/apply/handlers/CrudHandlers';
import { PATCH_HANDLERS } from '../../functionCall/apply/handlers/PatchHandlers';
import { REPLACE_HANDLERS } from '../../functionCall/apply/handlers/ReplaceHandlers';
import { READ_HANDLERS } from '../../functionCall/apply/handlers/ReadHandlers';
import { FunctionCallBatchStore } from './FunctionCallBatchStore';
import { ManuscriptBatch } from './manuscriptBatch';

function stripCallbacks(card: EditCard): StoredEditCard {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { onApply, onReject, ...rest } = card;
  return rest;
}

export function toFunctionCallMetadata(cards: StoredEditCard[]): FunctionCallMetadata[] {
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

async function yieldToUI(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

function createBaseStore(): StoreActions {
  const store = useUnifiedObjectStore.getState();
  return {
    getObject: (id) => store.getObject(id),
    fetchObject: (type, id) => store.fetchObject(type, id),
    listObjects: (type, projectId) => store.listObjects(type, projectId),
    createObject: (type, projectId, data, language, metadata, userRequest) =>
      store.createObject(type, projectId, data, language, metadata, userRequest),
    updateObject: (type, id, request) => store.updateObject(type, id, request),
    deleteObject: (type, id) => store.deleteObject(type, id),
  };
}

const HANDLERS: Record<string, Handler> = {
  ...CRUD_HANDLERS,
  ...PATCH_HANDLERS,
  ...REPLACE_HANDLERS,
  ...READ_HANDLERS,
};

async function applyFunctionCall(params: {
  functionCall: RawFunctionCall;
  context: Omit<HandlerContext, 'store'>;
  store: FunctionCallBatchStore;
  manuscriptBatch: ManuscriptBatch;
}): Promise<ApplicationResult> {
  const { functionCall, context, store, manuscriptBatch } = params;
  const normalized = normalizeFunctionCall(functionCall);
  const handlerContext: HandlerContext = { ...context, store, options: context.options };

  try {
    if (normalized.functionName === 'patch_manuscript') {
      return manuscriptBatch.applyPatch({
        callId: normalized.id,
        args: normalized.arguments,
        store,
        language: context.language,
        options: context.options,
      });
    }

    if (normalized.functionName === 'replace_manuscript') {
      return manuscriptBatch.applyReplace({
        callId: normalized.id,
        args: normalized.arguments,
        store,
        projectId: context.projectId,
        language: context.language,
        options: context.options,
      });
    }

    const handler = HANDLERS[normalized.functionName];
    if (!handler) {
      return {
        success: false,
        message: 'Unknown function',
        error: `Unsupported function: ${normalized.functionName}`,
      };
    }

    return await handler(normalized.arguments, handlerContext);
  } catch (error) {
    console.error(`Error executing ${normalized.functionName}:`, error);
    return {
      success: false,
      message: `Error executing ${normalized.functionName}`,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function stageSessionEdits(params: {
  sessionId: string;
  projectId: string;
  language: string;
  functionCalls: FunctionCallMetadata[];
}): Promise<void> {
  const { sessionId, projectId, language, functionCalls } = params;
  const store = useLLMSessionStore.getState();

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
  const store = useLLMSessionStore.getState();
  const session = store.getSessionById(sessionId);
  if (!session?.editCards || session.editCards.length === 0) return;

  store.updateSession(sessionId, { status: 'applying' });

  const baseStore = createBaseStore();
  const batchStore = new FunctionCallBatchStore({ baseStore });
  const manuscriptBatch = new ManuscriptBatch();

  const nextCards: StoredEditCard[] = [];
  let appliedCount = 0;

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
      batchStore.beginCall(rawFunctionCall.id);
      const result = await applyFunctionCall({
        functionCall: rawFunctionCall,
        context: { projectId, language, options },
        store: batchStore,
        manuscriptBatch,
      });
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
    } finally {
      batchStore.endCall();
      appliedCount += 1;
      if (appliedCount % 2 === 0) {
        await yieldToUI();
      }
    }
  }

  await yieldToUI();

  await manuscriptBatch.stageAll({ store: batchStore, yieldToUI });
  const flushResults = await batchStore.flush();
  const finalizedCards =
    flushResults.size === 0
      ? nextCards
      : nextCards.map((card): StoredEditCard => {
        if (card.functionCall.status !== 'accepted') return card;

        const touched = batchStore.getUpdateKeysForCall(card.functionCall.id);
        if (touched.size === 0) return card;

        for (const key of touched) {
          const status = flushResults.get(key);
          if (!status) {
            return {
              ...card,
              functionCall: {
                ...card.functionCall,
                status: 'failed',
                failureType: 'execution',
                reason: 'Batched apply failed: missing flush result',
                result: undefined,
                acceptedAt: undefined,
              },
            };
          }

          if (!status.success) {
            return {
              ...card,
              functionCall: {
                ...card.functionCall,
                status: 'failed',
                failureType: 'execution',
                reason: status.reason,
                result: undefined,
                acceptedAt: undefined,
              },
            };
          }
        }

        return card;
      });

  store.updateSession(sessionId, { editCards: finalizedCards });

  const acceptedCount = finalizedCards.filter(c => c.functionCall.status === 'accepted').length;
  const failedCount = finalizedCards.filter(c => c.functionCall.status === 'failed').length;

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
  const store = useLLMSessionStore.getState();
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
}

export async function applyFunctionCallsDirect(params: {
  projectId: string;
  language: string;
  functionCalls: FunctionCallMetadata[];
  selections: Record<string, boolean>;
  options: HandlerOptions;
}): Promise<FunctionCallMetadata[]> {
  const { projectId, language, functionCalls, selections, options } = params;

  const baseStore = createBaseStore();
  const batchStore = new FunctionCallBatchStore({ baseStore });
  const manuscriptBatch = new ManuscriptBatch();

  const nextCalls: FunctionCallMetadata[] = [];
  let appliedCount = 0;

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
      batchStore.beginCall(rawFunctionCall.id);
      const result = await applyFunctionCall({
        functionCall: rawFunctionCall,
        context: { projectId, language, options },
        store: batchStore,
        manuscriptBatch,
      });
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
    } finally {
      batchStore.endCall();
      appliedCount += 1;
      if (appliedCount % 2 === 0) {
        await yieldToUI();
      }
    }
  }

  await yieldToUI();

  await manuscriptBatch.stageAll({ store: batchStore, yieldToUI });
  const flushResults = await batchStore.flush();
  if (flushResults.size === 0) return nextCalls;

  return nextCalls.map((fc) => {
    if (fc.status !== 'accepted') return fc;

    const touched = batchStore.getUpdateKeysForCall(fc.id);
    if (touched.size === 0) return fc;

    for (const key of touched) {
      const status = flushResults.get(key);
      if (!status) {
        return {
          ...fc,
          status: 'failed',
          reason: 'Batched apply failed: missing flush result',
          failureType: 'execution',
          result: undefined,
          acceptedAt: undefined,
        };
      }

      if (!status.success) {
        return {
          ...fc,
          status: 'failed',
          reason: status.reason,
          failureType: 'execution',
          result: undefined,
          acceptedAt: undefined,
        };
      }
    }

    return fc;
  });
}
