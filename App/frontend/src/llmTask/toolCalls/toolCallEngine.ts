import type { ToolCallMetadata } from '../../llm/requestTypes';
import { useLLMSessionStore } from '../../store/llmSessionStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import {
  buildEditCards,
  applyValidationResults,
  validate,
  normalizeToolCall,
  type RawToolCall,
  type NormalizedToolCall,
  type EditCard,
} from '../../toolCall';
import type { HandlerContext, Handler, HandlerOptions, StoreActions } from '../../toolCall/apply/types';
import type { StoredEditCard } from '../uiTypes';
import type { ApplicationResult, ToolCallFailureType, ToolCallStatus } from '../../toolCall/types';
import { CRUD_HANDLERS } from '../../toolCall/apply/handlers/CrudHandlers';
import { PATCH_HANDLERS } from '../../toolCall/apply/handlers/PatchHandlers';
import { REPLACE_HANDLERS } from '../../toolCall/apply/handlers/ReplaceHandlers';
import { READ_HANDLERS } from '../../toolCall/apply/handlers/ReadHandlers';
import { ToolCallBatchStore } from './ToolCallBatchStore';
import { ManuscriptBatch } from './manuscriptBatch';

function stripCallbacks(card: EditCard): StoredEditCard {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { onApply, onReject, ...rest } = card;
  return rest;
}

export function toToolCallMetadata(cards: StoredEditCard[]): ToolCallMetadata[] {
  return cards.map((card) => ({
    id: card.toolCall.id,
    tool_name: card.toolCall.toolName,
    arguments: card.toolCall.arguments,
    status: card.toolCall.status,
    reason: card.toolCall.reason,
    failureType: card.toolCall.failureType,
    result: card.toolCall.result,
    acceptedAt: card.toolCall.acceptedAt,
  }));
}

function getFailureTypeFromResult(params: {
  toolName: string;
  result?: ApplicationResult;
}): ToolCallFailureType | undefined {
  const { toolName, result } = params;
  if (!result || result.success) return undefined;

  if (toolName.startsWith('patch_')) {
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

async function applyToolCall(params: {
  toolCall: RawToolCall;
  context: Omit<HandlerContext, 'store'>;
  store: ToolCallBatchStore;
  manuscriptBatch: ManuscriptBatch;
}): Promise<ApplicationResult> {
  const { toolCall, context, store, manuscriptBatch } = params;
  const normalized = normalizeToolCall(toolCall);
  const handlerContext: HandlerContext = { ...context, store, options: context.options };

  try {
    if (normalized.toolName === 'patch_manuscript') {
      return manuscriptBatch.applyPatch({
        callId: normalized.id,
        args: normalized.arguments,
        store,
        language: context.language,
        options: context.options,
      });
    }

    if (normalized.toolName === 'replace_manuscript') {
      return manuscriptBatch.applyReplace({
        callId: normalized.id,
        args: normalized.arguments,
        store,
        projectId: context.projectId,
        language: context.language,
        options: context.options,
      });
    }

    const handler = HANDLERS[normalized.toolName];
    if (!handler) {
      return {
        success: false,
        message: 'Unknown function',
        error: `Unsupported function: ${normalized.toolName}`,
      };
    }

    return await handler(normalized.arguments, handlerContext);
  } catch (error) {
    console.error(`Error executing ${normalized.toolName}:`, error);
    return {
      success: false,
      message: `Error executing ${normalized.toolName}`,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function stageSessionEdits(params: {
  sessionId: string;
  projectId: string;
  language: string;
  toolCalls: ToolCallMetadata[];
}): Promise<void> {
  const { sessionId, projectId, language, toolCalls } = params;
  const store = useLLMSessionStore.getState();

  const rawCalls: RawToolCall[] = toolCalls.map(tc => ({
    id: tc.id,
    tool_name: tc.tool_name,
    arguments: tc.arguments,
  }));

  const validatingCards = buildEditCards(rawCalls, { initialStatus: 'validating' });
  store.updateSession(sessionId, { editCards: validatingCards.map(stripCallbacks) });

  const normalized: NormalizedToolCall[] = rawCalls.map(rc => normalizeToolCall(rc));
  const validationResults = await validate(normalized, { projectId, language });
  const finalCards = applyValidationResults(validatingCards, validationResults);

  store.updateSession(sessionId, { editCards: finalCards.map(stripCallbacks) });

  const hasAnyPending = finalCards.some(c => c.toolCall.status === 'pending');
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
  const batchStore = new ToolCallBatchStore({ baseStore });
  const manuscriptBatch = new ManuscriptBatch();

  const nextCards: StoredEditCard[] = [];
  let appliedCount = 0;

  for (const card of session.editCards) {
    const normalized: NormalizedToolCall = {
      id: card.toolCall.id,
      toolName: card.toolCall.toolName,
      arguments: card.toolCall.arguments,
    };

    // Skip validation failures
    if (card.toolCall.status === 'failed' && card.toolCall.failureType === 'validation') {
      nextCards.push(card);
      continue;
    }

    const isSelected = selections[card.id] ?? true;
    if (!isSelected) {
      nextCards.push({
        ...card,
        toolCall: {
          ...card.toolCall,
          status: 'rejected',
          reason: 'User rejected',
          failureType: undefined,
        },
      });
      continue;
    }

    const rawToolCall: RawToolCall = {
      id: normalized.id,
      tool_name: normalized.toolName,
      arguments: normalized.arguments,
    };

    try {
      batchStore.beginCall(rawToolCall.id);
      const result = await applyToolCall({
        toolCall: rawToolCall,
        context: { projectId, language, options },
        store: batchStore,
        manuscriptBatch,
      });
      if (result.success) {
        nextCards.push({
          ...card,
          toolCall: {
            ...card.toolCall,
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
          toolCall: {
            ...card.toolCall,
            status: 'failed',
            failureType: getFailureTypeFromResult({ toolName: normalized.toolName, result }),
            reason: result.error || result.message,
            result,
          },
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      nextCards.push({
        ...card,
        toolCall: {
          ...card.toolCall,
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
        if (card.toolCall.status !== 'accepted') return card;

        const touched = batchStore.getUpdateKeysForCall(card.toolCall.id);
        if (touched.size === 0) return card;

        for (const key of touched) {
          const status = flushResults.get(key);
          if (!status) {
            return {
              ...card,
              toolCall: {
                ...card.toolCall,
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
              toolCall: {
                ...card.toolCall,
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

  const acceptedCount = finalizedCards.filter(c => c.toolCall.status === 'accepted').length;
  const failedCount = finalizedCards.filter(c => c.toolCall.status === 'failed').length;

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
    toolCall: {
      ...card.toolCall,
      status: 'rejected' as const,
      reason: reason ?? 'User rejected all',
      failureType: undefined,
    },
  }));

  store.updateSession(sessionId, { editCards: next, status: 'cancelled' });
}

export async function applyToolCallsDirect(params: {
  projectId: string;
  language: string;
  toolCalls: ToolCallMetadata[];
  selections: Record<string, boolean>;
  options: HandlerOptions;
}): Promise<ToolCallMetadata[]> {
  const { projectId, language, toolCalls, selections, options } = params;

  const baseStore = createBaseStore();
  const batchStore = new ToolCallBatchStore({ baseStore });
  const manuscriptBatch = new ManuscriptBatch();

  const nextCalls: ToolCallMetadata[] = [];
  let appliedCount = 0;

  for (const tc of toolCalls) {
    const status = (tc.status ?? 'pending') as ToolCallStatus;

    if (status === 'failed' && tc.failureType === 'validation') {
      nextCalls.push(tc);
      continue;
    }

    if (status !== 'pending' && status !== 'validating') {
      nextCalls.push(tc);
      continue;
    }

    const isSelected = selections[tc.id] ?? true;
    if (!isSelected) {
      nextCalls.push({
        ...tc,
        status: 'rejected',
        reason: 'User rejected',
        failureType: undefined,
      });
      continue;
    }

    const rawToolCall: RawToolCall = {
      id: tc.id,
      tool_name: tc.tool_name,
      arguments: tc.arguments,
    };

    try {
      batchStore.beginCall(rawToolCall.id);
      const result = await applyToolCall({
        toolCall: rawToolCall,
        context: { projectId, language, options },
        store: batchStore,
        manuscriptBatch,
      });
      if (result.success) {
        nextCalls.push({
          ...tc,
          status: 'accepted',
          reason: undefined,
          failureType: undefined,
          result,
          acceptedAt: new Date(),
        });
      } else {
        nextCalls.push({
          ...tc,
          status: 'failed',
          reason: result.error || result.message,
          failureType: getFailureTypeFromResult({ toolName: tc.tool_name, result }),
          result,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      nextCalls.push({
        ...tc,
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

  return nextCalls.map((tc) => {
    if (tc.status !== 'accepted') return tc;

    const touched = batchStore.getUpdateKeysForCall(tc.id);
    if (touched.size === 0) return tc;

    for (const key of touched) {
      const status = flushResults.get(key);
      if (!status) {
        return {
          ...tc,
          status: 'failed',
          reason: 'Batched apply failed: missing flush result',
          failureType: 'execution',
          result: undefined,
          acceptedAt: undefined,
        };
      }

      if (!status.success) {
        return {
          ...tc,
          status: 'failed',
          reason: status.reason,
          failureType: 'execution',
          result: undefined,
          acceptedAt: undefined,
        };
      }
    }

    return tc;
  });
}
