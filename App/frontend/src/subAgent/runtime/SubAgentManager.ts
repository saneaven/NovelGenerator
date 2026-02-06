import { startLLMSession } from '../../llmSession';
import { useCredentialsStore } from '../../store/credentialsStore';
import { useLLMSessionStore } from '../../store/llmSessionStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useSubAgentStore } from '../../store/subAgentStore';
import { useSubAgentRuntimeStore } from '../../store/subAgentRuntimeStore';
import { schemaRegistry } from '../../toolCall/schemas/schemaRegistry';
import { LLMTaskMode } from '../../llm/types';
import type { ChatMessage } from '../../llm/requestTypes';
import type { ToolCallSchema } from '../../toolCall';
import type { TaskAIConfig } from '../../store/settingsStore';
import { stageSessionEdits, applySessionEdits, toToolCallMetadata } from '../../llmTask/toolCalls/toolCallEngine';
import type { HandlerOptions } from '../../toolCall/apply/types';
import { generateTempId } from '../../utils/tempId';
import type { SubAgentAllowedMode, SubAgentDefinition } from '../../types/subAgents';
import type { StoredEditCard } from '../../llmTask/uiTypes';
import { buildCallToolSchema } from '../tools/SubAgentCallTools';

type Completion = { resolve: (output: string) => void; reject: (error: Error) => void };

type InvocationConfig = {
  projectId: string;
  language: string;
  parentToolCallId: string;
  callerMode: SubAgentAllowedMode;
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

function ensureCompletion(parentToolCallId: string): Promise<string> {
  if (completions.has(parentToolCallId)) {
    return new Promise((resolve, reject) => {
      const existing = completions.get(parentToolCallId)!;
      const prevResolve = existing.resolve;
      const prevReject = existing.reject;
      completions.set(parentToolCallId, {
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
    completions.set(parentToolCallId, { resolve, reject });
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
        status: 'failed',
        failureType: 'validation',
        reason: RETURN_RESULT_RULE_REASON,
        result: undefined,
        acceptedAt: undefined,
      },
    };
  });

  return changed ? next : cards;
}

async function runTurn(parentToolCallId: string): Promise<void> {
  const runtime = useSubAgentRuntimeStore.getState();
  const invocation = runtime.getInvocation(parentToolCallId);
  if (!invocation) return;
  if (invocation.status === 'completed' || invocation.status === 'error' || invocation.status === 'cancelled') return;

  const settingsStore = useSettingsStore.getState();
  const credentialsStore = useCredentialsStore.getState();

  runtime.updateInvocation(parentToolCallId, {
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
    input: { subAgentId: invocation.subAgentId, parentToolCallId },
    mode: LLMTaskMode.SUB_AGENT,
    projectId: invocation.projectId,
    promptContext: promptContext as any,
    provider,
    providerConfig,
    model: invocation.llmConfig.model,
    temperature: invocation.llmConfig.temperature,
    thinkingMode: invocation.llmConfig.advanced.thinkingMode as any,
    thinkingConfig: invocation.llmConfig.advanced.thinkingConfig,
    retryConfig: settingsStore.getSettingsOrThrow().retryConfig,
    history: invocation.history,
  });

  runtime.updateInvocation(parentToolCallId, { activeSessionId: handle.sessionId });

  const finalSession = await handle.done;
  const sessionStore = useLLMSessionStore.getState();
  const latest = sessionStore.getSessionById(handle.sessionId) ?? finalSession;

  if (latest.status !== 'success') {
    const errorMessage = latest.error || 'Sub Agent session failed';
    runtime.updateInvocation(parentToolCallId, { status: latest.status === 'cancelled' ? 'cancelled' : 'error', error: errorMessage });
    const completion = completions.get(parentToolCallId);
    completion?.reject(new Error(errorMessage));
    completions.delete(parentToolCallId);
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
  runtime.replaceHistory(parentToolCallId, nextHistory);

  if (!latest.toolCalls || latest.toolCalls.length === 0) {
    const output = contentText(latest.contentParts);
    runtime.updateInvocation(parentToolCallId, {
      status: 'completed',
      finalOutput: output,
    });
    const completion = completions.get(parentToolCallId);
    completion?.resolve(output);
    completions.delete(parentToolCallId);
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
    runtime.updateInvocation(parentToolCallId, { status: 'error', error: errorMessage });
    const completion = completions.get(parentToolCallId);
    completion?.reject(new Error(errorMessage));
    completions.delete(parentToolCallId);
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
  runtime.replaceHistory(parentToolCallId, [...invocation.history, updatedAssistant]);

  runtime.updateInvocation(parentToolCallId, {
    status: 'awaiting_confirmation',
  });
}

export const SubAgentManager = {
  /**
   * Start a Sub Agent invocation and return a promise that resolves with the final output.
   * The invocation UI is rendered under the parent tool call card (parentToolCallId).
   */
  async invoke(params: InvocationConfig): Promise<string> {
    const { projectId, language, parentToolCallId, callerMode, subAgentId, input, handlerOptions } = params;

    const definition = await loadDefinitionOrThrow(subAgentId);
    if (!definition.enabled) {
      throw new Error(`Sub Agent is disabled: ${subAgentId}`);
    }
    if (!definition.allowed_agent_modes.includes(callerMode)) {
      throw new Error(`Sub Agent not allowed from mode: ${callerMode}`);
    }

    const tools = await buildToolSchemas(definition);
    const llmConfig = definition.llm_config as TaskAIConfig;

    const runtime = useSubAgentRuntimeStore.getState();
    const existing = runtime.getInvocation(parentToolCallId);
    if (!existing) {
      const userMessageText = stringifyInputForUserMessage(input);
      const initialHistory: ChatMessage[] = [{
        id: generateTempId(),
        role: 'user',
        contentParts: [{ type: 'content', text: userMessageText }],
        timestamp: new Date(),
      }];

      runtime.upsertInvocation({
        id: parentToolCallId,
        parentToolCallId,
        projectId,
        language,
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
    }

    const done = ensureCompletion(parentToolCallId);

    // Start the first turn immediately
    void runTurn(parentToolCallId);

    return done;
  },

  /**
   * Apply tool calls for the active session, then optionally auto-continue the Sub Agent.
   */
  async applyAndContinue(params: {
    parentToolCallId: string;
    selections: Record<string, boolean>;
    autoContinue: boolean;
  }): Promise<void> {
    const { parentToolCallId, selections, autoContinue } = params;
    const runtime = useSubAgentRuntimeStore.getState();
    const invocation = runtime.getInvocation(parentToolCallId);
    if (!invocation?.activeSessionId) return;

    await applySessionEdits({
      sessionId: invocation.activeSessionId,
      projectId: invocation.projectId,
      language: invocation.language,
      selections,
      options: { ...invocation.handlerOptions, userRequest: invocation.handlerOptions.userRequest ?? 'SubAgent' },
      executionMode: 'subAgent',
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
        runtime.replaceHistory(parentToolCallId, history);
      }
    }

    // If Sub Agent returned a final result, complete immediately (do not continue to next turn).
    const acceptedReturn = cards?.find(
      (c) => c.toolCall.toolName === RETURN_RESULT_TOOL_NAME && c.toolCall.status === 'accepted'
    );
    if (acceptedReturn) {
      const output = acceptedReturn.toolCall.result?.message ?? '';
      runtime.updateInvocation(parentToolCallId, {
        status: 'completed',
        finalOutput: output,
        error: undefined,
      });
      const completion = completions.get(parentToolCallId);
      completion?.resolve(output);
      completions.delete(parentToolCallId);
      return;
    }

    if (!autoContinue) {
      runtime.updateInvocation(parentToolCallId, { status: 'paused' });
      return;
    }

    await runTurn(parentToolCallId);
  },

  async resume(parentToolCallId: string): Promise<void> {
    const runtime = useSubAgentRuntimeStore.getState();
    const invocation = runtime.getInvocation(parentToolCallId);
    if (!invocation) return;
    if (invocation.status !== 'paused') return;
    await runTurn(parentToolCallId);
  },

  cancel(parentToolCallId: string): void {
    const runtime = useSubAgentRuntimeStore.getState();
    const invocation = runtime.getInvocation(parentToolCallId);
    if (!invocation) return;

    const sessionId = invocation.activeSessionId;
    if (sessionId) {
      useLLMSessionStore.getState().cancelSession(sessionId);
    }

    runtime.updateInvocation(parentToolCallId, { status: 'cancelled', error: 'Cancelled' });
    const completion = completions.get(parentToolCallId);
    completion?.reject(new Error('Cancelled'));
    completions.delete(parentToolCallId);
  },
};
