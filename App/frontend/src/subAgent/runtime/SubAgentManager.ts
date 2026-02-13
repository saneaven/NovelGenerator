/**
 * SubAgentManager — Core engine for sub-agent runs.
 *
 * Architecture:
 * - State machine with explicit transition table via transitionTo()
 * - Iterative runLoop() instead of recursive runTurn()
 * - Incremental persistence (createRun, addMessage, updateMessage, patchRun)
 * - Auto-approve pipeline (buildAutoApproveDecisions → markToolCallsRunning → applyToolCalls)
 * - Message ID mapping for nested sub-agent parent references
 */

import { startLLMSession } from '../../llmSession';
import { useAgentStore } from '../../store/agentStore';
import { useCredentialsStore } from '../../store/credentialsStore';
import { useLLMSessionStore } from '../../store/llmSessionStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useSubAgentStore } from '../../store/subAgentStore';
import {
  buildSubAgentRunKey,
  type SubAgentRun,
  type SubAgentRunStatus,
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
  buildAutoApproveDecisions,
} from '../../toolCall/runtime';
import type { HandlerOptions } from '../../toolCall/apply/types';
import type { ApplicationResult, ToolCallDecisionMap } from '../../toolCall/types';
import { generateTempId } from '../../utils/tempId';
import type { SubAgentDefinition } from '../../types/subAgents';
import { buildCallToolSchema } from '../tools/SubAgentCallTools';
import type { InvocationCaller } from '../../types/agentRuntime';
import { subAgentRunService } from '../../api/subAgentRunService';
import { evaluateToolCallAutoContinue } from '../../agent/utils/autoContinuePolicy';


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Completion = { resolve: (output: string) => void; reject: (error: Error) => void };
type ControlIntent = 'pause' | 'cancel';
type TurnAction = 'completed' | 'continue' | 'waiting' | 'paused' | 'error';

type RunConfig = {
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


// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const completions = new Map<string, Completion>();
const controlIntents = new Map<string, ControlIntent>();

const RETURN_RESULT_TOOL_NAME = 'return_sub_agent_result';
const RETURN_RESULT_RULE_REASON =
  'return_sub_agent_result must be called exactly once and must be the ONLY tool call in the final message of the Sub Agent run. ' +
  'Do other tool calls first. When finished, call return_sub_agent_result alone with a non-empty string field "result".';


// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

const TERMINAL = new Set<SubAgentRunStatus>(['completed', 'cancelled']);

const ALLOWED_TRANSITIONS: Record<SubAgentRunStatus, Set<SubAgentRunStatus>> = {
  running: new Set(['waiting', 'completed', 'error', 'paused', 'cancelled']),
  waiting: new Set(['running', 'paused', 'cancelled', 'completed']),
  paused: new Set(['running', 'cancelled']),
  error: new Set(['running', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
};

function transitionTo(runKey: string, next: SubAgentRunStatus): boolean {
  const runtime = useSubAgentRuntimeStore.getState();
  const run = runtime.getRunByKey(runKey);
  if (!run) return false;
  if (TERMINAL.has(run.status)) return false;
  if (!ALLOWED_TRANSITIONS[run.status]?.has(next)) {
    console.warn(`[SubAgentManager] Invalid transition: ${run.status} → ${next} (key=${runKey})`);
    return false;
  }
  runtime.updateRun(runKey, { status: next });
  return true;
}


// ---------------------------------------------------------------------------
// Control intents
// ---------------------------------------------------------------------------

function setControlIntent(runKey: string, intent: ControlIntent): void {
  controlIntents.set(runKey, intent);
}

function consumeControlIntent(runKey: string): ControlIntent | undefined {
  const intent = controlIntents.get(runKey);
  if (intent) controlIntents.delete(runKey);
  return intent;
}

function clearControlIntent(runKey: string): void {
  controlIntents.delete(runKey);
}


// ---------------------------------------------------------------------------
// Completion promise management
// ---------------------------------------------------------------------------

function ensureCompletion(runKey: string): Promise<string> {
  if (completions.has(runKey)) {
    return new Promise((resolve, reject) => {
      const existing = completions.get(runKey)!;
      const prevResolve = existing.resolve;
      const prevReject = existing.reject;
      completions.set(runKey, {
        resolve: (output) => { prevResolve(output); resolve(output); },
        reject: (error) => { prevReject(error); reject(error); },
      });
    });
  }

  return new Promise<string>((resolve, reject) => {
    completions.set(runKey, { resolve, reject });
  });
}

function resolveCompletion(runKey: string, output: string): void {
  const completion = completions.get(runKey);
  completion?.resolve(output);
  completions.delete(runKey);
}

function rejectCompletion(runKey: string, reason: string): void {
  const completion = completions.get(runKey);
  completion?.reject(new Error(reason));
  completions.delete(runKey);
}


// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function stringifyInput(input: string): string {
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

export function mapPersistedMessagesToHistory(messages: Array<any>): ChatMessage[] {
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

/**
 * Build messageIdMap from server messages (identity mapping for reload recovery).
 */
export function buildIdMapFromServerMessages(messages: Array<{ id: string }>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const msg of messages) {
    map[msg.id] = msg.id;
  }
  return map;
}


// ---------------------------------------------------------------------------
// Definition & tool schema loading
// ---------------------------------------------------------------------------

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
    if (!schema) throw new Error(`Unsupported tool in allowlist: ${name}`);
    schemas.push({ name: schema.name, description: schema.description, parameters: schema.parameters });
  }

  const store = useSubAgentStore.getState();
  if (store.subAgents.length === 0 && !store.isLoading) {
    await store.loadSubAgents();
  }

  for (const subAgentId of definition.allowed_sub_agent_ids ?? []) {
    if (subAgentId === definition.id) continue;
    const target = store.getById(subAgentId);
    if (!target) throw new Error(`Allowed Sub Agent not found: ${subAgentId}`);
    if (!target.enabled) continue;
    schemas.push(buildCallToolSchema(target));
  }

  const returnSchema = schemaRegistry.get(RETURN_RESULT_TOOL_NAME);
  if (!returnSchema) throw new Error(`Missing schema: ${RETURN_RESULT_TOOL_NAME}`);
  schemas.push({ name: returnSchema.name, description: returnSchema.description, parameters: returnSchema.parameters });

  return schemas;
}

async function resolveRuntimeConfig(runKey: string): Promise<SubAgentRun | undefined> {
  const runtime = useSubAgentRuntimeStore.getState();
  const run = runtime.getRunByKey(runKey);
  if (!run) return undefined;
  if (run.llmConfig && run.tools) return run;

  const definition = await loadDefinitionOrThrow(run.subAgentId);
  if (!definition.enabled) throw new Error(`Sub Agent is disabled: ${run.subAgentId}`);
  if (!definition.allowed_invocation_modes.includes(run.caller)) {
    throw new Error(`Sub Agent not allowed from caller: ${run.caller}`);
  }

  const tools = await buildToolSchemas(definition);
  const settingsStore = useSettingsStore.getState();
  const globalConfig = settingsStore.getTaskConfig('subAgent');
  const llmConfig: TaskAIConfig = definition.use_custom_llm_config ? definition.llm_config_override! : globalConfig;

  runtime.updateRun(runKey, {
    agentName: definition.agent_name,
    displayName: definition.display_name,
    llmConfig,
    tools,
    handlerOptions: run.handlerOptions ?? { userRequest: 'SubAgent' },
  });

  return runtime.getRunByKey(runKey);
}


// ---------------------------------------------------------------------------
// Return-result batch rules
// ---------------------------------------------------------------------------

function applyReturnResultBatchRules(toolCalls: ToolCallMetadata[]): ToolCallMetadata[] {
  const returnCalls = toolCalls.filter((tc) => tc.tool_name === RETURN_RESULT_TOOL_NAME);
  if (returnCalls.length === 0) return toolCalls;

  const hasOtherTools = toolCalls.some((tc) => tc.tool_name !== RETURN_RESULT_TOOL_NAME);
  const hasMultipleReturns = returnCalls.length > 1;

  let changed = false;
  const next = toolCalls.map((tc) => {
    if (tc.tool_name !== RETURN_RESULT_TOOL_NAME) return tc;

    const result = (tc.arguments as any)?.result;
    const invalidResult = typeof result !== 'string' || !result.trim();
    const violatesRules = hasOtherTools || hasMultipleReturns || invalidResult;
    if (!violatesRules) return tc;

    changed = true;
    return {
      ...tc,
      status: 'failed' as const,
      failureType: 'validation' as const,
      reason: RETURN_RESULT_RULE_REASON,
      result: undefined,
      acceptedAt: undefined,
    };
  });

  return changed ? next : toolCalls;
}


// ---------------------------------------------------------------------------
// History helpers
// ---------------------------------------------------------------------------

function replaceLastAssistantToolCalls(runKey: string, toolCalls: ToolCallMetadata[]): boolean {
  const runtime = useSubAgentRuntimeStore.getState();
  const run = runtime.getRunByKey(runKey);
  if (!run) return false;

  const history = run.history.slice();
  const lastIdx = findLastAssistantMessageIndex(history);
  if (lastIdx < 0) return false;

  history[lastIdx] = { ...history[lastIdx], toolCalls } as any;
  runtime.replaceHistory(runKey, history);
  return true;
}

function appendAssistantMessage(runKey: string, message: ChatMessage): boolean {
  const runtime = useSubAgentRuntimeStore.getState();
  const run = runtime.getRunByKey(runKey);
  if (!run) return false;
  runtime.replaceHistory(runKey, [...run.history, message]);
  return true;
}


// ---------------------------------------------------------------------------
// Parent tool call sync
// ---------------------------------------------------------------------------

async function updateAgentParentToolCall(params: {
  run: SubAgentRun;
  patch: (toolCall: ToolCallMetadata) => ToolCallMetadata;
}): Promise<void> {
  const { run, patch } = params;
  const agentStore = useAgentStore.getState();
  const agent = agentStore.getAgent(run.projectId, run.agentId);
  const message = agent?.messages.find((msg) => String(msg.id) === String(run.parentMessageId));
  if (!message || !Array.isArray(message.toolCalls)) return;

  let changed = false;
  const nextToolCalls = message.toolCalls.map((tc) => {
    if (tc.id !== run.parentToolCallId) return tc;
    changed = true;
    return patch(tc as ToolCallMetadata);
  });
  if (!changed) return;

  await agentStore.updateMessageToolCalls(
    run.projectId,
    run.agentId,
    String(run.parentMessageId),
    nextToolCalls as ToolCallMetadata[],
  );
}

function findRunKeyByPersistentId(parentPersistentId: string): string | undefined {
  const runtime = useSubAgentRuntimeStore.getState();
  for (const [key, run] of Object.entries(runtime.runsByKey)) {
    if (!run) continue;
    if (run.persistentId === parentPersistentId) return key;
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
    const tcs = history[i]?.toolCalls ?? [];
    if (!Array.isArray(tcs)) continue;
    if (tcs.some((tc) => String((tc as any)?.id) === String(toolCallId))) return i;
  }
  return -1;
}

async function updateSubAgentParentToolCall(params: {
  run: SubAgentRun;
  patch: (toolCall: ToolCallMetadata) => ToolCallMetadata;
}): Promise<void> {
  const { run, patch } = params;
  const parentKey = findRunKeyByPersistentId(String(run.parentId));
  if (!parentKey) return;

  const runtime = useSubAgentRuntimeStore.getState();
  const parentRun = runtime.getRunByKey(parentKey);
  if (!parentRun) return;

  const nextHistory = parentRun.history.slice();
  let targetIdx = findHistoryMessageIndexById(nextHistory, String(run.parentMessageId));
  if (targetIdx < 0) targetIdx = findHistoryMessageIndexByToolCallId(nextHistory, run.parentToolCallId);
  if (targetIdx < 0) return;

  const targetMsg = nextHistory[targetIdx];
  const toolCalls = targetMsg.toolCalls ?? [];
  if (!Array.isArray(toolCalls)) return;

  let changed = false;
  const nextToolCalls = toolCalls.map((tc) => {
    if (String((tc as any)?.id) !== String(run.parentToolCallId)) return tc as ToolCallMetadata;
    changed = true;
    return patch(tc as ToolCallMetadata);
  });
  if (!changed) return;

  nextHistory[targetIdx] = { ...targetMsg, toolCalls: nextToolCalls as any };
  runtime.replaceHistory(parentKey, nextHistory);

  // Persist parent tool call update
  const localMsgId = String(targetMsg.id);
  const parentServerMsgId = parentRun.messageIdMap[localMsgId];
  if (parentServerMsgId && parentRun.persistentId) {
    try {
      await subAgentRunService.updateMessage(
        parentRun.projectId,
        parentRun.agentId,
        parentRun.persistentId,
        parentServerMsgId,
        { tool_calls: nextToolCalls as any },
      );
    } catch (e) { console.error('[SubAgentManager] Failed to persist parent tool call update', e); }
  }
}

async function syncParentToolCall(params: {
  run: SubAgentRun;
  patch: (toolCall: ToolCallMetadata) => ToolCallMetadata;
}): Promise<void> {
  const { run, patch } = params;
  if (run.parentType === 'agent') {
    await updateAgentParentToolCall({ run, patch });
    return;
  }
  if (run.parentType === 'sub_agent') {
    await updateSubAgentParentToolCall({ run, patch });
  }
}

async function syncParentRunning(run: SubAgentRun): Promise<void> {
  await syncParentToolCall({
    run,
    patch: (tc) => ({
      ...tc,
      status: 'running',
      reason: undefined,
      failureType: undefined,
      result: undefined,
      acceptedAt: undefined,
    }),
  });
}

async function syncParentAccepted(run: SubAgentRun, output: string): Promise<void> {
  const result: ApplicationResult = {
    success: true,
    message: output,
    data: { subAgentId: run.subAgentId, agentName: run.agentName },
  };
  await syncParentToolCall({
    run,
    patch: (tc) => ({
      ...tc,
      status: 'accepted',
      reason: undefined,
      failureType: undefined,
      result,
      acceptedAt: new Date(),
    }),
  });
}

async function syncParentFailed(run: SubAgentRun, reason: string): Promise<void> {
  const result: ApplicationResult = {
    success: false,
    message: `Error executing call_${run.agentName}`,
    error: reason,
    data: { subAgentId: run.subAgentId, agentName: run.agentName },
  };
  await syncParentToolCall({
    run,
    patch: (tc) => ({
      ...tc,
      status: 'failed',
      reason,
      failureType: 'execution',
      result,
      acceptedAt: undefined,
    }),
  });
}


// ---------------------------------------------------------------------------
// Incremental persistence helpers
// ---------------------------------------------------------------------------

async function persistCreateRun(runKey: string): Promise<void> {
  const runtime = useSubAgentRuntimeStore.getState();
  const run = runtime.getRunByKey(runKey);
  if (!run || run.persistentId) return;

  try {
    const response = await subAgentRunService.createRun(run.projectId, run.agentId, {
      parent_type: run.parentType,
      parent_id: run.parentId,
      parent_message_id: run.parentMessageId,
      parent_tool_call_id: run.parentToolCallId,
      sub_agent_id: run.subAgentId,
      agent_name: run.agentName,
      display_name: run.displayName,
      caller: run.caller,
      language: run.language,
      input: run.input ?? '',
      status: run.status,
    });
    const persistentId = response?.run?.id;
    if (persistentId) {
      runtime.updateRun(runKey, { persistentId });
    }
  } catch (e) { console.error('[SubAgentManager] Failed to create run', e); }
}

async function persistPatchRun(runKey: string): Promise<void> {
  const runtime = useSubAgentRuntimeStore.getState();
  const run = runtime.getRunByKey(runKey);
  if (!run?.persistentId) return;

  try {
    await subAgentRunService.patchRun(run.projectId, run.agentId, run.persistentId, {
      status: run.status,
      final_output: run.finalOutput,
      error: run.error,
    });
  } catch (e) { console.error('[SubAgentManager] Failed to patch run', e); }
}

async function persistAddMessage(runKey: string, localMsgId: string, message: ChatMessage): Promise<void> {
  const runtime = useSubAgentRuntimeStore.getState();
  const run = runtime.getRunByKey(runKey);
  if (!run?.persistentId) return;

  try {
    const response = await subAgentRunService.addMessage(run.projectId, run.agentId, run.persistentId, {
      role: String(message.role),
      content_parts: (message.contentParts ?? []) as any,
      tool_calls: (message.toolCalls ?? undefined) as any,
      thinking_details: (message.thinking_details ?? undefined) as any,
    });
    const serverId = response?.message?.id;
    if (serverId) {
      runtime.setMessageServerId(runKey, localMsgId, serverId);
    }
  } catch (e) { console.error('[SubAgentManager] Failed to add message', e); }
}

async function persistUpdateMessage(runKey: string, localMsgId: string, patch: { tool_calls?: any; thinking_details?: any }): Promise<void> {
  const runtime = useSubAgentRuntimeStore.getState();
  const run = runtime.getRunByKey(runKey);
  const serverId = run?.messageIdMap[localMsgId];
  if (!serverId || !run?.persistentId) return;

  try {
    await subAgentRunService.updateMessage(run.projectId, run.agentId, run.persistentId, serverId, patch);
  } catch (e) { console.error('[SubAgentManager] Failed to update message', e); }
}


// ---------------------------------------------------------------------------
// Terminal helpers
// ---------------------------------------------------------------------------

async function completeRun(runKey: string, output: string): Promise<void> {
  if (!transitionTo(runKey, 'completed')) return;

  const runtime = useSubAgentRuntimeStore.getState();
  runtime.updateRun(runKey, { finalOutput: output, error: undefined, activeSessionId: null });

  void persistPatchRun(runKey);

  const run = runtime.getRunByKey(runKey);
  if (run) await syncParentAccepted(run, output);

  resolveCompletion(runKey, output);
}

async function failRun(runKey: string, errorMsg: string): Promise<void> {
  if (!transitionTo(runKey, 'error')) return;

  const runtime = useSubAgentRuntimeStore.getState();
  runtime.updateRun(runKey, { error: errorMsg, activeSessionId: null });

  void persistPatchRun(runKey);

  const run = runtime.getRunByKey(runKey);
  if (run) await syncParentRunning(run);
  // Don't reject completion — retry is possible
}


// ---------------------------------------------------------------------------
// Core engine: runLoop + executeLLMTurn + processToolCalls
// ---------------------------------------------------------------------------

async function executeLLMTurn(runKey: string): Promise<{ action: TurnAction; output?: string }> {
  const runtime = useSubAgentRuntimeStore.getState();
  const run = runtime.getRunByKey(runKey);
  if (!run) return { action: 'error' };

  // Build frozen project data snapshot for context drift prevention
  let frozenProjectData = run.frozenProjectData;
  if (!frozenProjectData) {
    const credStore = useCredentialsStore.getState();
    const pm = new PromptManager(credStore.getCredentials());
    frozenProjectData = await pm.buildProjectData(run.projectId, run.language);
    runtime.updateRun(runKey, { frozenProjectData });
  }

  const settingsStore = useSettingsStore.getState();
  const retryConfig = settingsStore.retryConfig;
  const outputMode = settingsStore.nativeOutputMode;

  // Start LLM session
  const handle = startLLMSession({
    kind: 'subAgent',
    mode: LLMTaskMode.SUB_AGENT,
    promptContext: {
      tools: run.tools ?? [],
      agentName: run.agentName,
      project: frozenProjectData,
      nativeOutputMode: outputMode,
    },
    history: run.history,
    model: run.llmConfig!.model,
    provider: run.llmConfig!.provider,
    temperature: run.llmConfig!.temperature ?? 0.7,
    maxOutputTokens: run.llmConfig!.max_output_tokens ?? undefined,
    contextWindowTokens: run.llmConfig!.context_window_tokens ?? undefined,
    retryConfig,
    thinkingMode: run.llmConfig!.advanced?.thinking_mode,
    thinkingConfig: run.llmConfig!.advanced?.thinking_config,
    requestFormat: run.llmConfig!.advanced?.request_format,
    thinkingFormat: run.llmConfig!.advanced?.thinking_format,
    enablePrefill: run.llmConfig!.advanced?.enable_prefill,
  });

  runtime.updateRun(runKey, { activeSessionId: handle.sessionId });

  // Await session completion
  let session: any;
  try {
    session = await handle.done;
  } catch {
    // Check for latest session from store
    session = useLLMSessionStore.getState().sessions[handle.sessionId];
  }

  // Get latest session state
  const latestSession = useLLMSessionStore.getState().sessions[handle.sessionId] ?? session;
  const sessionStatus = latestSession?.status ?? session?.status ?? 'failed';

  runtime.updateRun(runKey, { activeSessionId: null });

  // Handle failure / cancellation
  if (sessionStatus === 'failed' || sessionStatus === 'cancelled') {
    const intent = consumeControlIntent(runKey);
    if (intent === 'pause') {
      if (transitionTo(runKey, 'paused')) {
        void persistPatchRun(runKey);
        const updatedRun = useSubAgentRuntimeStore.getState().getRunByKey(runKey);
        if (updatedRun) await syncParentRunning(updatedRun);
      }
      return { action: 'paused' };
    }
    if (intent === 'cancel') {
      return { action: 'paused' }; // cancel handled by the caller
    }
    const errorMsg = latestSession?.error ?? 'LLM session failed';
    await failRun(runKey, errorMsg);
    return { action: 'error' };
  }

  // Build assistant message from session response
  const assistantMessage: ChatMessage = {
    id: generateTempId(),
    role: 'assistant',
    contentParts: latestSession?.contentParts ?? [],
    toolCalls: latestSession?.toolCalls ?? [],
    thinking_details: latestSession?.thinkingDetails ?? [],
    timestamp: new Date(),
  };

  appendAssistantMessage(runKey, assistantMessage);
  await persistAddMessage(runKey, String(assistantMessage.id), assistantMessage);

  // No tool calls → completed
  const toolCalls = (assistantMessage.toolCalls ?? []) as ToolCallMetadata[];
  if (toolCalls.length === 0) {
    const output = contentText(assistantMessage.contentParts ?? []);
    return { action: 'completed', output };
  }

  // Process tool calls
  return processToolCalls(runKey);
}

async function processToolCalls(runKey: string): Promise<{ action: TurnAction; output?: string }> {
  const runtime = useSubAgentRuntimeStore.getState();
  const run = runtime.getRunByKey(runKey);
  if (!run) return { action: 'error' };

  const lastIdx = findLastAssistantMessageIndex(run.history);
  if (lastIdx < 0) return { action: 'error' };

  const assistantMessage = run.history[lastIdx];
  const toolCalls = (assistantMessage.toolCalls ?? []) as ToolCallMetadata[];

  // 1. Stage tool calls
  const staged = await stageToolCalls({
    projectId: run.projectId,
    language: run.language,
    toolCalls,
    allowedToolNames: run.tools?.map((t) => t.name),
  });

  // 2. Apply return-result batch rules
  const adjustedToolCalls = applyReturnResultBatchRules(staged.toolCalls);
  replaceLastAssistantToolCalls(runKey, adjustedToolCalls);

  // Persist tool call staging
  const localMsgId = String(assistantMessage.id);
  void persistUpdateMessage(runKey, localMsgId, { tool_calls: adjustedToolCalls as any });

  // 3. Auto-approve pipeline
  const autoApproveConfig = useSettingsStore.getState().toolCallAutoApprove;
  const { decisions, allAutoApproved } = buildAutoApproveDecisions({
    toolCalls: adjustedToolCalls,
    config: autoApproveConfig,
  });

  if (allAutoApproved && Object.keys(decisions).length > 0) {
    // Mark running
    const runningToolCalls = markToolCallsRunning({ toolCalls: adjustedToolCalls, decisions });
    replaceLastAssistantToolCalls(runKey, runningToolCalls);

    // Apply tool calls
    const parentSubMessageId = findLastAssistantMessageId(run.history);
    const applied = await applyToolCalls({
      projectId: run.projectId,
      language: run.language,
      toolCalls: runningToolCalls,
      decisions,
      options: {
        ...(run.handlerOptions ?? {}),
        userRequest: run.handlerOptions?.userRequest ?? 'SubAgent',
        agentId: run.agentId,
        parentAgentMessageId: undefined,
        parentSubRunId: run.persistentId,
        parentSubMessageId: parentSubMessageId ?? undefined,
      },
      invocationCaller: 'subAgent',
    });

    replaceLastAssistantToolCalls(runKey, applied.toolCalls);
    void persistUpdateMessage(runKey, localMsgId, { tool_calls: applied.toolCalls as any });

    // Check for accepted return_sub_agent_result
    const acceptedReturn = applied.toolCalls.find(
      (tc) => tc.tool_name === RETURN_RESULT_TOOL_NAME && tc.status === 'accepted',
    );
    if (acceptedReturn) {
      const output = acceptedReturn.result?.message ?? '';
      return { action: 'completed', output };
    }

    // Evaluate auto-continue state after auto-approve
    const state = evaluateToolCallAutoContinue(applied.toolCalls);
    if (state.hasPending) {
      if (transitionTo(runKey, 'waiting')) {
        runtime.updateRun(runKey, { activeSessionId: null });
        void persistPatchRun(runKey);
        const updatedRun = useSubAgentRuntimeStore.getState().getRunByKey(runKey);
        if (updatedRun) await syncParentRunning(updatedRun);
      }
      return { action: 'waiting' };
    }
    if (state.shouldAutoContinue) {
      return { action: 'continue' };
    }
    if (state.hasRejected) {
      if (transitionTo(runKey, 'paused')) {
        runtime.updateRun(runKey, { activeSessionId: null });
        void persistPatchRun(runKey);
        const updatedRun = useSubAgentRuntimeStore.getState().getRunByKey(runKey);
        if (updatedRun) await syncParentRunning(updatedRun);
      }
      return { action: 'paused' };
    }
    return { action: 'continue' };
  }

  // Not all auto-approved → evaluate what we have
  const state = evaluateToolCallAutoContinue(adjustedToolCalls);
  if (state.hasPending) {
    if (transitionTo(runKey, 'waiting')) {
      runtime.updateRun(runKey, { activeSessionId: null });
      void persistPatchRun(runKey);
      const updatedRun = useSubAgentRuntimeStore.getState().getRunByKey(runKey);
      if (updatedRun) await syncParentRunning(updatedRun);
    }
    return { action: 'waiting' };
  }

  return { action: 'continue' };
}

async function runLoop(runKey: string): Promise<void> {
  while (true) {
    const runtime = useSubAgentRuntimeStore.getState();
    const run = runtime.getRunByKey(runKey);
    if (!run || TERMINAL.has(run.status)) return;
    if (!run.llmConfig || !run.tools) {
      await failRun(runKey, 'Missing runtime config');
      return;
    }

    // Transition running
    if (!transitionTo(runKey, 'running')) return;
    runtime.updateRun(runKey, { turnCount: run.turnCount + 1, error: undefined });
    const updatedRun = runtime.getRunByKey(runKey);
    if (updatedRun) await syncParentRunning(updatedRun);
    void persistPatchRun(runKey);

    // Execute one LLM turn
    try {
      const result = await executeLLMTurn(runKey);

      if (result.action === 'completed') {
        await completeRun(runKey, result.output!);
        return;
      }
      if (result.action === 'waiting' || result.action === 'paused' || result.action === 'error') {
        return; // loop exits, UI takes over
      }
      if (result.action === 'continue') {
        continue; // next iteration
      }
    } catch (error) {
      await failRun(runKey, error instanceof Error ? error.message : String(error));
      return;
    }
  }
}


// ---------------------------------------------------------------------------
// Invocation tree collection (for discard)
// ---------------------------------------------------------------------------

function collectRunTreeKeysByParentMessage(params: {
  agentId: string;
  parentMessageId: string;
}): string[] {
  const { agentId, parentMessageId } = params;
  const runtime = useSubAgentRuntimeStore.getState();
  const entries = Object.entries(runtime.runsByKey);
  const targetMessageId = String(parentMessageId);
  const targetAgentId = String(agentId);

  const collectedKeys = new Set<string>();
  const persistentParentIds = new Set<string>();

  for (const [key, run] of entries) {
    if (!run) continue;
    if (run.parentType !== 'agent') continue;
    if (String(run.parentId) !== targetAgentId) continue;
    if (String(run.parentMessageId) !== targetMessageId) continue;

    collectedKeys.add(key);
    if (run.persistentId) persistentParentIds.add(String(run.persistentId));
  }

  if (collectedKeys.size === 0) return [];

  let added = true;
  while (added) {
    added = false;
    for (const [key, run] of entries) {
      if (!run) continue;
      if (run.parentType !== 'sub_agent') continue;
      if (collectedKeys.has(key)) continue;
      if (!persistentParentIds.has(String(run.parentId))) continue;

      collectedKeys.add(key);
      added = true;
      if (run.persistentId) persistentParentIds.add(String(run.persistentId));
    }
  }

  return Array.from(collectedKeys);
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const SubAgentManager = {
  /**
   * Start a Sub Agent run and return a promise that resolves with the final output.
   */
  async invoke(params: RunConfig): Promise<string> {
    const {
      projectId, agentId, language, parentType, parentId,
      parentMessageId, parentToolCallId, caller, subAgentId, input, handlerOptions,
    } = params;

    const definition = await loadDefinitionOrThrow(subAgentId);
    if (!definition.enabled) throw new Error(`Sub Agent is disabled: ${subAgentId}`);
    if (!definition.allowed_invocation_modes.includes(caller)) {
      throw new Error(`Sub Agent not allowed from caller: ${caller}`);
    }

    const tools = await buildToolSchemas(definition);
    const settingsStore = useSettingsStore.getState();
    const globalConfig = settingsStore.getTaskConfig('subAgent');
    const llmConfig: TaskAIConfig = definition.use_custom_llm_config ? definition.llm_config_override! : globalConfig;

    const runKey = buildSubAgentRunKey({ parentType, parentId, parentMessageId, parentToolCallId });

    const runtime = useSubAgentRuntimeStore.getState();
    const existing = runtime.getRunByKey(runKey);

    if (!existing) {
      const userMessageText = stringifyInput(input);
      const userMessage: ChatMessage = {
        id: generateTempId(),
        role: 'user',
        contentParts: [{ type: 'content', text: userMessageText }],
        timestamp: new Date(),
      };

      const newRun: SubAgentRun = {
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
        history: [userMessage],
        turnCount: 0,
        messageIdMap: {},
        activeSessionId: null,
      };

      runtime.upsertRun(newRun);

      // Persist: create run + add initial user message
      await persistCreateRun(runKey);
      await persistAddMessage(runKey, String(userMessage.id), userMessage);
    } else if (existing.status === 'completed' && typeof existing.finalOutput === 'string') {
      return existing.finalOutput;
    } else if (existing.status === 'cancelled') {
      throw new Error('Cancelled');
    }

    await resolveRuntimeConfig(runKey);
    const done = ensureCompletion(runKey);

    void runLoop(runKey);

    return done;
  },

  /**
   * Apply tool call decisions from UI and continue the run.
   */
  async applyAndContinue(runKey: string, decisions: ToolCallDecisionMap): Promise<void> {
    await resolveRuntimeConfig(runKey);
    const runtime = useSubAgentRuntimeStore.getState();
    const run = runtime.getRunByKey(runKey);
    if (!run) return;

    const lastIdx = findLastAssistantMessageIndex(run.history);
    if (lastIdx < 0) return;

    const assistantMessage = run.history[lastIdx];
    const currentToolCalls = (assistantMessage.toolCalls ?? []) as ToolCallMetadata[];
    if (currentToolCalls.length === 0) return;

    const parentSubMessageId = findLastAssistantMessageId(run.history);
    const parentSubRunId = run.persistentId;

    // Mark running
    const runningToolCalls = markToolCallsRunning({ toolCalls: currentToolCalls, decisions });
    replaceLastAssistantToolCalls(runKey, runningToolCalls);

    // Apply
    const applied = await applyToolCalls({
      projectId: run.projectId,
      language: run.language,
      toolCalls: runningToolCalls,
      decisions,
      options: {
        ...(run.handlerOptions ?? {}),
        userRequest: run.handlerOptions?.userRequest ?? 'SubAgent',
        agentId: run.agentId,
        parentAgentMessageId: undefined,
        parentSubRunId: parentSubRunId,
        parentSubMessageId: parentSubMessageId ?? undefined,
      },
      invocationCaller: 'subAgent',
    });

    replaceLastAssistantToolCalls(runKey, applied.toolCalls);

    // Persist tool call updates
    const localMsgId = String(assistantMessage.id);
    void persistUpdateMessage(runKey, localMsgId, { tool_calls: applied.toolCalls as any });

    // Check for accepted return_sub_agent_result
    const acceptedReturn = applied.toolCalls.find(
      (tc) => tc.tool_name === RETURN_RESULT_TOOL_NAME && tc.status === 'accepted',
    );
    if (acceptedReturn) {
      const output = acceptedReturn.result?.message ?? '';
      await completeRun(runKey, output);
      return;
    }

    // Evaluate auto-continue
    const state = evaluateToolCallAutoContinue(applied.toolCalls);
    if (state.hasPending) {
      if (transitionTo(runKey, 'waiting')) {
        runtime.updateRun(runKey, { activeSessionId: null });
        void persistPatchRun(runKey);
        const updatedRun = useSubAgentRuntimeStore.getState().getRunByKey(runKey);
        if (updatedRun) await syncParentRunning(updatedRun);
      }
      return;
    }

    if (state.shouldAutoContinue) {
      runtime.updateRun(runKey, { turnCount: 0 });
      void runLoop(runKey);
      return;
    }

    if (state.hasRejected) {
      if (transitionTo(runKey, 'paused')) {
        runtime.updateRun(runKey, { activeSessionId: null });
        void persistPatchRun(runKey);
        const updatedRun = useSubAgentRuntimeStore.getState().getRunByKey(runKey);
        if (updatedRun) await syncParentRunning(updatedRun);
      }
    }
  },

  async pause(runKey: string): Promise<void> {
    const runtime = useSubAgentRuntimeStore.getState();
    const run = runtime.getRunByKey(runKey);
    if (!run) return;
    if (run.status !== 'running' && run.status !== 'waiting') return;

    const sessionId = run.activeSessionId;
    if (sessionId) {
      setControlIntent(runKey, 'pause');
      useLLMSessionStore.getState().cancelSession(sessionId);
    } else {
      clearControlIntent(runKey);
    }

    if (transitionTo(runKey, 'paused')) {
      runtime.updateRun(runKey, { activeSessionId: null });
      void persistPatchRun(runKey);
      const updatedRun = useSubAgentRuntimeStore.getState().getRunByKey(runKey);
      if (updatedRun) await syncParentRunning(updatedRun);
    }
  },

  async retry(runKey: string): Promise<void> {
    const runtime = useSubAgentRuntimeStore.getState();
    const run = runtime.getRunByKey(runKey);
    if (!run) return;
    if (run.status !== 'paused' && run.status !== 'error') return;

    await resolveRuntimeConfig(runKey);

    clearControlIntent(runKey);
    if (!transitionTo(runKey, 'running')) return;
    runtime.updateRun(runKey, { turnCount: 0, error: undefined, activeSessionId: null });
    void persistPatchRun(runKey);

    const updatedRun = useSubAgentRuntimeStore.getState().getRunByKey(runKey);
    if (updatedRun) await syncParentRunning(updatedRun);

    void runLoop(runKey);
  },

  async cancel(runKey: string): Promise<void> {
    const runtime = useSubAgentRuntimeStore.getState();
    const run = runtime.getRunByKey(runKey);
    if (!run) return;
    if (run.status === 'completed' || run.status === 'cancelled') return;

    const sessionId = run.activeSessionId;
    if (sessionId) {
      setControlIntent(runKey, 'cancel');
      useLLMSessionStore.getState().cancelSession(sessionId);
    } else {
      clearControlIntent(runKey);
    }

    if (transitionTo(runKey, 'cancelled')) {
      runtime.updateRun(runKey, { error: 'Cancelled', activeSessionId: null });
      void persistPatchRun(runKey);
      await syncParentFailed(run, 'Cancelled');
      rejectCompletion(runKey, 'Cancelled');
    }
  },

  /**
   * Discard local Sub Agent runtime state rooted at an agent message.
   * Backend persistence is cleaned by agent message delete route.
   */
  async discardByParentAgentMessage(params: {
    agentId: string;
    parentMessageId: string;
    reason?: string;
  }): Promise<void> {
    const { agentId, parentMessageId, reason } = params;
    const runKeys = collectRunTreeKeysByParentMessage({ agentId, parentMessageId });
    if (runKeys.length === 0) return;

    const runtime = useSubAgentRuntimeStore.getState();
    const errorMessage = reason ?? 'Parent message deleted';

    for (const key of runKeys) {
      const run = runtime.getRunByKey(key);
      if (!run) continue;

      if (run.activeSessionId) {
        useLLMSessionStore.getState().cancelSession(run.activeSessionId);
      }

      clearControlIntent(key);
      rejectCompletion(key, errorMessage);
      runtime.clearRun(key);
    }
  },

  /**
   * Reconcile parent tool call state after reload recovery.
   */
  async reconcileParentToolCall(runKey: string): Promise<void> {
    const runtime = useSubAgentRuntimeStore.getState();
    const run = runtime.getRunByKey(runKey);
    if (!run) return;

    if (run.status === 'completed') {
      await syncParentAccepted(run, run.finalOutput ?? '');
      return;
    }
    if (run.status === 'cancelled') {
      await syncParentFailed(run, 'Cancelled');
      return;
    }
    await syncParentRunning(run);
  },
};
