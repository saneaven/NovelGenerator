import type { ToolCallMetadata } from '../../llm/requestTypes';
import { useLLMSessionStore } from '../../store/llmSessionStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSubAgentStore } from '../../store/subAgentStore';
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
import { SUB_AGENT_HANDLERS } from '../../toolCall/apply/handlers/SubAgentHandlers';
import { ToolCallBatchSharedState, ToolCallBatchStore } from './ToolCallBatchStore';
import { ManuscriptBatch } from './manuscriptBatch';
import { SubAgentManager } from '../../subAgent/runtime/SubAgentManager';
import { agentNameFromCallToolName, isCallToolName } from '../../subAgent/tools/SubAgentCallTools';
import type { InvocationCaller } from '../../types/agentRuntime';

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
  ...SUB_AGENT_HANDLERS,
};

async function applyToolCall(params: {
  toolCall: RawToolCall;
  context: Omit<HandlerContext, 'store' | 'callId'>;
  store: ToolCallBatchStore;
  manuscriptBatch: ManuscriptBatch;
}): Promise<ApplicationResult> {
  const { toolCall, context, store, manuscriptBatch } = params;
  const normalized = normalizeToolCall(toolCall);
  const handlerContext: HandlerContext = { ...context, callId: normalized.id, store, options: context.options };

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

    if (isCallToolName(normalized.toolName)) {
      const agentName = agentNameFromCallToolName(normalized.toolName);
      if (!agentName) {
        return {
          success: false,
          message: 'Invalid Sub Agent tool name',
          error: `Invalid Sub Agent tool name: ${normalized.toolName}`,
        };
      }

      const caller = context.invocationCaller;
      if (!caller) {
        return {
          success: false,
          message: 'Missing invocationCaller for Sub Agent call',
          error: 'Missing invocationCaller for Sub Agent call',
        };
      }

      const input = (normalized.arguments as any).input;
      if (typeof input !== 'string' || !input.trim()) {
        return {
          success: false,
          message: 'Invalid input for Sub Agent call',
          error: 'call_* tools require a non-empty string field "input".',
        };
      }

      const subAgentStore = useSubAgentStore.getState();
      if (subAgentStore.subAgents.length === 0 && !subAgentStore.isLoading) {
        await subAgentStore.loadSubAgents();
      }

      const def = subAgentStore.getByAgentName(agentName);
      if (!def) {
        return {
          success: false,
          message: 'Sub Agent not found',
          error: `Sub Agent not found: ${agentName}`,
        };
      }

      const output = await SubAgentManager.invoke({
        projectId: context.projectId,
        language: context.language,
        parentToolCallId: normalized.id,
        caller,
        subAgentId: def.id,
        input,
        handlerOptions: { ...context.options, userRequest: 'SubAgent' },
      });

      return { success: true, message: output, data: { subAgentId: def.id, agentName } };
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
  const existingSession = store.getSessionById(sessionId);
  const allowedToolNames = existingSession?.availableToolNames;

  const rawCalls: RawToolCall[] = toolCalls.map(tc => ({
    id: tc.id,
    tool_name: tc.tool_name,
    arguments: tc.arguments,
  }));

  const validatingCards = buildEditCards(rawCalls, { initialStatus: 'validating' });
  store.updateSession(sessionId, { editCards: validatingCards.map(stripCallbacks) });

  const normalized: NormalizedToolCall[] = rawCalls.map(rc => normalizeToolCall(rc));
  const validationResults = await validate(normalized, { projectId, language, allowedToolNames });
  const finalCards = applyValidationResults(validatingCards, validationResults);

  store.updateSession(sessionId, { editCards: finalCards.map(stripCallbacks) });

  const hasAnyPending = finalCards.some(c => c.toolCall.status === 'pending');
  if (hasAnyPending) {
    store.updateSession(sessionId, { status: 'pending_confirmation' });
    return;
  }

  if (finalCards.length === 0) {
    store.updateSession(sessionId, {
      status: 'success',
      warning: 'AI response did not include any applicable actions.',
      error: undefined,
    });
    return;
  }

  store.updateSession(sessionId, {
    status: 'success',
    warning: 'All proposed actions failed validation.',
    error: undefined,
  });

  console.warn('[stageSessionEdits] All validation failed', { sessionId, projectId, language });
}

export async function applySessionEdits(params: {
  sessionId: string;
  projectId: string;
  language: string;
  selections: Record<string, boolean>;
  options: HandlerOptions;
  invocationCaller?: InvocationCaller;
}): Promise<void> {
  const { sessionId, projectId, language, selections, options, invocationCaller } = params;
  const store = useLLMSessionStore.getState();
  const session = store.getSessionById(sessionId);
  if (!session?.editCards || session.editCards.length === 0) return;

  store.updateSession(sessionId, { status: 'applying' });

  const baseStore = createBaseStore();
  const shared = new ToolCallBatchSharedState();
  const flushStore = new ToolCallBatchStore({ baseStore, shared });
  const manuscriptBatch = new ManuscriptBatch();

  // Mark selected tool calls as running so the UI shows progress for long-running calls (e.g. call_*).
  store.updateSession(sessionId, {
    editCards: session.editCards.map((card) => {
      const isSelected = selections[card.id] ?? true;
      const isValidationFailed =
        card.toolCall.status === 'failed' && card.toolCall.failureType === 'validation';
      if (!isSelected || isValidationFailed) return card;
      if (card.toolCall.status !== 'pending' && card.toolCall.status !== 'validating') return card;
      return {
        ...card,
        toolCall: {
          ...card.toolCall,
          status: 'running',
        },
      };
    }),
  });

  const nextCards = await Promise.all(session.editCards.map(async (card): Promise<StoredEditCard> => {
    const normalized: NormalizedToolCall = {
      id: card.toolCall.id,
      toolName: card.toolCall.toolName,
      arguments: card.toolCall.arguments,
    };

    // Skip validation failures
    if (card.toolCall.status === 'failed' && card.toolCall.failureType === 'validation') {
      return card;
    }

    const isSelected = selections[card.id] ?? true;
    if (!isSelected) {
      return {
        ...card,
        toolCall: {
          ...card.toolCall,
          status: 'rejected',
          reason: 'User rejected',
          failureType: undefined,
        },
      };
    }

    const rawToolCall: RawToolCall = {
      id: normalized.id,
      tool_name: normalized.toolName,
      arguments: normalized.arguments,
    };

    try {
      const callStore = new ToolCallBatchStore({ baseStore, shared });
      callStore.beginCall(rawToolCall.id);
      const result = await applyToolCall({
        toolCall: rawToolCall,
        context: { projectId, language, options, invocationCaller },
        store: callStore,
        manuscriptBatch,
      });
      if (result.success) {
        return {
          ...card,
          toolCall: {
            ...card.toolCall,
            status: 'accepted',
            reason: undefined,
            failureType: undefined,
            result,
            acceptedAt: new Date(),
          },
        };
      } else {
        return {
          ...card,
          toolCall: {
            ...card.toolCall,
            status: 'failed',
            failureType: getFailureTypeFromResult({ toolName: normalized.toolName, result }),
            reason: result.error || result.message,
            result,
          },
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        ...card,
        toolCall: {
          ...card.toolCall,
          status: 'failed',
          failureType: 'execution',
          reason: errorMessage,
        },
      };
    }
  }));

  await manuscriptBatch.stageAll({ store: flushStore, yieldToUI });
  const flushResults = await flushStore.flush(yieldToUI);
  const finalizedCards =
    flushResults.size === 0
      ? nextCards
      : nextCards.map((card): StoredEditCard => {
        if (card.toolCall.status !== 'accepted') return card;

        const touched = flushStore.getUpdateKeysForCall(card.toolCall.id);
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

  const acceptedCount = finalizedCards.filter((c) => c.toolCall.status === 'accepted').length;
  const rejectedCount = finalizedCards.filter((c) => c.toolCall.status === 'rejected').length;
  const failedValidationCount = finalizedCards.filter(
    (c) => c.toolCall.status === 'failed' && c.toolCall.failureType === 'validation'
  ).length;
  const failedApplyCount = finalizedCards.filter(
    (c) => c.toolCall.status === 'failed' && c.toolCall.failureType !== 'validation'
  ).length;

  if (acceptedCount === 0 && failedApplyCount === 0 && rejectedCount > 0 && failedValidationCount === 0) {
    store.updateSession(sessionId, { status: 'cancelled' });
    return;
  }

  if (failedApplyCount > 0) {
    store.updateSession(sessionId, {
      status: 'error',
      error: `${failedApplyCount} action(s) failed to apply.`,
      warning: failedValidationCount > 0 ? `${failedValidationCount} action(s) failed validation.` : undefined,
    });
    return;
  }

  if (failedValidationCount > 0) {
    store.updateSession(sessionId, {
      status: acceptedCount > 0 ? 'success' : rejectedCount > 0 ? 'cancelled' : 'success',
      warning: `${failedValidationCount} action(s) failed validation.`,
      error: undefined,
    });
    return;
  }

  if (acceptedCount === 0) {
    store.updateSession(sessionId, { status: 'cancelled' });
    return;
  }

  store.updateSession(sessionId, { status: 'success', warning: undefined, error: undefined });
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
  invocationCaller?: InvocationCaller;
}): Promise<ToolCallMetadata[]> {
  const { projectId, language, toolCalls, selections, options, invocationCaller } = params;

  const baseStore = createBaseStore();
  const shared = new ToolCallBatchSharedState();
  const flushStore = new ToolCallBatchStore({ baseStore, shared });
  const manuscriptBatch = new ManuscriptBatch();

  const nextCalls = await Promise.all(toolCalls.map(async (tc): Promise<ToolCallMetadata> => {
    const status = (tc.status ?? 'pending') as ToolCallStatus;

    if (status === 'failed' && tc.failureType === 'validation') {
      return tc;
    }

    if (status !== 'pending' && status !== 'validating') {
      return tc;
    }

    const isSelected = selections[tc.id] ?? true;
    if (!isSelected) {
      return {
        ...tc,
        status: 'rejected',
        reason: 'User rejected',
        failureType: undefined,
      };
    }

    const rawToolCall: RawToolCall = {
      id: tc.id,
      tool_name: tc.tool_name,
      arguments: tc.arguments,
    };

    try {
      const callStore = new ToolCallBatchStore({ baseStore, shared });
      callStore.beginCall(rawToolCall.id);
      const result = await applyToolCall({
        toolCall: rawToolCall,
        context: { projectId, language, options, invocationCaller },
        store: callStore,
        manuscriptBatch,
      });
      if (result.success) {
        return {
          ...tc,
          status: 'accepted',
          reason: undefined,
          failureType: undefined,
          result,
          acceptedAt: new Date(),
        };
      } else {
        return {
          ...tc,
          status: 'failed',
          reason: result.error || result.message,
          failureType: getFailureTypeFromResult({ toolName: tc.tool_name, result }),
          result,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        ...tc,
        status: 'failed',
        reason: errorMessage,
        failureType: 'execution',
      };
    }
  }));

  await manuscriptBatch.stageAll({ store: flushStore, yieldToUI });
  const flushResults = await flushStore.flush(yieldToUI);
  if (flushResults.size === 0) return nextCalls;

  return nextCalls.map((tc) => {
    if (tc.status !== 'accepted') return tc;

    const touched = flushStore.getUpdateKeysForCall(tc.id);
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
