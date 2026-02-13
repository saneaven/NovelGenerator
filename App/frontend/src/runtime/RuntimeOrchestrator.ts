import { runService } from '../api/runService';
import type {
  CreateUnifiedRunRequest,
  RunMessageResponse,
  RunToolCallResponse,
  UnifiedRunResponse,
} from '../api/types';
import { useRuntimeStore } from './store/runtimeStore';
import {
  assertRunTransition,
  canTransitionRunStatus,
  isTerminalRunStatus,
} from './stateMachine';
import type {
  Run,
  RunMessage,
  RunStatus,
  RunToolCall,
  RuntimeOrchestrator,
} from './types';
import { useSettingsStore } from '../store/settingsStore';
import { useCredentialsStore } from '../store/credentialsStore';
import { useLLMSessionStore } from '../store/llmSessionStore';
import { useSubAgentStore } from '../store/subAgentStore';
import { startLLMSession } from '../llmSession';
import {
  LLMTaskMode,
  type AgentPromptContext,
} from '../llm';
import type { SubAgentPromptContext } from '../llm/types';
import { PromptManager } from '../llm/PromptManager';
import type { ChatMessage, ToolCallMetadata } from '../llm/requestTypes';
import type { ToolCallSchema } from '../toolCall';
import { getToolsForSet } from '../toolCall';
import { schemaRegistry } from '../toolCall/schemas/schemaRegistry';
import { buildCallToolSchema } from '../subAgent/tools/SubAgentCallTools';
import {
  stageToolCalls,
  applyToolCalls,
  markToolCallsRunning,
  buildAutoApproveDecisions,
} from '../toolCall/runtime';
import { evaluateToolCallAutoContinue } from '../agent/utils/autoContinuePolicy';
import { useAgentPromptSnapshotStore } from '../store/agentPromptSnapshotStore';
import type { ApplicationResult } from '../toolCall/types';
import { resolveRunMessageDisplay } from './utils/displayMessage';

const MAX_CHILD_DEPTH = 3;
const RUN_TIMEOUT_MS = 120_000;

type RunControlIntent = 'pause' | 'cancel';
type RunStepAction = 'completed' | 'continue' | 'waiting' | 'paused' | 'error' | 'cancelled';

type RunOverrides = {
  historyOverride?: ChatMessage[];
  promptContextOverride?: Record<string, unknown>;
};

type RunStepResult = {
  action: RunStepAction;
  output?: string;
  error?: string;
};

type RunCompletionEntry = {
  promise: Promise<string>;
  resolve: (output: string) => void;
  reject: (error: Error) => void;
};

type RunExecutionConfig = {
  mode: typeof LLMTaskMode[keyof typeof LLMTaskMode];
  label: string;
  kind: 'agent' | 'subAgent';
  provider: string;
  providerConfig: unknown;
  model: string;
  temperature: number;
  thinkingMode: 'off' | 'model' | 'custom' | undefined;
  thinkingConfig: unknown;
  requestFormat: string | undefined;
  thinkingFormat: string | undefined;
  history: ChatMessage[];
  promptContext: AgentPromptContext | SubAgentPromptContext;
  toolSchemas: ToolCallSchema[] | undefined;
};

function mapRun(apiRun: UnifiedRunResponse, prev?: Run): Run {
  return {
    id: apiRun.id,
    projectId: apiRun.project_id,
    agentId: apiRun.agent_id,
    runKind: apiRun.run_kind,
    caller: apiRun.caller,
    status: apiRun.status,
    language: apiRun.language,
    inputText: apiRun.input_text,
    finalOutput: apiRun.final_output ?? undefined,
    error: apiRun.error ?? undefined,
    runMode: apiRun.run_mode ?? undefined,
    surface: apiRun.surface ?? undefined,
    contextObjectIds: apiRun.context_object_ids ?? [],
    parentRunId: apiRun.parent_run_id ?? undefined,
    parentRunMessageId: apiRun.parent_run_message_id ?? undefined,
    parentRunToolCallId: apiRun.parent_run_tool_call_id ?? undefined,
    subAgentId: apiRun.sub_agent_id ?? undefined,
    rootRunSeq: apiRun.root_run_seq ?? undefined,
    nextMessageSeq: apiRun.next_message_seq,
    runStepCount: prev?.runStepCount ?? 0,
    activeSessionId: prev?.activeSessionId ?? null,
    frozenProjectData: prev?.frozenProjectData,
    createdAt: apiRun.created_at,
    updatedAt: apiRun.updated_at,
  };
}

function mapRunMessage(apiMessage: RunMessageResponse): RunMessage {
  return {
    id: apiMessage.id,
    runId: apiMessage.run_id,
    seq: apiMessage.seq,
    role: apiMessage.role,
    data: (apiMessage.data ?? {}) as Record<string, { contentParts: Array<{ type: string; text: string }>; thinkingDetails?: Array<Record<string, unknown>> }>,
    createdAt: apiMessage.created_at,
  };
}

function mapRunToolCall(apiToolCall: RunToolCallResponse): RunToolCall {
  return {
    id: apiToolCall.id,
    runId: apiToolCall.run_id,
    messageId: apiToolCall.message_id,
    llmCallId: apiToolCall.llm_call_id,
    callSeq: apiToolCall.call_seq,
    toolName: apiToolCall.tool_name,
    arguments: (apiToolCall.arguments ?? {}) as Record<string, unknown>,
    status: apiToolCall.status,
    failureType: apiToolCall.failure_type ?? undefined,
    reason: apiToolCall.reason ?? undefined,
    result: (apiToolCall.result ?? undefined) as Record<string, unknown> | undefined,
    acceptedAt: apiToolCall.accepted_at ?? undefined,
    createdAt: apiToolCall.created_at,
    updatedAt: apiToolCall.updated_at,
  };
}

function getMessageText(contentParts: Array<{ type: string; text: string }> | undefined): string {
  if (!contentParts) return '';
  return contentParts
    .filter((part) => part.type === 'content')
    .map((part) => part.text)
    .join('');
}

function toToolCallMetadata(toolCall: RunToolCall): ToolCallMetadata {
  return {
    id: toolCall.llmCallId,
    tool_name: toolCall.toolName,
    arguments: toolCall.arguments,
    status: toolCall.status,
    reason: toolCall.reason,
    failureType: toolCall.failureType,
    result: toolCall.result as ApplicationResult | undefined,
    acceptedAt: toolCall.acceptedAt ? new Date(toolCall.acceptedAt) : undefined,
  };
}

function normalizeRunToolCallStatus(status: unknown): RunToolCall['status'] {
  if (status === 'pending' || status === 'running' || status === 'accepted' || status === 'rejected' || status === 'failed') {
    return status;
  }
  if (status === 'processing') return 'running';
  return 'pending';
}

function toRunToolCalls(params: {
  runId: string;
  runMessageId: string;
  toolCalls: ToolCallMetadata[];
}): RunToolCall[] {
  const { runId, runMessageId, toolCalls } = params;
  const now = new Date().toISOString();
  return toolCalls.map((toolCall, index) => ({
    id: `${runMessageId}:${toolCall.id}`,
    runId,
    messageId: runMessageId,
    llmCallId: toolCall.id,
    callSeq: index + 1,
    toolName: toolCall.tool_name,
    arguments: (toolCall.arguments ?? {}) as Record<string, unknown>,
    status: normalizeRunToolCallStatus(toolCall.status),
    failureType: toolCall.failureType as RunToolCall['failureType'],
    reason: toolCall.reason,
    result: (toolCall.result ?? undefined) as Record<string, unknown> | undefined,
    acceptedAt: toolCall.acceptedAt ? toolCall.acceptedAt.toISOString() : undefined,
    createdAt: now,
    updatedAt: now,
  }));
}

function toChatMessage(params: {
  message: RunMessage;
  toolCalls: RunToolCall[];
  language: string;
}): ChatMessage {
  const { message, toolCalls, language } = params;
  const display = resolveRunMessageDisplay(message, language);
  return {
    id: message.id,
    seq: message.seq,
    role: message.role,
    contentParts: display.contentParts as any,
    toolCalls: message.role === 'assistant' ? toolCalls.map(toToolCallMetadata) : undefined,
    thinking_details: display.thinkingDetails as any,
    timestamp: new Date(message.createdAt),
  };
}

function hasPendingOrRunning(toolCalls: RunToolCall[]): boolean {
  return toolCalls.some((toolCall) => toolCall.status === 'pending' || toolCall.status === 'running');
}

function hasRejected(toolCalls: RunToolCall[]): boolean {
  return toolCalls.some((toolCall) => toolCall.status === 'rejected');
}

function getAllowedToolNames(tools: ToolCallSchema[] | undefined): string[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  const names = tools
    .map((tool) => (typeof tool?.name === 'string' ? tool.name : null))
    .filter((name): name is string => Boolean(name && name.trim()));
  return names.length > 0 ? names : undefined;
}

class DefaultRuntimeOrchestrator implements RuntimeOrchestrator {
  private readonly runLoopPromises = new Map<string, Promise<void>>();
  private readonly runCompletions = new Map<string, RunCompletionEntry>();
  private readonly controlIntents = new Map<string, RunControlIntent>();
  private readonly nextRunOverrides = new Map<string, RunOverrides>();
  private readonly parentToolCallLocks = new Map<string, Promise<void>>();

  async startRootRun(input: {
    projectId: string;
    agentId: string;
    runMode: 'planMode' | 'agentMode';
    surface: 'story-object' | 'outline-manager' | 'novel-editor' | 'config';
    userInput: string;
    language: string;
    caller?: 'planMode' | 'agentMode';
    contextObjectIds?: string[];
    historyOverride?: Array<Record<string, unknown>>;
    promptContextOverride?: Record<string, unknown>;
  }): Promise<{ runId: string }> {
    const payload: CreateUnifiedRunRequest = {
      run_kind: 'root',
      caller: input.caller ?? input.runMode,
      language: input.language,
      input_text: input.userInput,
      run_mode: input.runMode,
      surface: input.surface,
      context_object_ids: input.contextObjectIds ?? [],
      status: 'running',
    };

    const runResponse = await runService.createRun(input.projectId, input.agentId, payload);
    const run = this.hydrateRunBundle(runResponse.run);

    if (input.userInput.trim()) {
      const runMessageResponse = await runService.addRunMessage(input.projectId, input.agentId, run.id, {
        role: 'user',
        language: input.language,
        content_parts: [{ type: 'content', text: input.userInput }],
        thinking_details: [],
      });
      useRuntimeStore.getState().appendRunMessage(mapRunMessage(runMessageResponse.message));
    }

    const historyOverride = (input.historyOverride as ChatMessage[] | undefined)?.slice();
    this.nextRunOverrides.set(run.id, {
      historyOverride,
      promptContextOverride: input.promptContextOverride,
    });

    void this.resumeRunLoop({ runId: run.id });

    return { runId: run.id };
  }

  async resumeRunLoop(input: {
    runId: string;
    historyOverride?: Array<Record<string, unknown>>;
    promptContextOverride?: Record<string, unknown>;
  }): Promise<void> {
    const run = useRuntimeStore.getState().getRun(input.runId);
    if (!run) return;

    if (input.historyOverride || input.promptContextOverride) {
      this.nextRunOverrides.set(input.runId, {
        historyOverride: (input.historyOverride as ChatMessage[] | undefined)?.slice(),
        promptContextOverride: input.promptContextOverride,
      });
    }

    if (this.runLoopPromises.has(input.runId)) {
      await this.runLoopPromises.get(input.runId);
      return;
    }

    const promise = this.runLoop(input.runId)
      .catch((error) => {
        console.error('[RuntimeOrchestrator] runLoop failed:', error);
      })
      .finally(() => {
        this.runLoopPromises.delete(input.runId);
      });
    this.runLoopPromises.set(input.runId, promise);
    await promise;
  }

  async invokeChildRun(input: {
    projectId: string;
    agentId: string;
    language: string;
    inputText: string;
    parentRunId: string;
    parentRunMessageId: string;
    parentRunToolCallId: string;
    subAgentId: string;
    caller?: 'planMode' | 'agentMode' | 'subAgent';
  }): Promise<{ runId: string; output: string }> {
    const depth = this.computeChildDepth(input.parentRunId);
    if (depth >= MAX_CHILD_DEPTH) {
      throw new Error(`Child run depth exceeded (${MAX_CHILD_DEPTH})`);
    }

    const payload: CreateUnifiedRunRequest = {
      run_kind: 'child',
      caller: input.caller ?? 'subAgent',
      language: input.language,
      input_text: input.inputText,
      parent_run_id: input.parentRunId,
      parent_run_message_id: input.parentRunMessageId,
      parent_run_tool_call_id: input.parentRunToolCallId,
      sub_agent_id: input.subAgentId,
      status: 'running',
    };

    const runResponse = await runService.createRun(input.projectId, input.agentId, payload);
    const run = this.hydrateRunBundle(runResponse.run);

    if (input.inputText.trim()) {
      const messageResponse = await runService.addRunMessage(input.projectId, input.agentId, run.id, {
        role: 'user',
        language: input.language,
        content_parts: [{ type: 'content', text: input.inputText }],
        thinking_details: [],
      });
      useRuntimeStore.getState().appendRunMessage(mapRunMessage(messageResponse.message));
    }

    if (run.status === 'completed') {
      if (run.finalOutput?.trim()) {
        return { runId: run.id, output: run.finalOutput.trim() };
      }
      throw new Error('Child run completed with empty output');
    }

    if (run.status === 'cancelled') {
      throw new Error(run.error || 'Cancelled');
    }

    const done = this.ensureRunCompletion(run.id);
    void this.resumeRunLoop({ runId: run.id });
    const output = await done;
    return { runId: run.id, output };
  }

  async applyRunToolCallDecisions(input: {
    runId: string;
    runMessageId: string;
    decisions: Record<string, 'accept' | 'reject'>;
  }): Promise<void> {
    const runtime = useRuntimeStore.getState();
    const run = runtime.getRun(input.runId);
    if (!run) return;

    const currentRunToolCalls = runtime.getRunToolCalls(input.runMessageId);
    if (currentRunToolCalls.length === 0) return;

    const current = currentRunToolCalls.map(toToolCallMetadata);
    const running = markToolCallsRunning({
      toolCalls: current,
      decisions: input.decisions,
    });

    const options = this.getApplyHandlerOptions({
      run,
      runMessageId: input.runMessageId,
    });

    const applied = await applyToolCalls({
      projectId: run.projectId,
      language: run.language,
      toolCalls: running,
      decisions: input.decisions,
      options,
      runCaller: run.caller,
    });

    // Merge results into the latest store state (not the stale snapshot from above)
    // to prevent concurrent applyRunToolCallDecisions calls from overwriting each other.
    const appliedById = new Map(
      applied.toolCalls
        .filter((tc) => input.decisions[tc.id])
        .map((tc) => [tc.id, tc]),
    );

    const latestRunToolCalls = useRuntimeStore.getState().getRunToolCalls(input.runMessageId);
    const now = new Date().toISOString();
    const mergedToolCalls = latestRunToolCalls.map((rtc) => {
      const appliedTc = appliedById.get(rtc.llmCallId);
      if (!appliedTc) return rtc;
      // Patch only mutable fields; preserve callSeq, id, createdAt, etc.
      return {
        ...rtc,
        status: normalizeRunToolCallStatus(appliedTc.status),
        failureType: appliedTc.failureType as RunToolCall['failureType'],
        reason: appliedTc.reason,
        result: (appliedTc.result ?? undefined) as Record<string, unknown> | undefined,
        acceptedAt: appliedTc.acceptedAt ? appliedTc.acceptedAt.toISOString() : undefined,
        updatedAt: now,
      };
    });

    const persisted = await this.upsertRunToolCalls({
      projectId: run.projectId,
      agentId: run.agentId,
      runId: run.id,
      runMessageId: input.runMessageId,
      toolCalls: mergedToolCalls,
    });

    const hasPending = hasPendingOrRunning(persisted);
    const hasRejectedCalls = hasRejected(persisted);

    if (hasPending) {
      await this.patchRunStatus(run.id, 'waiting');
      return;
    }

    if (hasRejectedCalls) {
      if (run.runKind === 'child') {
        // Child runs continue with rejection info so the LLM can adapt
        if (canTransitionRunStatus(run.status, 'running')) {
          await this.patchRunStatus(run.id, 'running', { error: null });
        }
        await this.resumeRunLoop({ runId: run.id });
        return;
      }
      await this.patchRunStatus(run.id, 'paused');
      return;
    }

    if (canTransitionRunStatus(run.status, 'running')) {
      await this.patchRunStatus(run.id, 'running', { error: null });
    }

    await this.resumeRunLoop({ runId: run.id });
  }

  async pauseRun(runId: string): Promise<void> {
    const run = useRuntimeStore.getState().getRun(runId);
    if (!run) return;

    if (run.activeSessionId) {
      this.controlIntents.set(runId, 'pause');
      useLLMSessionStore.getState().cancelSession(run.activeSessionId);
    }

    if (run.status !== 'paused' && canTransitionRunStatus(run.status, 'paused')) {
      await this.patchRunStatus(runId, 'paused');
      if (run.runKind === 'child') {
        const latest = useRuntimeStore.getState().getRun(runId);
        if (latest) await this.syncParentToolCallRunning(latest);
      }
    }
  }

  async retryRun(runId: string): Promise<void> {
    const run = useRuntimeStore.getState().getRun(runId);
    if (!run) return;
    if (run.status !== 'paused' && run.status !== 'error') return;

    this.controlIntents.delete(runId);
    await this.patchRunStatus(runId, 'running', { error: null });
    void this.resumeRunLoop({ runId });
  }

  async cancelRun(runId: string): Promise<void> {
    const run = useRuntimeStore.getState().getRun(runId);
    if (!run) return;
    if (isTerminalRunStatus(run.status)) return;

    if (run.activeSessionId) {
      this.controlIntents.set(runId, 'cancel');
      useLLMSessionStore.getState().cancelSession(run.activeSessionId);
    }

    await this.patchRunStatus(runId, 'cancelled', { error: 'Cancelled' });

    const latest = useRuntimeStore.getState().getRun(runId);
    if (!latest) return;

    if (latest.runKind === 'child') {
      await this.syncParentToolCallFailed(latest, 'Cancelled');
      this.rejectRunCompletion(runId, 'Cancelled');
    }
  }

  async recoverRuns(projectId: string, agentId: string): Promise<void> {
    const response = await runService.queryRuns(projectId, agentId, {
      root_only: false,
      include_messages: true,
      include_tool_calls: true,
    });

    for (const apiRun of response.items) {
      const run = this.hydrateRunBundle(apiRun);

      if (run.status === 'running') {
        const patched = await runService.patchRun(projectId, agentId, run.id, {
          status: 'paused',
          error: 'Interrupted after refresh',
        });
        this.hydrateRunBundle(patched.run);
      }
    }

    const runs = useRuntimeStore.getState().listRuns({ projectId, agentId, runKind: 'child' });
    for (const run of runs) {
      await this.reconcileParentToolCall(run.id);
    }
  }

  async appendRunMessage(input: {
    projectId: string;
    agentId: string;
    runId: string;
    language: string;
    role: 'user' | 'assistant' | 'system';
    contentParts: Array<{ type: string; text: string }>;
    thinkingDetails?: Array<Record<string, unknown>>;
  }): Promise<RunMessage> {
    const response = await runService.addRunMessage(input.projectId, input.agentId, input.runId, {
      role: input.role,
      language: input.language,
      content_parts: input.contentParts,
      thinking_details: (input.thinkingDetails ?? []) as Array<Record<string, any>>,
    });
    const mapped = mapRunMessage(response.message);
    useRuntimeStore.getState().appendRunMessage(mapped);
    return mapped;
  }

  async patchRunStatus(
    runId: string,
    status: RunStatus,
    extras?: { finalOutput?: string | null; error?: string | null },
  ): Promise<Run> {
    const runtime = useRuntimeStore.getState();
    const run = runtime.getRun(runId);
    if (!run) {
      throw new Error(`Run not found in local runtimeStore: ${runId}`);
    }

    if (status !== run.status) {
      assertRunTransition(run.status, status);
    }

    runtime.patchRun(runId, {
      status,
      finalOutput: extras?.finalOutput ?? run.finalOutput,
      error: extras?.error ?? run.error,
    });

    const response = await runService.patchRun(run.projectId, run.agentId, run.id, {
      status,
      final_output: extras?.finalOutput ?? undefined,
      error: extras?.error ?? undefined,
    });

    return this.hydrateRunBundle(response.run);
  }

  async completeRun(runId: string, output: string): Promise<Run> {
    return this.patchRunStatus(runId, 'completed', { finalOutput: output, error: null });
  }

  async failRun(runId: string, error: string): Promise<Run> {
    return this.patchRunStatus(runId, 'error', { error });
  }

  async upsertRunToolCalls(input: {
    projectId: string;
    agentId: string;
    runId: string;
    runMessageId: string;
    toolCalls: RunToolCall[];
  }): Promise<RunToolCall[]> {
    const response = await runService.upsertRunToolCalls(
      input.projectId,
      input.agentId,
      input.runId,
      input.runMessageId,
      {
        tool_calls: input.toolCalls.map((toolCall) => ({
          llm_call_id: toolCall.llmCallId,
          call_seq: toolCall.callSeq,
          tool_name: toolCall.toolName,
          arguments: toolCall.arguments,
          status: toolCall.status,
          failure_type: toolCall.failureType ?? null,
          reason: toolCall.reason ?? null,
          result: toolCall.result ?? null,
          accepted_at: toolCall.acceptedAt ?? null,
        })),
      },
    );

    const mapped = response.tool_calls.map(mapRunToolCall);
    useRuntimeStore.getState().upsertRunToolCalls(input.runMessageId, mapped);
    return mapped;
  }

  findLatestOpenRootRunId(projectId: string, agentId: string): string | undefined {
    return useRuntimeStore.getState().findLatestOpenRootRunId(projectId, agentId);
  }

  async reconcileParentToolCall(runId: string): Promise<void> {
    const run = useRuntimeStore.getState().getRun(runId);
    if (!run || run.runKind !== 'child') return;

    if (run.status === 'completed') {
      await this.syncParentToolCallAccepted(run, run.finalOutput ?? '');
      return;
    }

    if (run.status === 'cancelled') {
      await this.syncParentToolCallFailed(run, run.error ?? 'Cancelled');
      return;
    }

    await this.syncParentToolCallRunning(run);
  }

  private hydrateRunBundle(apiRun: UnifiedRunResponse): Run {
    const runtime = useRuntimeStore.getState();
    const prev = runtime.getRun(apiRun.id);
    const mappedRun = mapRun(apiRun, prev);
    runtime.upsertRun(mappedRun);

    const mappedMessages = (apiRun.messages ?? []).map(mapRunMessage);
    runtime.replaceRunMessages(mappedRun.id, mappedMessages);

    for (const message of apiRun.messages ?? []) {
      runtime.upsertRunToolCalls(message.id, (message.tool_calls ?? []).map(mapRunToolCall));
    }

    return mappedRun;
  }

  private ensureRunCompletion(runId: string): Promise<string> {
    const existing = this.runCompletions.get(runId);
    if (existing) return existing.promise;

    let resolveFn: (output: string) => void = () => {};
    let rejectFn: (error: Error) => void = () => {};

    const promise = new Promise<string>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    this.runCompletions.set(runId, {
      promise,
      resolve: resolveFn,
      reject: rejectFn,
    });

    return promise;
  }

  private resolveRunCompletion(runId: string, output: string): void {
    const entry = this.runCompletions.get(runId);
    if (!entry) return;
    entry.resolve(output);
    this.runCompletions.delete(runId);
  }

  private rejectRunCompletion(runId: string, reason: string): void {
    const entry = this.runCompletions.get(runId);
    if (!entry) return;
    entry.reject(new Error(reason));
    this.runCompletions.delete(runId);
  }

  private consumeRunOverride(runId: string): RunOverrides | undefined {
    const entry = this.nextRunOverrides.get(runId);
    if (!entry) return undefined;
    this.nextRunOverrides.delete(runId);
    return entry;
  }

  private computeChildDepth(parentRunId: string): number {
    let depth = 0;
    let cursor: string | undefined = parentRunId;
    const runtime = useRuntimeStore.getState();

    while (cursor) {
      const run = runtime.getRun(cursor);
      if (!run) break;
      if (run.runKind === 'child') depth += 1;
      cursor = run.parentRunId;
      if (depth > 100) break;
    }

    return depth;
  }

  private getRunHistory(runId: string, historyOverride?: ChatMessage[]): ChatMessage[] {
    if (historyOverride && historyOverride.length > 0) {
      return [...historyOverride];
    }

    const runtime = useRuntimeStore.getState();
    const run = runtime.getRun(runId);
    const language = run?.language ?? 'English';
    const messages = runtime.getRunMessages(runId);
    return messages.map((message) => {
      const toolCalls = runtime.getRunToolCalls(message.id);
      return toChatMessage({ message, toolCalls, language });
    });
  }

  private async loadRootRunTools(run: Run): Promise<ToolCallSchema[] | undefined> {
    const settings = useSettingsStore.getState().getSettings();
    const toolSet = run.runMode === 'planMode' ? 'agent_plan_mode' : 'agent_agent_mode';
    const baseTools = settings.nativeOutputMode
      ? undefined
      : getToolsForSet(toolSet, { ragSearchEnabled: settings.ragSearchEnabled });

    if (settings.nativeOutputMode) {
      return baseTools;
    }

    await useSubAgentStore.getState().ensureLoaded();

    const dynamicSubAgentTools = useSubAgentStore.getState().subAgents
      .filter((subAgent) => subAgent.enabled && subAgent.allowed_invocation_modes.includes(run.caller))
      .sort((left, right) => left.display_name.localeCompare(right.display_name))
      .map(buildCallToolSchema);

    return [...(baseTools ?? []), ...dynamicSubAgentTools];
  }

  private async loadChildRunTools(run: Run): Promise<ToolCallSchema[]> {
    if (!run.subAgentId) {
      throw new Error('Missing subAgentId for child run');
    }

    await useSubAgentStore.getState().ensureLoaded();

    const subAgentState = useSubAgentStore.getState();
    const definition = subAgentState.subAgents.find((s) => s.id === run.subAgentId);
    if (!definition) {
      throw new Error(`Sub Agent not found: ${run.subAgentId}`);
    }

    if (!definition.enabled) {
      throw new Error(`Sub Agent is disabled: ${run.subAgentId}`);
    }

    if (!definition.allowed_invocation_modes.includes(run.caller)) {
      throw new Error(`Sub Agent not allowed from caller: ${run.caller}`);
    }

    const schemas: ToolCallSchema[] = [];

    for (const name of definition.allowed_tool_names) {
      if (name.startsWith('call_')) continue;
      const schema = schemaRegistry.get(name);
      if (!schema) {
        throw new Error(`Unsupported tool in allowlist: ${name}`);
      }
      schemas.push({
        name: schema.name,
        description: schema.description,
        parameters: schema.parameters,
      });
    }

    for (const subAgentId of definition.allowed_sub_agent_ids ?? []) {
      if (subAgentId === definition.id) continue;
      const target = subAgentState.subAgents.find((s) => s.id === subAgentId);
      if (!target || !target.enabled) continue;
      schemas.push(buildCallToolSchema(target));
    }

    return schemas;
  }

  private getApplyHandlerOptions(params: {
    run: Run;
    runMessageId: string;
  }): {
    createNewVersion?: boolean;
    userRequest?: string;
    agentId?: string;
    parentSubRunId?: string;
    parentSubMessageId?: string;
  } {
    const { run, runMessageId } = params;

    return {
      userRequest: run.runKind === 'child' ? 'SubAgent' : 'Agent',
      agentId: run.agentId,
      parentSubRunId: run.id,
      parentSubMessageId: runMessageId,
    };
  }

  private async buildRunExecutionConfig(run: Run, overrides?: RunOverrides): Promise<RunExecutionConfig> {
    const settingsStore = useSettingsStore.getState();
    const settings = settingsStore.getSettings();
    const credentialsStore = useCredentialsStore.getState();

    const outputMode = settings.nativeOutputMode ? 'native_tool_call' : 'tool_call';

    if (run.runKind === 'root') {
      const agentConfig = settingsStore.getTaskConfig('agent');
      const providerConfig = credentialsStore.getProviderConfigForBackend(agentConfig.provider);
      const llmMode = run.runMode === 'planMode'
        ? LLMTaskMode.AGENT_PLAN_MODE
        : LLMTaskMode.AGENT_AGENT_MODE;

      let frozenProjectData = run.frozenProjectData;
      if (!frozenProjectData) {
        const snapshot = useAgentPromptSnapshotStore.getState().get(run.projectId, run.agentId);
        frozenProjectData = snapshot?.projectData ?? PromptManager.buildProjectData(run.projectId, run.language);
      }

      const toolSchemas = await this.loadRootRunTools(run);
      const promptContext: AgentPromptContext = {
        projectId: run.projectId,
        outputLanguage: run.language,
        outputMode,
        enable_prefill: agentConfig.advanced.enable_prefill,
        thinking_mode: agentConfig.advanced.thinking_mode,
        runMode: run.runMode ?? 'agentMode',
        surface: run.surface ?? 'story-object',
        contextObjectIds: run.contextObjectIds,
        frozenProjectData: frozenProjectData as any,
        tools: toolSchemas,
        ...(overrides?.promptContextOverride ?? {}),
      };

      useRuntimeStore.getState().patchRun(run.id, {
        frozenProjectData,
      });

      return {
        mode: llmMode,
        label: 'AI Response',
        kind: 'agent',
        provider: agentConfig.provider,
        providerConfig,
        model: agentConfig.model,
        temperature: agentConfig.temperature,
        thinkingMode: agentConfig.advanced.thinking_mode,
        thinkingConfig: agentConfig.advanced.thinking_config,
        requestFormat: agentConfig.advanced.request_format,
        thinkingFormat: agentConfig.advanced.thinking_format,
        history: this.getRunHistory(run.id, overrides?.historyOverride),
        promptContext,
        toolSchemas,
      };
    }

    const subAgentConfig = settingsStore.getTaskConfig('subAgent');
    const providerConfig = credentialsStore.getProviderConfigForBackend(subAgentConfig.provider);
    const toolSchemas = await this.loadChildRunTools(run);

    let frozenProjectData = run.frozenProjectData;
    if (!frozenProjectData) {
      frozenProjectData = PromptManager.buildProjectData(run.projectId, run.language);
    }

    const subAgentStore = useSubAgentStore.getState();
    const definition = run.subAgentId ? subAgentStore.getById(run.subAgentId) : undefined;

    const effectiveConfig = definition?.use_custom_llm_config && definition.llm_config_override
      ? definition.llm_config_override
      : subAgentConfig;

    const promptContext: SubAgentPromptContext = {
      projectId: run.projectId,
      outputLanguage: run.language,
      outputMode,
      enable_prefill: effectiveConfig.advanced.enable_prefill,
      thinking_mode: effectiveConfig.advanced.thinking_mode,
      tools: toolSchemas,
      frozenProjectData: frozenProjectData as any,
      agentName: definition?.agent_name ?? 'sub_agent',
      ...(overrides?.promptContextOverride ?? {}),
    };

    useRuntimeStore.getState().patchRun(run.id, {
      frozenProjectData,
    });

    return {
      mode: LLMTaskMode.SUB_AGENT,
      label: 'Sub Agent',
      kind: 'subAgent',
      provider: effectiveConfig.provider,
      providerConfig,
      model: effectiveConfig.model,
      temperature: effectiveConfig.temperature,
      thinkingMode: effectiveConfig.advanced.thinking_mode,
      thinkingConfig: effectiveConfig.advanced.thinking_config,
      requestFormat: effectiveConfig.advanced.request_format,
      thinkingFormat: effectiveConfig.advanced.thinking_format,
      history: this.getRunHistory(run.id, overrides?.historyOverride),
      promptContext,
      toolSchemas,
    };
  }

  private async executeRunStep(runId: string): Promise<RunStepResult> {
    const runtime = useRuntimeStore.getState();
    const run = runtime.getRun(runId);
    if (!run) {
      return { action: 'error', error: 'Run not found' };
    }

    const overrides = this.consumeRunOverride(runId);
    const executionConfig = await this.buildRunExecutionConfig(run, overrides);

    const handle = startLLMSession({
      kind: executionConfig.kind,
      label: executionConfig.label,
      input: {
        projectId: run.projectId,
        agentId: run.agentId,
        runId: run.id,
        runKind: run.runKind,
        runMode: run.runMode,
        surface: run.surface,
        userInput: run.inputText,
      },
      mode: executionConfig.mode,
      projectId: run.projectId,
      promptContext: executionConfig.promptContext,
      provider: executionConfig.provider as any,
      providerConfig: executionConfig.providerConfig as any,
      model: executionConfig.model,
      temperature: executionConfig.temperature,
      thinking_mode: executionConfig.thinkingMode,
      thinking_config: executionConfig.thinkingConfig as any,
      request_format: executionConfig.requestFormat as any,
      thinking_format: executionConfig.thinkingFormat as any,
      retryConfig: useSettingsStore.getState().getSettings().retryConfig,
      history: executionConfig.history,
    });

    runtime.patchRun(run.id, {
      activeSessionId: handle.sessionId,
      runStepCount: (run.runStepCount ?? 0) + 1,
      error: undefined,
    });

    const timeout = new Promise<{ type: 'timeout' }>((resolve) => {
      setTimeout(() => resolve({ type: 'timeout' }), RUN_TIMEOUT_MS);
    });

    const completion = await Promise.race([
      handle.done.then((session) => ({ type: 'session' as const, session })),
      timeout,
    ]);

    runtime.patchRun(run.id, { activeSessionId: null });

    if (completion.type === 'timeout') {
      useLLMSessionStore.getState().cancelSession(handle.sessionId);
      return { action: 'error', error: `Run timed out after ${RUN_TIMEOUT_MS}ms` };
    }

    const finalSession = completion.session;

    if (finalSession.status !== 'success') {
      const intent = this.controlIntents.get(run.id);
      if (intent === 'pause') {
        this.controlIntents.delete(run.id);
        return { action: 'paused' };
      }
      if (intent === 'cancel') {
        this.controlIntents.delete(run.id);
        return { action: 'cancelled' };
      }

      if (finalSession.status === 'cancelled') {
        return { action: 'cancelled' };
      }

      return {
        action: 'error',
        error: finalSession.error ?? 'LLM session failed.',
      };
    }

    const assistantContentParts = (finalSession.contentParts ?? []) as Array<{ type: string; text: string }>;
    const thinkingDetails = (finalSession.thinkingDetails ?? []) as Array<Record<string, unknown>>;

    const runMessage = await this.appendRunMessage({
      projectId: run.projectId,
      agentId: run.agentId,
      runId: run.id,
      language: run.language,
      role: 'assistant',
      contentParts: assistantContentParts,
      thinkingDetails,
    });

    const toolCalls = ((finalSession.toolCalls ?? []) as ToolCallMetadata[]).map((toolCall) => ({
      ...toolCall,
      status: toolCall.status ?? 'pending',
    }));

    if (toolCalls.length === 0) {
      const output = getMessageText(assistantContentParts).trim();
      if (run.runKind === 'child' && !output) {
        return { action: 'error', error: 'Empty child output' };
      }
      return { action: 'completed', output };
    }

    return this.processRunToolCalls({
      run,
      runMessageId: runMessage.id,
      toolCalls,
      toolSchemas: executionConfig.toolSchemas,
    });
  }

  private async processRunToolCalls(params: {
    run: Run;
    runMessageId: string;
    toolCalls: ToolCallMetadata[];
    toolSchemas: ToolCallSchema[] | undefined;
  }): Promise<RunStepResult> {
    const { run, runMessageId, toolCalls, toolSchemas } = params;
    const settings = useSettingsStore.getState().getSettings();

    const staged = await stageToolCalls({
      projectId: run.projectId,
      language: run.language,
      toolCalls,
      allowedToolNames: getAllowedToolNames(toolSchemas),
    });

    await this.upsertRunToolCalls({
      projectId: run.projectId,
      agentId: run.agentId,
      runId: run.id,
      runMessageId,
      toolCalls: toRunToolCalls({
        runId: run.id,
        runMessageId,
        toolCalls: staged.toolCalls,
      }),
    });

    const options = this.getApplyHandlerOptions({
      run,
      runMessageId,
    });

    const { decisions: autoDecisions } = buildAutoApproveDecisions({
      toolCalls: staged.toolCalls,
      config: settings.toolCallAutoApprove,
    });

    let finalToolCalls = staged.toolCalls;
    if (Object.keys(autoDecisions).length > 0) {
      const runningToolCalls = markToolCallsRunning({
        toolCalls: staged.toolCalls,
        decisions: autoDecisions,
      });

      await this.upsertRunToolCalls({
        projectId: run.projectId,
        agentId: run.agentId,
        runId: run.id,
        runMessageId,
        toolCalls: toRunToolCalls({
          runId: run.id,
          runMessageId,
          toolCalls: runningToolCalls,
        }),
      });

      const applied = await applyToolCalls({
        projectId: run.projectId,
        language: run.language,
        toolCalls: runningToolCalls,
        decisions: autoDecisions,
        options,
        runCaller: run.caller,
      });

      finalToolCalls = applied.toolCalls;

      await this.upsertRunToolCalls({
        projectId: run.projectId,
        agentId: run.agentId,
        runId: run.id,
        runMessageId,
        toolCalls: toRunToolCalls({
          runId: run.id,
          runMessageId,
          toolCalls: finalToolCalls,
        }),
      });
    }

    const state = evaluateToolCallAutoContinue(finalToolCalls);
    if (state.hasPending) {
      return { action: 'waiting' };
    }

    if (state.hasRejected) {
      return { action: 'paused' };
    }

    return { action: 'continue' };
  }

  private async runLoop(runId: string): Promise<void> {
    while (true) {
      const runtime = useRuntimeStore.getState();
      const run = runtime.getRun(runId);
      if (!run) return;

      if (isTerminalRunStatus(run.status)) {
        if (run.runKind === 'child') {
          if (run.status === 'completed' && run.finalOutput?.trim()) {
            this.resolveRunCompletion(run.id, run.finalOutput.trim());
          } else if (run.status === 'cancelled') {
            this.rejectRunCompletion(run.id, run.error || 'Cancelled');
          }
        }
        return;
      }

      if (run.status !== 'running') {
        await this.patchRunStatus(run.id, 'running', { error: null });
      }

      const latestRunning = useRuntimeStore.getState().getRun(run.id);
      if (!latestRunning) return;
      if (latestRunning.runKind === 'child') {
        await this.syncParentToolCallRunning(latestRunning);
      }

      const result = await this.executeRunStep(run.id);
      const latest = useRuntimeStore.getState().getRun(run.id);
      if (!latest) return;

      if (result.action === 'completed') {
        const output = result.output?.trim() ?? '';
        if (!output && latest.runKind === 'child') {
          const error = 'Empty child output';
          await this.patchRunStatus(latest.id, 'error', { error });
          await this.syncParentToolCallFailed(latest, error);
          this.rejectRunCompletion(latest.id, error);
          return;
        }

        await this.patchRunStatus(latest.id, 'completed', {
          finalOutput: output,
          error: null,
        });

        const completedRun = useRuntimeStore.getState().getRun(latest.id);
        if (completedRun?.runKind === 'child') {
          await this.syncParentToolCallAccepted(completedRun, output);
          this.resolveRunCompletion(completedRun.id, output);
        }

        return;
      }

      if (result.action === 'continue') {
        continue;
      }

      if (result.action === 'waiting') {
        await this.patchRunStatus(latest.id, 'waiting');
        return;
      }

      if (result.action === 'paused') {
        if (latest.runKind === 'child') {
          // Child runs auto-continue with rejection info so the LLM can adapt
          continue;
        }

        await this.patchRunStatus(latest.id, 'paused');
        return;
      }

      if (result.action === 'cancelled') {
        await this.patchRunStatus(latest.id, 'cancelled', { error: 'Cancelled' });

        const cancelledRun = useRuntimeStore.getState().getRun(latest.id);
        if (cancelledRun?.runKind === 'child') {
          await this.syncParentToolCallFailed(cancelledRun, 'Cancelled');
          this.rejectRunCompletion(cancelledRun.id, 'Cancelled');
        }
        return;
      }

      const errorMessage = result.error || 'Run failed';
      await this.patchRunStatus(latest.id, 'error', { error: errorMessage });

      const failedRun = useRuntimeStore.getState().getRun(latest.id);
      if (failedRun?.runKind === 'child') {
        await this.syncParentToolCallFailed(failedRun, errorMessage);
        this.rejectRunCompletion(failedRun.id, errorMessage);
      }
      return;
    }
  }

  private async updateParentToolCall(params: {
    run: Run;
    patch: (toolCall: RunToolCall) => RunToolCall;
  }): Promise<void> {
    const { run, patch } = params;
    if (!run.parentRunId || !run.parentRunMessageId || !run.parentRunToolCallId) return;

    const parentMessageId = run.parentRunMessageId;

    // Serialize concurrent updates to the same parent message's tool calls
    // to prevent read-modify-write race conditions between parallel child runs.
    const prev = this.parentToolCallLocks.get(parentMessageId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const tail = prev.then(() => next);
    this.parentToolCallLocks.set(parentMessageId, tail);

    await prev;
    try {
      const runtime = useRuntimeStore.getState();
      const parentRun = runtime.getRun(run.parentRunId);
      if (!parentRun) return;

      const current = runtime.getRunToolCalls(parentMessageId);

      let changed = false;
      const patched = current.map((toolCall) => {
        if (toolCall.llmCallId !== run.parentRunToolCallId) return toolCall;
        changed = true;
        return patch(toolCall);
      });

      if (!changed) {
        patched.push(
          patch({
            id: `${parentMessageId}:${run.parentRunToolCallId}`,
            runId: parentRun.id,
            messageId: parentMessageId,
            llmCallId: run.parentRunToolCallId,
            callSeq: patched.length + 1,
            toolName: 'call_sub_agent',
            arguments: {},
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        );
      }

      await this.upsertRunToolCalls({
        projectId: parentRun.projectId,
        agentId: parentRun.agentId,
        runId: parentRun.id,
        runMessageId: parentMessageId,
        toolCalls: patched,
      });
    } finally {
      release();
      if (this.parentToolCallLocks.get(parentMessageId) === tail) {
        this.parentToolCallLocks.delete(parentMessageId);
      }
    }
  }

  private async syncParentToolCallRunning(run: Run): Promise<void> {
    await this.updateParentToolCall({
      run,
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

  private async syncParentToolCallAccepted(run: Run, output: string): Promise<void> {
    const result: ApplicationResult = {
      success: true,
      message: output,
      data: {
        childRunId: run.id,
        subAgentId: run.subAgentId,
      },
    };

    await this.updateParentToolCall({
      run,
      patch: (toolCall) => ({
        ...toolCall,
        status: 'accepted',
        reason: undefined,
        failureType: undefined,
        result: result as any,
        acceptedAt: new Date().toISOString(),
      }),
    });
  }

  private async syncParentToolCallFailed(run: Run, reason: string): Promise<void> {
    const result: ApplicationResult = {
      success: false,
      message: `Error executing child run (${run.subAgentId ?? 'sub-agent'})`,
      error: reason,
      data: {
        childRunId: run.id,
        subAgentId: run.subAgentId,
      },
    };

    await this.updateParentToolCall({
      run,
      patch: (toolCall) => ({
        ...toolCall,
        status: 'failed',
        reason,
        failureType: 'execution',
        result: result as any,
        acceptedAt: undefined,
      }),
    });
  }
}

export const runtimeOrchestrator = new DefaultRuntimeOrchestrator();
