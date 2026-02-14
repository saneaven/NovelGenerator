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
import { useLLMSessionStore } from '../store/llmSessionStore';
import { startLLMSession } from '../llmSession';
import type { ToolCallMetadata } from '../llm/requestTypes';
import type { ToolCallSchema } from '../toolCall';
import {
  stageToolCalls,
  applyToolCalls,
  markToolCallsRunning,
  buildAutoApproveDecisions,
} from '../toolCall/runtime';
import { evaluateToolCallAutoContinue } from '../agent/utils/autoContinuePolicy';
import type { ApplicationResult } from '../toolCall/types';
import { buildRunContext, prepareRunMemory } from './context/RunContextBuilder';
import type { MemoryPreflightStage } from './context/types';

const MAX_CHILD_DEPTH = 3;

type RunControlIntent = 'pause' | 'cancel';
type RunStepAction = 'completed' | 'continue' | 'waiting' | 'paused' | 'error' | 'cancelled';

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
    memoryContext: prev?.memoryContext,
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
    signal?: AbortSignal;
    onMemoryStageChange?: (stage: MemoryPreflightStage) => void;
  }): Promise<{ runId: string }> {
    // Prepare memory before creating the run (archive/RAG/summarize)
    const memoryContext = await prepareRunMemory({
      projectId: input.projectId,
      agentId: input.agentId,
      runMode: input.runMode,
      surface: input.surface,
      userInput: input.userInput,
      language: input.language,
      contextObjectIds: input.contextObjectIds,
      signal: input.signal,
      onStageChange: input.onMemoryStageChange,
    });

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

    // Store memoryContext on the run
    useRuntimeStore.getState().patchRun(run.id, { memoryContext });

    if (input.userInput.trim()) {
      const runMessageResponse = await runService.addRunMessage(input.projectId, input.agentId, run.id, {
        role: 'user',
        language: input.language,
        content_parts: [{ type: 'content', text: input.userInput }],
        thinking_details: [],
      });
      useRuntimeStore.getState().appendRunMessage(mapRunMessage(runMessageResponse.message));
    }

    void this.resumeRunLoop({ runId: run.id });

    return { runId: run.id };
  }

  async resumeRunLoop(input: {
    runId: string;
    refreshMemory?: boolean;
    signal?: AbortSignal;
    onMemoryStageChange?: (stage: MemoryPreflightStage) => void;
  }): Promise<void> {
    const run = useRuntimeStore.getState().getRun(input.runId);
    if (!run) return;

    // Refresh memory if requested (e.g., auto-continue after tool acceptance)
    if (input.refreshMemory && run.runKind === 'root') {
      const refreshedMemory = await prepareRunMemory({
        projectId: run.projectId,
        agentId: run.agentId,
        runMode: run.runMode ?? 'agentMode',
        surface: run.surface ?? 'story-object',
        userInput: run.inputText,
        language: run.language,
        contextObjectIds: run.contextObjectIds,
        signal: input.signal,
        onStageChange: input.onMemoryStageChange,
      });
      useRuntimeStore.getState().patchRun(input.runId, { memoryContext: refreshedMemory });
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

    // Prepare sub-agent memory (archive/RAG/summarize with owner_id = subAgentId)
    const childMemoryContext = await prepareRunMemory({
      projectId: input.projectId,
      agentId: input.agentId,
      runMode: 'agentMode',
      surface: 'story-object',
      userInput: input.inputText,
      language: input.language,
      subAgentId: input.subAgentId,
    });

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

    // Store memoryContext on the child run
    useRuntimeStore.getState().patchRun(run.id, { memoryContext: childMemoryContext });

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

    // PATCH only the decided tool calls — other tool calls are left untouched in the DB,
    // preventing concurrent decisions (e.g. sub-agent completion) from being overwritten.
    const decidedToolCalls = applied.toolCalls.filter((tc) => input.decisions[tc.id]);
    const decidedRunToolCalls = toRunToolCalls({
      runId: run.id,
      runMessageId: input.runMessageId,
      toolCalls: decidedToolCalls,
    });

    const persisted = await this.patchRunToolCalls({
      projectId: run.projectId,
      agentId: run.agentId,
      runId: run.id,
      runMessageId: input.runMessageId,
      toolCalls: decidedRunToolCalls,
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

    // Short-circuit: if return_sub_agent_result was accepted, complete the child run immediately
    const returnResultAccepted = persisted.find(
      (tc) => tc.toolName === 'return_sub_agent_result' && tc.status === 'accepted'
    );
    if (returnResultAccepted && run.runKind === 'child') {
      const output = (returnResultAccepted.result as any)?.message ?? '';
      await this.patchRunStatus(run.id, 'completed', { finalOutput: output, error: null });
      const completedRun = useRuntimeStore.getState().getRun(run.id);
      if (completedRun) {
        await this.syncParentToolCallAccepted(completedRun, output);
        this.resolveRunCompletion(completedRun.id, output);
        await this.tryResumeParentRun(completedRun);
      }
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

  async patchRunToolCalls(input: {
    projectId: string;
    agentId: string;
    runId: string;
    runMessageId: string;
    toolCalls: RunToolCall[];
  }): Promise<RunToolCall[]> {
    const response = await runService.patchRunToolCalls(
      input.projectId,
      input.agentId,
      input.runId,
      input.runMessageId,
      {
        tool_calls: input.toolCalls.map((toolCall) => ({
          llm_call_id: toolCall.llmCallId,
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

  private async executeRunStep(runId: string): Promise<RunStepResult> {
    const runtime = useRuntimeStore.getState();
    const run = runtime.getRun(runId);
    if (!run) {
      return { action: 'error', error: 'Run not found' };
    }

    const { executionConfig } = await buildRunContext(run);

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
      tool_choice: executionConfig.toolChoice,
      history: executionConfig.history,
    });

    runtime.patchRun(run.id, {
      activeSessionId: handle.sessionId,
      runStepCount: (run.runStepCount ?? 0) + 1,
      error: undefined,
    });

    const finalSession = await handle.done;

    runtime.patchRun(run.id, { activeSessionId: null });

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

      // PATCH only auto-decided tool calls to 'running' status
      const decidedRunning = toRunToolCalls({ runId: run.id, runMessageId, toolCalls: runningToolCalls })
        .filter((rtc) => autoDecisions[rtc.llmCallId]);
      await this.patchRunToolCalls({
        projectId: run.projectId,
        agentId: run.agentId,
        runId: run.id,
        runMessageId,
        toolCalls: decidedRunning,
      });

      const applied = await applyToolCalls({
        projectId: run.projectId,
        language: run.language,
        toolCalls: runningToolCalls,
        decisions: autoDecisions,
        options,
        runCaller: run.caller,
      });

      // PATCH only auto-decided tool calls with their final status.
      // This avoids overwriting concurrent user decisions made while a sub-agent was running.
      const decidedApplied = toRunToolCalls({ runId: run.id, runMessageId, toolCalls: applied.toolCalls })
        .filter((rtc) => autoDecisions[rtc.llmCallId]);
      const persisted = await this.patchRunToolCalls({
        projectId: run.projectId,
        agentId: run.agentId,
        runId: run.id,
        runMessageId,
        toolCalls: decidedApplied,
      });

      // Use the PATCH response (latest DB state) for evaluation,
      // not the stale applied.toolCalls snapshot.
      finalToolCalls = persisted.map(toToolCallMetadata);
    }

    // Short-circuit: if return_sub_agent_result was accepted, complete the run immediately
    const returnResultCall = finalToolCalls.find(
      (tc) => tc.tool_name === 'return_sub_agent_result' && tc.status === 'accepted'
    );
    if (returnResultCall) {
      return { action: 'completed', output: returnResultCall.result?.message ?? '' };
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
          await this.tryResumeParentRun(completedRun);
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
    // to prevent out-of-order PATCH responses from overwriting each other in the store.
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
      const existing = current.find((tc) => tc.llmCallId === run.parentRunToolCallId);

      if (existing) {
        // Normal case: PATCH only this tool call, leaving others untouched in the DB.
        await this.patchRunToolCalls({
          projectId: parentRun.projectId,
          agentId: parentRun.agentId,
          runId: parentRun.id,
          runMessageId: parentMessageId,
          toolCalls: [patch(existing)],
        });
      } else {
        // Edge case: tool call not in store yet — create via full upsert.
        const newToolCall = patch({
          id: `${parentMessageId}:${run.parentRunToolCallId}`,
          runId: parentRun.id,
          messageId: parentMessageId,
          llmCallId: run.parentRunToolCallId,
          callSeq: current.length + 1,
          toolName: 'call_sub_agent',
          arguments: {},
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        await this.upsertRunToolCalls({
          projectId: parentRun.projectId,
          agentId: parentRun.agentId,
          runId: parentRun.id,
          runMessageId: parentMessageId,
          toolCalls: [...current, newToolCall],
        });
      }
    } finally {
      release();
      if (this.parentToolCallLocks.get(parentMessageId) === tail) {
        this.parentToolCallLocks.delete(parentMessageId);
      }
    }
  }

  private async tryResumeParentRun(childRun: Run): Promise<void> {
    if (!childRun.parentRunId || !childRun.parentRunMessageId) return;

    // If there's an active in-memory listener, the normal promise-based flow handles it
    if (this.runCompletions.has(childRun.id)) return;

    const runtime = useRuntimeStore.getState();
    const parentRun = runtime.getRun(childRun.parentRunId);
    if (!parentRun) return;

    // Only resume if parent is stuck (paused/waiting/error — i.e. lost its run loop after refresh)
    if (parentRun.status !== 'paused' && parentRun.status !== 'waiting' && parentRun.status !== 'error') return;

    // Check if all tool calls in the parent message are resolved
    const parentToolCalls = runtime.getRunToolCalls(childRun.parentRunMessageId);
    if (parentToolCalls.length === 0) return;

    const hasPendingOrRunningCalls = parentToolCalls.some(
      (tc) => tc.status === 'pending' || tc.status === 'running'
    );
    if (hasPendingOrRunningCalls) return;

    // All tool calls resolved — resume the parent run loop
    if (canTransitionRunStatus(parentRun.status, 'running')) {
      await this.patchRunStatus(parentRun.id, 'running', { error: null });
    }
    void this.resumeRunLoop({ runId: parentRun.id });
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
