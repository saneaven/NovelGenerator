import { startLLMSession } from '../../llmSession';
import { useAgentStore } from '../../store/agentStore';
import { useCredentialsStore } from '../../store/credentialsStore';
import { useLLMSessionStore } from '../../store/llmSessionStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useSubAgentStore } from '../../store/subAgentStore';
import {
  buildSubAgentInvocationKey,
  type SubAgentInvocation,
  type SubAgentParentType,
  useSubAgentRuntimeStore,
} from '../../store/subAgentRuntimeStore';
import { schemaRegistry } from '../../toolCall/schemas/schemaRegistry';
import { LLMTaskMode } from '../../llm/types';
import { PromptManager } from '../../llm/PromptManager';
import type { ChatMessage, ToolCallMetadata } from '../../llm/requestTypes';
import type { ToolCallSchema } from '../../toolCall';
import type { TaskAIConfig } from '../../store/settingsStore';
import {
  stageToolCalls,
  applyToolCalls,
  markToolCallsRunning,
} from '../../toolCall/runtime';
import type { HandlerOptions } from '../../toolCall/apply/types';
import type { ApplicationResult, ToolCallDecisionMap } from '../../toolCall/types';
import { generateTempId } from '../../utils/tempId';
import type { SubAgentDefinition } from '../../types/subAgents';
import { buildCallToolSchema } from '../tools/SubAgentCallTools';
import type { InvocationCaller } from '../../types/agentRuntime';
import { subAgentInvocationService } from '../../api/subAgentInvocationService';
import { evaluateToolCallAutoContinue } from '../../agent/utils/autoContinuePolicy';

type Completion = { resolve: (output: string) => void; reject: (error: Error) => void };
type InvocationControlIntent = 'pause' | 'cancel';

type InvocationConfig = {
  projectId: string;
  agentId: string;
  language: string;
  parentType: SubAgentParentType;
  parentId: string;
  parentMessageId: string;
  parentToolCallId: string;
  caller: InvocationCaller;
  subAgentId: string;
  input: string;
  handlerOptions: HandlerOptions;
};

const completions = new Map<string, Completion>();
const invocationControlIntents = new Map<string, InvocationControlIntent>();
const RETURN_RESULT_TOOL_NAME = 'return_sub_agent_result';
const RETURN_RESULT_RULE_REASON =
  'return_sub_agent_result must be called exactly once and must be the ONLY tool call in the final message of the Sub Agent invocation. ' +
  'Do other tool calls first. When finished, call return_sub_agent_result alone with a non-empty string field "result".';

function setControlIntent(invocationKey: string, intent: InvocationControlIntent): void {
  invocationControlIntents.set(invocationKey, intent);
}

function consumeControlIntent(invocationKey: string): InvocationControlIntent | undefined {
  const intent = invocationControlIntents.get(invocationKey);
  if (intent) invocationControlIntents.delete(invocationKey);
  return intent;
}

function clearControlIntent(invocationKey: string): void {
  invocationControlIntents.delete(invocationKey);
}

function stringifyInputForUserMessage(input: string): string {
  return (input ?? '').trim();
}

function contentText(parts: Array<{ type: string; text: string }>): string {
  return parts
    .filter((part) => part.type === 'content')
    .map((part) => part.text)
    .join('')
    .trim();
}

function findLastAssistantMessageId(history: ChatMessage[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role === 'assistant') return String(history[i].id);
  }
  return null;
}

function findLastAssistantMessageIndex(history: ChatMessage[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role === 'assistant') return i;
  }
  return -1;
}

function mapPersistedMessagesToHistory(messages: Array<any>): ChatMessage[] {
  return [...messages]
    .sort((left, right) => Number(left.seq ?? 0) - Number(right.seq ?? 0))
    .map((message) => ({
      id: String(message.id),
      seq: Number(message.seq ?? 0),
      role: String(message.role) as any,
      contentParts: (message.content_parts ?? []) as any,
      toolCalls: (message.tool_calls ?? undefined) as any,
      thinking_details: (message.thinking_details ?? undefined) as any,
      timestamp: message.created_at ? new Date(message.created_at) : new Date(),
    }));
}

function ensureCompletion(invocationKey: string): Promise<string> {
  if (completions.has(invocationKey)) {
    return new Promise((resolve, reject) => {
      const existing = completions.get(invocationKey)!;
      const previousResolve = existing.resolve;
      const previousReject = existing.reject;
      completions.set(invocationKey, {
        resolve: (output) => {
          previousResolve(output);
          resolve(output);
        },
        reject: (error) => {
          previousReject(error);
          reject(error);
        },
      });
    });
  }

  return new Promise<string>((resolve, reject) => {
    completions.set(invocationKey, { resolve, reject });
  });
}

async function loadDefinitionOrThrow(subAgentId: string): Promise<SubAgentDefinition> {
  const store = useSubAgentStore.getState();
  if (store.subAgents.length === 0 && !store.isLoading) {
    await store.loadSubAgents();
  }
  const found = store.getById(subAgentId);
  if (!found) {
    throw new Error(`Sub Agent not found: ${subAgentId}`);
  }
  return found;
}

async function buildToolSchemas(definition: SubAgentDefinition): Promise<ToolCallSchema[]> {
  const schemas: ToolCallSchema[] = [];

  for (const name of definition.allowed_tool_names) {
    if (name.startsWith('call_')) {
      throw new Error(`allowed_tool_names must not contain call_* tools (found: ${name})`);
    }
    if (name === RETURN_RESULT_TOOL_NAME) continue;

    const schema = schemaRegistry.get(name);
    if (!schema) {
      throw new Error(`Unsupported tool in allowlist: ${name}`);
    }

    schemas.push({ name: schema.name, description: schema.description, parameters: schema.parameters });
  }

  const store = useSubAgentStore.getState();
  if (store.subAgents.length === 0 && !store.isLoading) {
    await store.loadSubAgents();
  }

  for (const subAgentId of definition.allowed_sub_agent_ids ?? []) {
    if (subAgentId === definition.id) continue;
    const target = store.getById(subAgentId);
    if (!target) {
      throw new Error(`Allowed Sub Agent not found: ${subAgentId}`);
    }
    if (!target.enabled) continue;

    schemas.push(buildCallToolSchema(target));
  }

  const returnSchema = schemaRegistry.get(RETURN_RESULT_TOOL_NAME);
  if (!returnSchema) {
    throw new Error(`Missing schema: ${RETURN_RESULT_TOOL_NAME}`);
  }

  schemas.push({
    name: returnSchema.name,
    description: returnSchema.description,
    parameters: returnSchema.parameters,
  });

  return schemas;
}

async function ensureInvocationRuntimeConfig(invocationKey: string): Promise<SubAgentInvocation | undefined> {
  const runtime = useSubAgentRuntimeStore.getState();
  const invocation = runtime.getInvocationByKey(invocationKey);
  if (!invocation) return undefined;
  if (invocation.llmConfig && invocation.tools) return invocation;

  const definition = await loadDefinitionOrThrow(invocation.subAgentId);
  if (!definition.enabled) {
    throw new Error(`Sub Agent is disabled: ${invocation.subAgentId}`);
  }
  if (!definition.allowed_invocation_modes.includes(invocation.caller)) {
    throw new Error(`Sub Agent not allowed from caller: ${invocation.caller}`);
  }

  const tools = await buildToolSchemas(definition);
  const settingsStore = useSettingsStore.getState();
  const globalConfig = settingsStore.getTaskConfig('subAgent');
  const llmConfig: TaskAIConfig = definition.use_custom_llm_config ? definition.llm_config_override! : globalConfig;

  runtime.updateInvocation(invocationKey, {
    agentName: definition.agent_name,
    displayName: definition.display_name,
    llmConfig,
    tools,
    handlerOptions: invocation.handlerOptions ?? { userRequest: 'SubAgent' },
  });

  return runtime.getInvocationByKey(invocationKey);
}

function applyReturnResultBatchRules(toolCalls: ToolCallMetadata[]): ToolCallMetadata[] {
  const returnCalls = toolCalls.filter((toolCall) => toolCall.tool_name === RETURN_RESULT_TOOL_NAME);
  if (returnCalls.length === 0) return toolCalls;

  const hasOtherTools = toolCalls.some((toolCall) => toolCall.tool_name !== RETURN_RESULT_TOOL_NAME);
  const hasMultipleReturns = returnCalls.length > 1;

  let changed = false;
  const next = toolCalls.map((toolCall) => {
    if (toolCall.tool_name !== RETURN_RESULT_TOOL_NAME) return toolCall;

    const result = (toolCall.arguments as any)?.result;
    const invalidResult = typeof result !== 'string' || !result.trim();
    const violatesRules = hasOtherTools || hasMultipleReturns || invalidResult;
    if (!violatesRules) return toolCall;

    changed = true;
    return {
      ...toolCall,
      status: 'failed' as const,
      failureType: 'validation' as const,
      reason: RETURN_RESULT_RULE_REASON,
      result: undefined,
      acceptedAt: undefined,
    };
  });

  return changed ? next : toolCalls;
}

function replaceLastAssistantToolCalls(invocationKey: string, toolCalls: ToolCallMetadata[]): boolean {
  const runtime = useSubAgentRuntimeStore.getState();
  const invocation = runtime.getInvocationByKey(invocationKey);
  if (!invocation) return false;

  const history = invocation.history.slice();
  const lastAssistantIndex = findLastAssistantMessageIndex(history);
  if (lastAssistantIndex < 0) return false;

  history[lastAssistantIndex] = {
    ...history[lastAssistantIndex],
    toolCalls,
  } as any;

  runtime.replaceHistory(invocationKey, history);
  return true;
}

function appendAssistantMessage(invocationKey: string, message: ChatMessage): boolean {
  const runtime = useSubAgentRuntimeStore.getState();
  const invocation = runtime.getInvocationByKey(invocationKey);
  if (!invocation) return false;

  runtime.replaceHistory(invocationKey, [...invocation.history, message]);
  return true;
}

async function updateAgentParentToolCall(params: {
  invocation: SubAgentInvocation;
  patch: (toolCall: ToolCallMetadata) => ToolCallMetadata;
}): Promise<void> {
  const { invocation, patch } = params;
  const agentStore = useAgentStore.getState();
  const agent = agentStore.getAgent(invocation.projectId, invocation.agentId);
  const message = agent?.messages.find((msg) => String(msg.id) === String(invocation.parentMessageId));
  if (!message || !Array.isArray(message.toolCalls)) return;

  let changed = false;
  const nextToolCalls = message.toolCalls.map((toolCall) => {
    if (toolCall.id !== invocation.parentToolCallId) return toolCall;
    changed = true;
    return patch(toolCall as ToolCallMetadata);
  });
  if (!changed) return;

  await agentStore.updateMessageToolCalls(
    invocation.projectId,
    invocation.agentId,
    String(invocation.parentMessageId),
    nextToolCalls as ToolCallMetadata[]
  );
}

function findInvocationKeyByPersistentId(parentPersistentId: string): string | undefined {
  const runtime = useSubAgentRuntimeStore.getState();
  for (const [key, invocation] of Object.entries(runtime.invocationsByKey)) {
    if (!invocation) continue;
    if (invocation.persistentId === parentPersistentId) return key;
  }
  return undefined;
}

function findHistoryMessageIndexById(history: ChatMessage[], messageId: string): number {
  for (let i = 0; i < history.length; i++) {
    if (String(history[i]?.id) === String(messageId)) return i;
  }
  return -1;
}

function findHistoryMessageIndexByToolCallId(history: ChatMessage[], toolCallId: string): number {
  for (let i = history.length - 1; i >= 0; i--) {
    const toolCalls = history[i]?.toolCalls ?? [];
    if (!Array.isArray(toolCalls)) continue;
    if (toolCalls.some((toolCall) => String((toolCall as any)?.id) === String(toolCallId))) {
      return i;
    }
  }
  return -1;
}

async function updateSubAgentParentToolCall(params: {
  invocation: SubAgentInvocation;
  patch: (toolCall: ToolCallMetadata) => ToolCallMetadata;
}): Promise<void> {
  const { invocation, patch } = params;
  const parentKey = findInvocationKeyByPersistentId(String(invocation.parentId));
  if (!parentKey) return;

  const runtime = useSubAgentRuntimeStore.getState();
  const parentInvocation = runtime.getInvocationByKey(parentKey);
  if (!parentInvocation) return;

  const nextHistory = parentInvocation.history.slice();
  let targetIndex = findHistoryMessageIndexById(nextHistory, String(invocation.parentMessageId));
  if (targetIndex < 0) {
    targetIndex = findHistoryMessageIndexByToolCallId(nextHistory, invocation.parentToolCallId);
  }
  if (targetIndex < 0) return;

  const targetMessage = nextHistory[targetIndex];
  const toolCalls = targetMessage.toolCalls ?? [];
  if (!Array.isArray(toolCalls)) return;

  let changed = false;
  const nextToolCalls = toolCalls.map((toolCall) => {
    if (String((toolCall as any)?.id) !== String(invocation.parentToolCallId)) return toolCall as ToolCallMetadata;
    changed = true;
    return patch(toolCall as ToolCallMetadata);
  });
  if (!changed) return;

  nextHistory[targetIndex] = {
    ...targetMessage,
    toolCalls: nextToolCalls as any,
  };
  runtime.replaceHistory(parentKey, nextHistory);
  await persistInvocationState(parentKey);
}

async function syncParentToolCall(params: {
  invocation: SubAgentInvocation;
  patch: (toolCall: ToolCallMetadata) => ToolCallMetadata;
}): Promise<void> {
  const { invocation, patch } = params;
  if (invocation.parentType === 'agent') {
    await updateAgentParentToolCall({ invocation, patch });
    return;
  }
  if (invocation.parentType === 'sub_agent') {
    await updateSubAgentParentToolCall({ invocation, patch });
  }
}

async function syncParentToolCallRunning(invocation: SubAgentInvocation): Promise<void> {
  await syncParentToolCall({
    invocation,
    patch: (toolCall) => ({
      ...toolCall,
      status: 'running',
      reason: undefined,
      failureType: undefined,
      result: undefined,
      acceptedAt: undefined,
    }),
  });
}

async function syncParentToolCallAccepted(invocation: SubAgentInvocation, output: string): Promise<void> {
  const result: ApplicationResult = {
    success: true,
    message: output,
    data: {
      subAgentId: invocation.subAgentId,
      agentName: invocation.agentName,
    },
  };

  await syncParentToolCall({
    invocation,
    patch: (toolCall) => ({
      ...toolCall,
      status: 'accepted',
      reason: undefined,
      failureType: undefined,
      result,
      acceptedAt: new Date(),
    }),
  });
}

async function syncParentToolCallFailed(invocation: SubAgentInvocation, reason: string): Promise<void> {
  const result: ApplicationResult = {
    success: false,
    message: `Error executing call_${invocation.agentName}`,
    error: reason,
    data: {
      subAgentId: invocation.subAgentId,
      agentName: invocation.agentName,
    },
  };

  await syncParentToolCall({
    invocation,
    patch: (toolCall) => ({
      ...toolCall,
      status: 'failed',
      reason,
      failureType: 'execution',
      result,
      acceptedAt: undefined,
    }),
  });
}

async function persistInvocationState(invocationKey: string): Promise<void> {
  const runtime = useSubAgentRuntimeStore.getState();
  const invocation = runtime.getInvocationByKey(invocationKey);
  if (!invocation) return;

  try {
    const response = await subAgentInvocationService.upsertState(invocation.projectId, invocation.agentId, {
      parent_type: invocation.parentType,
      parent_id: invocation.parentId,
      parent_message_id: invocation.parentMessageId,
      parent_tool_call_id: invocation.parentToolCallId,
      sub_agent_id: invocation.subAgentId,
      agent_name: invocation.agentName,
      display_name: invocation.displayName,
      caller: invocation.caller,
      language: invocation.language,
      input: invocation.input ?? '',
      status: invocation.status,
      final_output: invocation.finalOutput,
      error: invocation.error,
      history: invocation.history.map((message) => ({
        role: String(message.role),
        content_parts: (message.contentParts ?? []) as any,
        tool_calls: (message.toolCalls ?? undefined) as any,
        thinking_details: (message.thinking_details ?? undefined) as any,
        created_at: message.timestamp ? new Date(message.timestamp).toISOString() : undefined,
      })),
    });

    const persisted = response?.invocation;
    const persistedId = persisted?.id;
    if (!persistedId) return;

    const store = useSubAgentRuntimeStore.getState();
    const current = store.getInvocationByKey(invocationKey);
    if (!current) return;

    if (current.persistentId !== persistedId) {
      store.updateInvocation(invocationKey, {
        persistentId: persistedId,
      });
    }

    const persistedHistory = mapPersistedMessagesToHistory(persisted.messages ?? []);
    const currentIds = current.history.map((m) => String(m.id)).join(',');
    const persistedIds = persistedHistory.map((m) => String(m.id)).join(',');
    if (currentIds !== persistedIds) {
      store.replaceHistory(invocationKey, persistedHistory);
    }
  } catch (error) {
    console.error('[SubAgentManager] Failed to persist state:', error);
  }
}

async function runTurn(invocationKey: string): Promise<void> {
  const runtime = useSubAgentRuntimeStore.getState();
  const invocation = runtime.getInvocationByKey(invocationKey);
  if (!invocation) return;
  if (invocation.status === 'completed' || invocation.status === 'cancelled') return;

  if (!invocation.llmConfig || !invocation.tools) {
    runtime.updateInvocation(invocationKey, {
      status: 'error',
      error: 'Missing runtime configuration for Sub Agent invocation',
      activeSessionId: null,
    });
    await persistInvocationState(invocationKey);
    await syncParentToolCallRunning(invocation);
    return;
  }

  const settingsStore = useSettingsStore.getState();
  const credentialsStore = useCredentialsStore.getState();
  clearControlIntent(invocationKey);

  runtime.updateInvocation(invocationKey, {
    status: 'running',
    error: undefined,
    finalOutput: undefined,
  });
  await syncParentToolCallRunning(invocation);

  const provider = invocation.llmConfig.provider;
  const providerConfig = credentialsStore.getProviderConfigForBackend(provider);

  // Frozen project data snapshot for auto-continue context drift prevention
  const lastMsg = invocation.history[invocation.history.length - 1];
  const isUserTurn = lastMsg?.role === 'user';

  let frozenProjectData = !isUserTurn ? invocation.frozenProjectData : undefined;
  if (!frozenProjectData) {
    frozenProjectData = PromptManager.buildProjectData(invocation.projectId, invocation.language);
    runtime.updateInvocation(invocationKey, { frozenProjectData });
  }

  const promptContext = {
    projectId: invocation.projectId,
    outputLanguage: invocation.language,
    outputMode: 'tool_call' as const,
    enable_prefill: invocation.llmConfig.advanced.enable_prefill,
    thinking_mode: invocation.llmConfig.advanced.thinking_mode,
    tools: invocation.tools,
    agentName: invocation.agentName,
    frozenProjectData,
  };

  const handle = startLLMSession<any, any>({
    kind: 'subAgent',
    label: `Sub Agent: ${invocation.displayName}`,
    input: {
      subAgentId: invocation.subAgentId,
      parentType: invocation.parentType,
      parentId: invocation.parentId,
      parentMessageId: invocation.parentMessageId,
      parentToolCallId: invocation.parentToolCallId,
    },
    mode: LLMTaskMode.SUB_AGENT,
    projectId: invocation.projectId,
    promptContext: promptContext as any,
    provider,
    providerConfig,
    model: invocation.llmConfig.model,
    temperature: invocation.llmConfig.temperature,
    thinking_mode: invocation.llmConfig.advanced.thinking_mode as any,
    thinking_config: invocation.llmConfig.advanced.thinking_config,
    retryConfig: settingsStore.getSettings().retryConfig,
    history: invocation.history,
  });

  runtime.updateInvocation(invocationKey, { activeSessionId: handle.sessionId });

  try {
    const finalSession = await handle.done;
    const sessionStore = useLLMSessionStore.getState();
    const latest = sessionStore.getSessionById(handle.sessionId) ?? finalSession;

    if (latest.status !== 'success') {
      const intent = consumeControlIntent(invocationKey);

      if (latest.status === 'cancelled') {
        if (intent === 'pause') {
          runtime.updateInvocation(invocationKey, {
            status: 'paused',
            activeSessionId: null,
          });
          await persistInvocationState(invocationKey);
          await syncParentToolCallRunning(invocation);
          return;
        }

        if (intent === 'cancel') {
          return;
        }

        runtime.updateInvocation(invocationKey, {
          status: 'error',
          error: latest.error || 'Sub Agent session was cancelled unexpectedly.',
          activeSessionId: null,
        });
        await persistInvocationState(invocationKey);
        await syncParentToolCallRunning(invocation);
        return;
      }

      runtime.updateInvocation(invocationKey, {
        status: 'error',
        error: latest.error || 'Sub Agent session failed',
        activeSessionId: null,
      });
      await persistInvocationState(invocationKey);
      await syncParentToolCallRunning(invocation);
      return;
    }

    const assistantMessage: ChatMessage = {
      id: generateTempId(),
      role: 'assistant',
      contentParts: latest.contentParts,
      timestamp: new Date(),
      toolCalls: latest.toolCalls ?? [],
      thinking_details: latest.thinkingDetails,
    } as any;

    if (!appendAssistantMessage(invocationKey, assistantMessage)) {
      runtime.updateInvocation(invocationKey, {
        status: 'error',
        error: 'Failed to append assistant message to history',
        activeSessionId: null,
      });
      await persistInvocationState(invocationKey);
      await syncParentToolCallRunning(invocation);
      return;
    }

    if (!latest.toolCalls || latest.toolCalls.length === 0) {
      const output = contentText(latest.contentParts);
      runtime.updateInvocation(invocationKey, {
        status: 'completed',
        finalOutput: output,
        activeSessionId: null,
      });
      await persistInvocationState(invocationKey);
      await syncParentToolCallAccepted(invocation, output);
      const completion = completions.get(invocationKey);
      completion?.resolve(output);
      completions.delete(invocationKey);
      return;
    }

    const allowedToolNames = (invocation.tools ?? [])
      .map((tool) => tool.name)
      .filter((name): name is string => Boolean(name && name.trim()));

    const staged = await stageToolCalls({
      projectId: invocation.projectId,
      language: invocation.language,
      toolCalls: latest.toolCalls,
      allowedToolNames: allowedToolNames.length > 0 ? allowedToolNames : undefined,
    });

    const adjustedToolCalls = applyReturnResultBatchRules(staged.toolCalls);
    if (!replaceLastAssistantToolCalls(invocationKey, adjustedToolCalls)) {
      runtime.updateInvocation(invocationKey, {
        status: 'error',
        error: 'Failed to update tool calls in history',
        activeSessionId: null,
      });
      await persistInvocationState(invocationKey);
      await syncParentToolCallRunning(invocation);
      return;
    }

    const autoContinue = evaluateToolCallAutoContinue(adjustedToolCalls);
    if (autoContinue.hasPending) {
      runtime.updateInvocation(invocationKey, {
        status: 'waiting',
        activeSessionId: null,
      });
      await persistInvocationState(invocationKey);
      await syncParentToolCallRunning(invocation);
      return;
    }

    if (autoContinue.shouldAutoContinue) {
      runtime.updateInvocation(invocationKey, {
        status: 'running',
        activeSessionId: null,
      });
      await persistInvocationState(invocationKey);
      await runTurn(invocationKey);
      return;
    }

    runtime.updateInvocation(invocationKey, {
      status: 'paused',
      activeSessionId: null,
    });
    await persistInvocationState(invocationKey);
    await syncParentToolCallRunning(invocation);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Sub Agent turn failed unexpectedly';
    console.error('[SubAgentManager] runTurn error:', error);

    runtime.updateInvocation(invocationKey, {
      status: 'error',
      error: errorMessage,
      activeSessionId: null,
    });
    await persistInvocationState(invocationKey);
    await syncParentToolCallRunning(invocation);
  }
}

export const SubAgentManager = {
  async reconcileParentToolCall(invocationKey: string): Promise<void> {
    const runtime = useSubAgentRuntimeStore.getState();
    const invocation = runtime.getInvocationByKey(invocationKey);
    if (!invocation) return;

    if (invocation.status === 'completed') {
      await syncParentToolCallAccepted(invocation, invocation.finalOutput ?? '');
      return;
    }

    if (invocation.status === 'cancelled') {
      await syncParentToolCallFailed(invocation, 'Cancelled');
      return;
    }

    await syncParentToolCallRunning(invocation);
  },

  /**
   * Start a Sub Agent invocation and return a promise that resolves with the final output.
   * The invocation UI is rendered under the parent tool call card.
   */
  async invoke(params: InvocationConfig): Promise<string> {
    const {
      projectId,
      agentId,
      language,
      parentType,
      parentId,
      parentMessageId,
      parentToolCallId,
      caller,
      subAgentId,
      input,
      handlerOptions,
    } = params;

    const definition = await loadDefinitionOrThrow(subAgentId);
    if (!definition.enabled) {
      throw new Error(`Sub Agent is disabled: ${subAgentId}`);
    }
    if (!definition.allowed_invocation_modes.includes(caller)) {
      throw new Error(`Sub Agent not allowed from caller: ${caller}`);
    }

    const tools = await buildToolSchemas(definition);
    const settingsStore = useSettingsStore.getState();
    const globalConfig = settingsStore.getTaskConfig('subAgent');
    const llmConfig: TaskAIConfig = definition.use_custom_llm_config ? definition.llm_config_override! : globalConfig;

    const invocationKey = buildSubAgentInvocationKey({
      parentType,
      parentId,
      parentMessageId,
      parentToolCallId,
    });

    const runtime = useSubAgentRuntimeStore.getState();
    const existing = runtime.getInvocationByKey(invocationKey);
    if (!existing) {
      const userMessageText = stringifyInputForUserMessage(input);
      const initialHistory: ChatMessage[] = [
        {
          id: generateTempId(),
          role: 'user',
          contentParts: [{ type: 'content', text: userMessageText }],
          timestamp: new Date(),
        },
      ];

      runtime.upsertInvocation({
        id: generateTempId(),
        persistentId: undefined,
        parentType,
        parentId,
        parentMessageId,
        parentToolCallId,
        projectId,
        agentId,
        language,
        caller,
        agentName: definition.agent_name,
        subAgentId: definition.id,
        displayName: definition.display_name,
        input,
        llmConfig,
        tools,
        handlerOptions,
        status: 'running',
        history: initialHistory,
        activeSessionId: null,
      });
      await persistInvocationState(invocationKey);
    } else if (existing.status === 'completed' && typeof existing.finalOutput === 'string') {
      return existing.finalOutput;
    } else if (existing.status === 'cancelled') {
      throw new Error('Cancelled');
    }

    await ensureInvocationRuntimeConfig(invocationKey);
    const done = ensureCompletion(invocationKey);

    void runTurn(invocationKey);

    return done;
  },

  /**
   * Apply tool calls from invocation.history, then optionally auto-continue the Sub Agent.
   */
  async applyAndContinue(params: {
    invocationKey: string;
    decisions: ToolCallDecisionMap;
    autoContinue: boolean;
  }): Promise<void> {
    const { invocationKey, decisions, autoContinue } = params;

    await persistInvocationState(invocationKey);

    await ensureInvocationRuntimeConfig(invocationKey);
    const runtime = useSubAgentRuntimeStore.getState();
    const invocation = runtime.getInvocationByKey(invocationKey);
    if (!invocation) return;

    const lastAssistantIndex = findLastAssistantMessageIndex(invocation.history);
    if (lastAssistantIndex < 0) return;

    const assistantMessage = invocation.history[lastAssistantIndex];
    const currentToolCalls = assistantMessage.toolCalls ?? [];
    if (!currentToolCalls.length) {
      if (!autoContinue) {
        runtime.updateInvocation(invocationKey, { status: 'paused', activeSessionId: null });
        await persistInvocationState(invocationKey);
        await syncParentToolCallRunning(invocation);
        return;
      }
      await runTurn(invocationKey);
      return;
    }

    const parentSubMessageId = findLastAssistantMessageId(invocation.history);
    const parentSubInvocationId = invocation.persistentId;

    const runningToolCalls = markToolCallsRunning({
      toolCalls: currentToolCalls,
      decisions,
    });

    replaceLastAssistantToolCalls(invocationKey, runningToolCalls);

    const applied = await applyToolCalls({
      projectId: invocation.projectId,
      language: invocation.language,
      toolCalls: runningToolCalls,
      decisions,
      options: {
        ...(invocation.handlerOptions ?? {}),
        userRequest: invocation.handlerOptions?.userRequest ?? 'SubAgent',
        agentId: invocation.agentId,
        parentAgentMessageId: undefined,
        parentSubInvocationId,
        parentSubMessageId: parentSubMessageId ?? undefined,
      },
      invocationCaller: 'subAgent',
    });

    replaceLastAssistantToolCalls(invocationKey, applied.toolCalls);
    await persistInvocationState(invocationKey);

    const autoContinueState = evaluateToolCallAutoContinue(applied.toolCalls);
    if (autoContinueState.hasPending) {
      runtime.updateInvocation(invocationKey, {
        status: 'waiting',
        activeSessionId: null,
      });
      await persistInvocationState(invocationKey);
      await syncParentToolCallRunning(invocation);
      return;
    }

    const acceptedReturn = applied.toolCalls.find(
      (toolCall) => toolCall.tool_name === RETURN_RESULT_TOOL_NAME && toolCall.status === 'accepted'
    );

    if (acceptedReturn) {
      const output = acceptedReturn.result?.message ?? '';
      runtime.updateInvocation(invocationKey, {
        status: 'completed',
        finalOutput: output,
        error: undefined,
        activeSessionId: null,
      });
      await persistInvocationState(invocationKey);
      await syncParentToolCallAccepted(invocation, output);
      const completion = completions.get(invocationKey);
      completion?.resolve(output);
      completions.delete(invocationKey);
      return;
    }

    if (!autoContinue || !autoContinueState.shouldAutoContinue) {
      runtime.updateInvocation(invocationKey, {
        status: 'paused',
        activeSessionId: null,
      });
      await persistInvocationState(invocationKey);
      await syncParentToolCallRunning(invocation);
      return;
    }

    await runTurn(invocationKey);
  },

  async pause(invocationKey: string): Promise<void> {
    const runtime = useSubAgentRuntimeStore.getState();
    const invocation = runtime.getInvocationByKey(invocationKey);
    if (!invocation) return;
    if (invocation.status !== 'running' && invocation.status !== 'waiting') return;

    const sessionId = invocation.activeSessionId;
    if (sessionId) {
      setControlIntent(invocationKey, 'pause');
      useLLMSessionStore.getState().cancelSession(sessionId);
    } else {
      clearControlIntent(invocationKey);
    }

    runtime.updateInvocation(invocationKey, {
      status: 'paused',
      activeSessionId: null,
    });
    await persistInvocationState(invocationKey);
    await syncParentToolCallRunning(invocation);
  },

  async retry(invocationKey: string): Promise<void> {
    const runtime = useSubAgentRuntimeStore.getState();
    const invocation = runtime.getInvocationByKey(invocationKey);
    if (!invocation) return;
    if (invocation.status !== 'paused' && invocation.status !== 'error') return;

    await ensureInvocationRuntimeConfig(invocationKey);
    const latest = runtime.getInvocationByKey(invocationKey);
    if (!latest) return;

    clearControlIntent(invocationKey);
    runtime.updateInvocation(invocationKey, {
      status: 'running',
      error: undefined,
      activeSessionId: null,
    });
    await persistInvocationState(invocationKey);
    await syncParentToolCallRunning(latest);
    await runTurn(invocationKey);
  },

  async cancel(invocationKey: string): Promise<void> {
    const runtime = useSubAgentRuntimeStore.getState();
    const invocation = runtime.getInvocationByKey(invocationKey);
    if (!invocation) return;
    if (invocation.status === 'completed' || invocation.status === 'cancelled') return;

    const sessionId = invocation.activeSessionId;
    if (sessionId) {
      setControlIntent(invocationKey, 'cancel');
      useLLMSessionStore.getState().cancelSession(sessionId);
    } else {
      clearControlIntent(invocationKey);
    }

    runtime.updateInvocation(invocationKey, {
      status: 'cancelled',
      error: 'Cancelled',
      activeSessionId: null,
    });
    await persistInvocationState(invocationKey);
    await syncParentToolCallFailed(invocation, 'Cancelled');

    const completion = completions.get(invocationKey);
    completion?.reject(new Error('Cancelled'));
    completions.delete(invocationKey);
  },
};
