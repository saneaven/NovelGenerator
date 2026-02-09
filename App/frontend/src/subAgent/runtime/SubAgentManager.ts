import { startLLMSession } from '../../llmSession';
import { useCredentialsStore } from '../../store/credentialsStore';
import { useLLMSessionStore } from '../../store/llmSessionStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useSubAgentStore } from '../../store/subAgentStore';
import {
  buildSubAgentInvocationKey,
  type SubAgentParentType,
  useSubAgentRuntimeStore,
} from '../../store/subAgentRuntimeStore';
import { schemaRegistry } from '../../toolCall/schemas/schemaRegistry';
import { LLMTaskMode } from '../../llm/types';
import type { ChatMessage } from '../../llm/requestTypes';
import type { ToolCallSchema } from '../../toolCall';
import type { TaskAIConfig } from '../../store/settingsStore';
import { stageSessionEdits, applySessionEdits, toToolCallMetadata } from '../../llmTask/toolCalls/toolCallEngine';
import type { HandlerOptions } from '../../toolCall/apply/types';
import { generateTempId } from '../../utils/tempId';
import type { SubAgentDefinition } from '../../types/subAgents';
import type { StoredEditCard } from '../../llmTask/uiTypes';
import { buildCallToolSchema } from '../tools/SubAgentCallTools';
import type { InvocationCaller } from '../../types/agentRuntime';
import { subAgentInvocationService } from '../../api/subAgentInvocationService';

type Completion = { resolve: (output: string) => void; reject: (error: Error) => void };

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
const RETURN_RESULT_TOOL_NAME = 'return_sub_agent_result';
const RETURN_RESULT_RULE_REASON =
  'return_sub_agent_result must be called exactly once and must be the ONLY tool call in the final message of the Sub Agent invocation. ' +
  'Do other tool calls first. When finished, call return_sub_agent_result alone with a non-empty string field "result".';

function stringifyInputForUserMessage(input: string): string {
  return (input ?? '').trim();
}

function contentText(parts: Array<{ type: string; text: string }>): string {
  return parts
    .filter((p) => p.type === 'content')
    .map((p) => p.text)
    .join('')
    .trim();
}

function findLastAssistantMessageId(history: ChatMessage[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role === 'assistant') return String(history[i].id);
  }
  return null;
}

function mapPersistedMessagesToHistory(messages: Array<any>): ChatMessage[] {
  return [...messages]
    .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
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
      const prevResolve = existing.resolve;
      const prevReject = existing.reject;
      completions.set(invocationKey, {
        resolve: (output) => {
          prevResolve(output);
          resolve(output);
        },
        reject: (err) => {
          prevReject(err);
          reject(err);
        },
      });
    });
  }

  return new Promise<string>((resolve, reject) => {
    completions.set(invocationKey, { resolve, reject });
  });
}

async function loadDefinitionOrThrow(subAgentId: string) {
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

  // Static tools (no call_*).
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

  // Dynamic Sub Agent call tools.
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
    if (!target.enabled) {
      continue;
    }
    schemas.push(buildCallToolSchema(target));
  }

  // Always include return_sub_agent_result.
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

function applyReturnResultBatchRules(cards: StoredEditCard[]): StoredEditCard[] {
  const returnCards = cards.filter((c) => c.toolCall.toolName === RETURN_RESULT_TOOL_NAME);
  if (returnCards.length === 0) return cards;

  const hasOtherTools = cards.some((c) => c.toolCall.toolName !== RETURN_RESULT_TOOL_NAME);
  const hasMultipleReturns = returnCards.length > 1;

  let changed = false;
  const next = cards.map((card) => {
    if (card.toolCall.toolName !== RETURN_RESULT_TOOL_NAME) return card;

    const result = (card.toolCall.arguments as any)?.result;
    const invalidResult = typeof result !== 'string' || !result.trim();
    const violatesRules = hasOtherTools || hasMultipleReturns || invalidResult;
    if (!violatesRules) return card;

    changed = true;
    return {
      ...card,
      toolCall: {
        ...card.toolCall,
        status: 'failed' as const,
        failureType: 'validation' as const,
        reason: RETURN_RESULT_RULE_REASON,
        result: undefined,
        acceptedAt: undefined,
      },
    };
  });

  return changed ? next : cards;
}

async function persistInvocationSnapshot(invocationKey: string): Promise<void> {
  const runtime = useSubAgentRuntimeStore.getState();
  const invocation = runtime.getInvocationByKey(invocationKey);
  if (!invocation) return;

  try {
    const response = await subAgentInvocationService.upsertSnapshot(invocation.projectId, invocation.agentId, {
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

    store.replaceHistory(invocationKey, mapPersistedMessagesToHistory(persisted.messages ?? []));
  } catch (error) {
    console.error('[SubAgentManager] Failed to persist snapshot:', error);
  }
}

async function runTurn(invocationKey: string): Promise<void> {
  const runtime = useSubAgentRuntimeStore.getState();
  const invocation = runtime.getInvocationByKey(invocationKey);
  if (!invocation) return;
  if (invocation.status === 'completed' || invocation.status === 'error' || invocation.status === 'cancelled') return;

  if (!invocation.llmConfig || !invocation.tools) {
    runtime.updateInvocation(invocationKey, {
      status: 'error',
      error: 'Missing runtime configuration for Sub Agent invocation',
    });
    await persistInvocationSnapshot(invocationKey);
    const completion = completions.get(invocationKey);
    completion?.reject(new Error('Missing runtime configuration for Sub Agent invocation'));
    completions.delete(invocationKey);
    return;
  }

  const settingsStore = useSettingsStore.getState();
  const credentialsStore = useCredentialsStore.getState();

  runtime.updateInvocation(invocationKey, {
    status: 'running',
    error: undefined,
    finalOutput: undefined,
  });

  const provider = invocation.llmConfig.provider;
  const providerConfig = credentialsStore.getProviderConfigForBackend(provider);

  const promptContext = {
    projectId: invocation.projectId,
    outputLanguage: invocation.language,
    outputMode: 'tool_call' as const,
    enablePrefill: invocation.llmConfig.advanced.enablePrefill,
    thinkingMode: invocation.llmConfig.advanced.thinkingMode,
    tools: invocation.tools,
    agentName: invocation.agentName,
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
    thinkingMode: invocation.llmConfig.advanced.thinkingMode as any,
    thinkingConfig: invocation.llmConfig.advanced.thinkingConfig,
    retryConfig: settingsStore.getSettings().retryConfig,
    history: invocation.history,
  });

  runtime.updateInvocation(invocationKey, { activeSessionId: handle.sessionId });

  const finalSession = await handle.done;
  const sessionStore = useLLMSessionStore.getState();
  const latest = sessionStore.getSessionById(handle.sessionId) ?? finalSession;

  if (latest.status !== 'success') {
    const errorMessage = latest.error || 'Sub Agent session failed';
    runtime.updateInvocation(invocationKey, {
      status: latest.status === 'cancelled' ? 'cancelled' : 'error',
      error: errorMessage,
      activeSessionId: null,
    });
    await persistInvocationSnapshot(invocationKey);
    const completion = completions.get(invocationKey);
    completion?.reject(new Error(errorMessage));
    completions.delete(invocationKey);
    return;
  }

  // Append assistant message to history
  const assistantMessage: ChatMessage = {
    id: generateTempId(),
    role: 'assistant',
    contentParts: latest.contentParts,
    timestamp: new Date(),
    toolCalls: latest.toolCalls ?? [],
    thinking_details: latest.thinkingDetails,
  } as any;

  const nextHistory = [...invocation.history, assistantMessage];
  runtime.replaceHistory(invocationKey, nextHistory);

  if (!latest.toolCalls || latest.toolCalls.length === 0) {
    const output = contentText(latest.contentParts);
    runtime.updateInvocation(invocationKey, {
      status: 'completed',
      finalOutput: output,
      activeSessionId: null,
    });
    await persistInvocationSnapshot(invocationKey);
    const completion = completions.get(invocationKey);
    completion?.resolve(output);
    completions.delete(invocationKey);
    return;
  }

  // Validate tool calls and store edit cards in llmSessionStore
  await stageSessionEdits({
    sessionId: handle.sessionId,
    projectId: invocation.projectId,
    language: invocation.language,
    toolCalls: latest.toolCalls,
  });

  const staged = sessionStore.getSessionById(handle.sessionId);
  if (!staged?.editCards || staged.editCards.length === 0) {
    const errorMessage = staged?.error || 'Failed to stage tool calls';
    runtime.updateInvocation(invocationKey, {
      status: 'error',
      error: errorMessage,
      activeSessionId: null,
    });
    await persistInvocationSnapshot(invocationKey);
    const completion = completions.get(invocationKey);
    completion?.reject(new Error(errorMessage));
    completions.delete(invocationKey);
    return;
  }

  // Sub Agent batch rules (non-fatal validation): mark invalid return_sub_agent_result as failed so the reason is sent via tool_results.
  const adjustedCards = applyReturnResultBatchRules(staged.editCards as StoredEditCard[]);
  if (adjustedCards !== staged.editCards) {
    sessionStore.updateSession(handle.sessionId, { editCards: adjustedCards } as any);
  }

  // Sync validated statuses into invocation history
  const updatedToolCalls = toToolCallMetadata(adjustedCards);
  const updatedAssistant: ChatMessage = {
    ...assistantMessage,
    toolCalls: updatedToolCalls,
  } as any;
  runtime.replaceHistory(invocationKey, [...invocation.history, updatedAssistant]);

  runtime.updateInvocation(invocationKey, {
    status: 'awaiting_confirmation',
  });
  await persistInvocationSnapshot(invocationKey);
}

export const SubAgentManager = {
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
      await persistInvocationSnapshot(invocationKey);
    } else if (existing.status === 'completed' && typeof existing.finalOutput === 'string') {
      return existing.finalOutput;
    }

    const done = ensureCompletion(invocationKey);

    // Start the first turn immediately.
    void runTurn(invocationKey);

    return done;
  },

  /**
   * Apply tool calls for the active session, then optionally auto-continue the Sub Agent.
   */
  async applyAndContinue(params: {
    invocationKey: string;
    selections: Record<string, boolean>;
    autoContinue: boolean;
  }): Promise<void> {
    const { invocationKey, selections, autoContinue } = params;
    const runtime = useSubAgentRuntimeStore.getState();
    const initial = runtime.getInvocationByKey(invocationKey);
    if (!initial?.activeSessionId) return;

    // Ensure nested parent references use persisted IDs from backend.
    await persistInvocationSnapshot(invocationKey);

    const invocation = useSubAgentRuntimeStore.getState().getInvocationByKey(invocationKey);
    if (!invocation?.activeSessionId) return;

    const parentSubMessageId = findLastAssistantMessageId(invocation.history);
    const parentSubInvocationId = invocation.persistentId;

    await applySessionEdits({
      sessionId: invocation.activeSessionId,
      projectId: invocation.projectId,
      language: invocation.language,
      selections,
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

    // Sync applied statuses back into invocation history
    const session = useLLMSessionStore.getState().getSessionById(invocation.activeSessionId);
    const cards = session?.editCards;
    if (cards) {
      const updatedToolCalls = toToolCallMetadata(cards);
      const history = invocation.history.slice();
      const lastIdx = history.map((m) => m.role).lastIndexOf('assistant');
      if (lastIdx >= 0) {
        history[lastIdx] = { ...history[lastIdx], toolCalls: updatedToolCalls } as any;
        runtime.replaceHistory(invocationKey, history);
      }
    }
    await persistInvocationSnapshot(invocationKey);

    // If Sub Agent returned a final result, complete immediately (do not continue to next turn).
    const acceptedReturn = cards?.find(
      (c) => c.toolCall.toolName === RETURN_RESULT_TOOL_NAME && c.toolCall.status === 'accepted'
    );
    if (acceptedReturn) {
      const output = acceptedReturn.toolCall.result?.message ?? '';
      runtime.updateInvocation(invocationKey, {
        status: 'completed',
        finalOutput: output,
        error: undefined,
        activeSessionId: null,
      });
      await persistInvocationSnapshot(invocationKey);
      const completion = completions.get(invocationKey);
      completion?.resolve(output);
      completions.delete(invocationKey);
      return;
    }

    if (!autoContinue) {
      runtime.updateInvocation(invocationKey, { status: 'paused' });
      await persistInvocationSnapshot(invocationKey);
      return;
    }

    await runTurn(invocationKey);
  },

  async resume(invocationKey: string): Promise<void> {
    const runtime = useSubAgentRuntimeStore.getState();
    const invocation = runtime.getInvocationByKey(invocationKey);
    if (!invocation) return;
    if (invocation.status !== 'paused') return;
    await runTurn(invocationKey);
  },

  async cancel(invocationKey: string): Promise<void> {
    const runtime = useSubAgentRuntimeStore.getState();
    const invocation = runtime.getInvocationByKey(invocationKey);
    if (!invocation) return;

    const sessionId = invocation.activeSessionId;
    if (sessionId) {
      useLLMSessionStore.getState().cancelSession(sessionId);
    }

    runtime.updateInvocation(invocationKey, {
      status: 'cancelled',
      error: 'Cancelled',
      activeSessionId: null,
    });
    await persistInvocationSnapshot(invocationKey);

    const completion = completions.get(invocationKey);
    completion?.reject(new Error('Cancelled'));
    completions.delete(invocationKey);
  },
};
