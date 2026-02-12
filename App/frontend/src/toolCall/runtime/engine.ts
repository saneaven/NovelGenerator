import type { ToolCallMetadata } from '../../llm/requestTypes';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSubAgentStore } from '../../store/subAgentStore';
import type { ToolCallAutoApproveConfig } from '../../store/settingsStore';
import { buildEditCards, applyValidationResults } from '../editCards';
import { validate } from '../validation';
import { normalizeToolCall } from '../normalizer';
import type { RawToolCall, NormalizedToolCall } from '../types';
import type { HandlerContext, Handler, HandlerOptions, StoreActions } from '../apply/types';
import type {
  ApplicationResult,
  ToolCallDecisionMap,
  ToolCallFailureType,
  ToolCallStatus,
} from '../types';
import { getAutoApproveCategory } from '../schemas/schemaRegistry';
import { CRUD_HANDLERS } from '../apply/handlers/CrudHandlers';
import { PATCH_HANDLERS } from '../apply/handlers/PatchHandlers';
import { REPLACE_HANDLERS } from '../apply/handlers/ReplaceHandlers';
import { READ_HANDLERS } from '../apply/handlers/ReadHandlers';
import { SUB_AGENT_HANDLERS } from '../apply/handlers/SubAgentHandlers';
import { ToolCallBatchSharedState, ToolCallBatchStore } from './ToolCallBatchStore';
import { ManuscriptBatch } from './manuscriptBatch';
import { SubAgentManager } from '../../subAgent/runtime/SubAgentManager';
import { agentNameFromCallToolName, isCallToolName } from '../../subAgent/tools/SubAgentCallTools';
import type { InvocationCaller } from '../../types/agentRuntime';

const HANDLERS: Record<string, Handler> = {
  ...CRUD_HANDLERS,
  ...PATCH_HANDLERS,
  ...REPLACE_HANDLERS,
  ...READ_HANDLERS,
  ...SUB_AGENT_HANDLERS,
};

export interface ToolCallRunResult {
  toolCalls: ToolCallMetadata[];
  status: 'pending_confirmation' | 'success' | 'error' | 'cancelled';
  error?: string;
  warning?: string;
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

function normalizeStatus(status: ToolCallMetadata['status']): ToolCallStatus {
  return (status ?? 'pending') as ToolCallStatus;
}

function isValidationFailure(status: ToolCallStatus, failureType?: ToolCallFailureType): boolean {
  return status === 'failed' && failureType === 'validation';
}

function isDecisionEligibleStatus(status: ToolCallStatus): boolean {
  return status === 'pending' || status === 'validating';
}

function isDecisionProcessableStatus(status: ToolCallStatus): boolean {
  return status === 'pending' || status === 'validating' || status === 'processing' || status === 'running';
}

function evaluateToolCallStatus(toolCalls: ToolCallMetadata[]): Omit<ToolCallRunResult, 'toolCalls'> {
  const acceptedCount = toolCalls.filter((c) => normalizeStatus(c.status) === 'accepted').length;
  const rejectedCount = toolCalls.filter((c) => normalizeStatus(c.status) === 'rejected').length;
  const pendingCount = toolCalls.filter((c) => {
    const status = normalizeStatus(c.status);
    return status === 'pending' || status === 'validating' || status === 'processing' || status === 'running';
  }).length;
  const failedValidationCount = toolCalls.filter((c) => {
    const status = normalizeStatus(c.status);
    return isValidationFailure(status, c.failureType);
  }).length;
  const failedApplyCount = toolCalls.filter((c) => {
    const status = normalizeStatus(c.status);
    return status === 'failed' && c.failureType !== 'validation';
  }).length;

  if (pendingCount > 0) {
    return {
      status: 'pending_confirmation',
      error: failedApplyCount > 0 ? `${failedApplyCount} action(s) failed to apply.` : undefined,
      warning: failedValidationCount > 0 ? `${failedValidationCount} action(s) failed validation.` : undefined,
    };
  }

  if (acceptedCount === 0 && failedApplyCount === 0 && rejectedCount > 0 && failedValidationCount === 0) {
    return { status: 'cancelled' };
  }

  if (failedApplyCount > 0) {
    return {
      status: 'error',
      error: `${failedApplyCount} action(s) failed to apply.`,
      warning: failedValidationCount > 0 ? `${failedValidationCount} action(s) failed validation.` : undefined,
    };
  }

  if (failedValidationCount > 0) {
    return {
      status: acceptedCount > 0 ? 'success' : rejectedCount > 0 ? 'cancelled' : 'success',
      warning: `${failedValidationCount} action(s) failed validation.`,
    };
  }

  if (acceptedCount === 0) {
    return { status: 'cancelled' };
  }

  return { status: 'success' };
}

export function markToolCallsRunning(params: {
  toolCalls: ToolCallMetadata[];
  decisions: ToolCallDecisionMap;
}): ToolCallMetadata[] {
  const { toolCalls, decisions } = params;

  return toolCalls.map((toolCall) => {
    const status = normalizeStatus(toolCall.status);
    const decision = decisions[toolCall.id];

    if (decision !== 'accept') return toolCall;
    if (isValidationFailure(status, toolCall.failureType)) return toolCall;
    if (!isDecisionEligibleStatus(status)) return toolCall;

    return {
      ...toolCall,
      status: isCallToolName(toolCall.tool_name) ? 'running' : 'processing',
      reason: undefined,
      failureType: undefined,
    };
  });
}

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

      const agentId = context.options?.agentId;
      if (!agentId) {
        return {
          success: false,
          message: 'Missing agentId for Sub Agent call',
          error: 'Missing agentId for Sub Agent call',
        };
      }

      let parentType: 'agent' | 'sub_agent';
      let parentId: string;
      let parentMessageId: string;

      if (context.options?.parentSubInvocationId && context.options?.parentSubMessageId) {
        parentType = 'sub_agent';
        parentId = context.options.parentSubInvocationId;
        parentMessageId = context.options.parentSubMessageId;
      } else if (context.options?.parentAgentMessageId) {
        parentType = 'agent';
        parentId = agentId;
        parentMessageId = context.options.parentAgentMessageId;
      } else {
        return {
          success: false,
          message: 'Missing parent context for Sub Agent call',
          error: 'Missing parent context for Sub Agent call',
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
        agentId,
        language: context.language,
        parentType,
        parentId,
        parentMessageId,
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

export async function stageToolCalls(params: {
  projectId: string;
  language: string;
  toolCalls: ToolCallMetadata[];
  allowedToolNames?: string[];
}): Promise<ToolCallRunResult> {
  const { projectId, language, toolCalls, allowedToolNames } = params;

  if (!toolCalls.length) {
    return {
      toolCalls: [],
      status: 'success',
      warning: 'AI response did not include any applicable actions.',
      error: undefined,
    };
  }

  const rawCalls: RawToolCall[] = toolCalls.map((toolCall) => ({
    id: toolCall.id,
    tool_name: toolCall.tool_name,
    arguments: toolCall.arguments,
  }));

  const validatingCards = buildEditCards(rawCalls, { initialStatus: 'validating' });
  const normalized: NormalizedToolCall[] = rawCalls.map((rawCall) => normalizeToolCall(rawCall));
  const validationResults = await validate(normalized, { projectId, language, allowedToolNames });
  const finalCards = applyValidationResults(validatingCards, validationResults);

  const cardById = new Map(finalCards.map((card) => [card.id, card]));
  const stagedToolCalls = toolCalls.map((toolCall) => {
    const card = cardById.get(toolCall.id);
    if (!card) return toolCall;

    return {
      ...toolCall,
      status: card.toolCall.status,
      reason: card.toolCall.reason,
      failureType: card.toolCall.failureType,
      result: undefined,
      acceptedAt: undefined,
    };
  });

  const evaluated = evaluateToolCallStatus(stagedToolCalls);
  return {
    toolCalls: stagedToolCalls,
    status: evaluated.status,
    error: evaluated.error,
    warning: evaluated.warning,
  };
}

export async function applyToolCalls(params: {
  projectId: string;
  language: string;
  toolCalls: ToolCallMetadata[];
  decisions: ToolCallDecisionMap;
  options: HandlerOptions;
  invocationCaller?: InvocationCaller;
}): Promise<ToolCallRunResult> {
  const { projectId, language, toolCalls, decisions, options, invocationCaller } = params;

  if (!toolCalls.length) {
    return { toolCalls: [], status: 'success' };
  }

  const hasAnyDecision = toolCalls.some((toolCall) => {
    const decision = decisions[toolCall.id];
    if (!decision) return false;

    const status = normalizeStatus(toolCall.status);
    if (isValidationFailure(status, toolCall.failureType)) return false;
    return isDecisionProcessableStatus(status);
  });

  if (!hasAnyDecision) {
    const evaluated = evaluateToolCallStatus(toolCalls);
    return {
      toolCalls,
      status: evaluated.status,
      error: evaluated.error,
      warning: evaluated.warning,
    };
  }

  const baseStore = createBaseStore();
  const shared = new ToolCallBatchSharedState();
  const flushStore = new ToolCallBatchStore({ baseStore, shared });
  const manuscriptBatch = new ManuscriptBatch();

  const nextToolCalls = await Promise.all(toolCalls.map(async (toolCall): Promise<ToolCallMetadata> => {
    const normalized: NormalizedToolCall = normalizeToolCall({
      id: toolCall.id,
      tool_name: toolCall.tool_name,
      arguments: toolCall.arguments,
    });

    const status = normalizeStatus(toolCall.status);

    if (isValidationFailure(status, toolCall.failureType)) {
      return toolCall;
    }

    if (!isDecisionProcessableStatus(status)) {
      return toolCall;
    }

    const decision = decisions[toolCall.id];
    if (!decision) {
      return toolCall;
    }

    if (decision === 'reject') {
      return {
        ...toolCall,
        status: 'rejected',
        reason: 'User rejected',
        failureType: undefined,
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
      callStore.endCall();

      if (result.success) {
        return {
          ...toolCall,
          status: 'accepted',
          reason: undefined,
          failureType: undefined,
          result,
          acceptedAt: new Date(),
        };
      }

      return {
        ...toolCall,
        status: 'failed',
        failureType: getFailureTypeFromResult({ toolName: normalized.toolName, result }),
        reason: result.error || result.message,
        result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        ...toolCall,
        status: 'failed',
        failureType: 'execution',
        reason: errorMessage,
      };
    }
  }));

  await manuscriptBatch.stageAll({ store: flushStore, yieldToUI });
  const flushResults = await flushStore.flush(yieldToUI);

  const finalizedToolCalls: ToolCallMetadata[] = flushResults.size === 0
    ? nextToolCalls
    : nextToolCalls.map((toolCall): ToolCallMetadata => {
      const status = normalizeStatus(toolCall.status);
      if (status !== 'accepted') return toolCall;

      const touched = flushStore.getUpdateKeysForCall(toolCall.id);
      if (touched.size === 0) return toolCall;

      for (const key of touched) {
        const flushStatus = flushResults.get(key);
        if (!flushStatus) {
          return {
            ...toolCall,
            status: 'failed' as const,
            failureType: 'execution' as const,
            reason: 'Batched apply failed: missing flush result',
            result: undefined,
            acceptedAt: undefined,
          };
        }

        if (!flushStatus.success) {
          return {
            ...toolCall,
            status: 'failed' as const,
            failureType: 'execution' as const,
            reason: flushStatus.reason,
            result: undefined,
            acceptedAt: undefined,
          };
        }
      }

      return toolCall;
    });

  const evaluated = evaluateToolCallStatus(finalizedToolCalls);
  return {
    toolCalls: finalizedToolCalls,
    status: evaluated.status,
    error: evaluated.error,
    warning: evaluated.warning,
  };
}

export function rejectAllToolCalls(params: {
  toolCalls: ToolCallMetadata[];
  reason?: string;
}): ToolCallRunResult {
  const { toolCalls, reason } = params;

  if (!toolCalls.length) {
    return { toolCalls: [], status: 'success' };
  }

  const nextToolCalls = toolCalls.map((toolCall) => {
    const status = normalizeStatus(toolCall.status);
    if (!isDecisionEligibleStatus(status)) {
      return toolCall;
    }

    return {
      ...toolCall,
      status: 'rejected' as const,
      reason: reason ?? 'User rejected all pending actions',
      failureType: undefined,
    };
  });

  const evaluated = evaluateToolCallStatus(nextToolCalls);
  return {
    toolCalls: nextToolCalls,
    status: evaluated.status,
    error: evaluated.error,
    warning: evaluated.warning,
  };
}

/**
 * Build auto-approve decisions for staged tool calls based on user config.
 * Only tool calls in 'pending' or 'validating' status are eligible.
 * Tool calls that failed validation are never auto-approved.
 */
export function buildAutoApproveDecisions(params: {
  toolCalls: ToolCallMetadata[];
  config: ToolCallAutoApproveConfig;
}): {
  decisions: ToolCallDecisionMap;
  allAutoApproved: boolean;
} {
  const { toolCalls, config } = params;
  const decisions: ToolCallDecisionMap = {};
  let hasAnyPending = false;
  let allAutoApproved = true;

  for (const toolCall of toolCalls) {
    const status = normalizeStatus(toolCall.status);

    if (!isDecisionEligibleStatus(status)) continue;
    if (isValidationFailure(status, toolCall.failureType)) continue;

    hasAnyPending = true;

    const category = getAutoApproveCategory(toolCall.tool_name);
    if (category && config[category]) {
      decisions[toolCall.id] = 'accept';
    } else {
      allAutoApproved = false;
    }
  }

  if (!hasAnyPending) {
    allAutoApproved = false;
  }

  return { decisions, allAutoApproved };
}
