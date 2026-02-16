import { runExecutionService, type RunExecutionEvent, type StreamHandle } from '../api/runExecutionService';
import { useRuntimeStore } from './store/runtimeStore';
import type {
  Run,
  RunMessage,
  RunStatus,
  RunToolCall,
  RuntimeOrchestrator,
} from './types';

type ToolDecision = 'accept' | 'reject';

function nowIso(): string {
  return new Date().toISOString();
}

function isTerminalStatus(status: RunStatus): boolean {
  return status === 'completed' || status === 'error' || status === 'cancelled';
}

function mapBackendRun(apiRun: any, prev?: Run): Run {
  const runTypeRaw = String(apiRun?.run_type ?? '');
  const runType = runTypeRaw === 'subAgent' || runTypeRaw === 'journey' ? runTypeRaw : 'agent';
  const runMode = apiRun?.run_mode === 'planMode' || apiRun?.run_mode === 'agentMode' ? apiRun.run_mode : undefined;

  return {
    id: String(apiRun.id),
    projectId: String(apiRun.project_id),
    agentId: apiRun.agent_id ? String(apiRun.agent_id) : '',
    runType,
    status: apiRun.status as RunStatus,
    language: String(apiRun.language || 'English'),
    inputText: String(apiRun.input_text || ''),
    inputPayload: (apiRun.input_payload && typeof apiRun.input_payload === 'object') ? apiRun.input_payload : undefined,
    finalOutput: apiRun.final_output ?? undefined,
    error: apiRun.error ?? undefined,
    runMode: runType === 'agent' ? runMode : undefined,
    surface: apiRun.surface ?? undefined,
    contextObjectIds: Array.isArray(apiRun.context_object_ids) ? apiRun.context_object_ids : [],
    journeyKind: runType === 'journey' ? apiRun.journey_kind ?? undefined : undefined,
    journeyTargetIds: Array.isArray(apiRun.journey_target_ids) ? apiRun.journey_target_ids : [],
    parentRunId: apiRun.parent_run_id ?? undefined,
    parentRunMessageId: apiRun.parent_run_message_id ?? undefined,
    parentRunToolCallId: apiRun.parent_run_tool_call_id ?? undefined,
    subAgentId: apiRun.sub_agent_id ?? undefined,
    rootRunSeq: typeof apiRun.root_run_seq === 'number' ? apiRun.root_run_seq : undefined,
    nextMessageSeq: Number(apiRun.next_message_seq ?? prev?.nextMessageSeq ?? 1),
    runStepCount: prev?.runStepCount ?? 0,
    activeSessionId: null,
    frozenProjectData: apiRun.frozen_context?.project_data ?? prev?.frozenProjectData,
    memoryContext: prev?.memoryContext ?? null,
    createdAt: apiRun.created_at ?? prev?.createdAt ?? nowIso(),
    updatedAt: apiRun.updated_at ?? nowIso(),
  };
}

function normalizeDecisionKey(id: string): string {
  if (!id.includes(':')) return id;
  return id.split(':').pop() || id;
}

function mapToolCalls(runId: string, messageId: string, rawCalls: any[] | undefined): RunToolCall[] {
  const now = nowIso();
  const items = Array.isArray(rawCalls) ? rawCalls : [];
  return items.map((row, idx) => ({
    id: `${messageId}:${String(row?.id ?? idx + 1)}`,
    runId,
    messageId,
    llmCallId: String(row?.id ?? idx + 1),
    callSeq: Number(row?.call_seq ?? idx + 1),
    toolName: String(row?.tool_name ?? ''),
    arguments: (row?.arguments && typeof row.arguments === 'object' ? row.arguments : {}) as Record<string, unknown>,
    status: (row?.status ?? 'pending') as RunToolCall['status'],
    failureType: row?.failure_type ?? undefined,
    reason: row?.reason ?? undefined,
    result: row?.result ?? undefined,
    acceptedAt: row?.accepted_at ?? undefined,
    createdAt: row?.created_at ?? now,
    updatedAt: row?.updated_at ?? now,
  }));
}

class DefaultRuntimeOrchestrator implements RuntimeOrchestrator {
  private readonly streamByRunId = new Map<string, StreamHandle>();
  private readonly deltaMessageIdByRunId = new Map<string, string>();
  private readonly lastEventSeqByRunId = new Map<string, number>();

  private getLastEventSeq(runId: string): number | undefined {
    return this.lastEventSeqByRunId.get(runId);
  }

  private async ensureRunLoaded(projectId: string, runId: string): Promise<Run | undefined> {
    const runtime = useRuntimeStore.getState();
    const existing = runtime.getRun(runId);
    if (existing) return existing;

    try {
      const response = await runExecutionService.getRun(projectId, runId);
      const nextRun = mapBackendRun(response.run, existing);
      runtime.upsertRun(nextRun);
      return nextRun;
    } catch (error) {
      console.error('[RuntimeOrchestrator] Failed to load run state:', error);
      return undefined;
    }
  }

  private bindStream(runId: string, handle: StreamHandle): void {
    const current = this.streamByRunId.get(runId);
    if (current) {
      current.abort();
    }
    this.streamByRunId.set(runId, handle);
    void handle.done
      .catch((error) => {
        console.error('[RuntimeOrchestrator] stream failed:', error);
      })
      .finally(() => {
        if (this.streamByRunId.get(runId) === handle) {
          this.streamByRunId.delete(runId);
        }
      });
  }

  private handleToolCallsEvent(runId: string, payload: any): void {
    const runtime = useRuntimeStore.getState();
    const messageId = String(payload?.message_id ?? '');
    if (!messageId) return;
    const mapped = mapToolCalls(runId, messageId, payload?.tool_calls);
    runtime.upsertRunToolCalls(messageId, mapped);
  }

  private handleLlmFinal(runId: string, envelope: any): void {
    const runtime = useRuntimeStore.getState();
    const run = runtime.getRun(runId);
    if (!run) return;

    const deltaMessageId = this.deltaMessageIdByRunId.get(runId);
    if (deltaMessageId) {
      runtime.removeRunMessage(runId, deltaMessageId);
      this.deltaMessageIdByRunId.delete(runId);
    }

    const payload = envelope?.payload ?? {};
    const messageId = String(payload?.message_id ?? '');
    if (!messageId) return;

    const contentParts = Array.isArray(payload.content_parts) ? payload.content_parts : [];
    const thinkingDetails = Array.isArray(payload.thinking_details) ? payload.thinking_details : [];
    const createdAt = envelope?.ts ?? nowIso();

    const existingMessages = runtime.getRunMessages(runId);
    const existing = existingMessages.find((m) => m.id === messageId);
    const nextMessage: RunMessage = {
      id: messageId,
      runId,
      seq: existing?.seq ?? existingMessages.length + 1,
      role: 'assistant',
      data: {
        [run.language]: {
          contentParts,
          thinkingDetails,
        },
      },
      createdAt,
    };

    if (existing) {
      runtime.patchRunMessage(runId, messageId, nextMessage);
    } else {
      runtime.appendRunMessage(nextMessage);
    }

    if (Array.isArray(payload?.tool_calls) && payload.tool_calls.length > 0) {
      const provisional = mapToolCalls(runId, messageId, payload.tool_calls);
      runtime.upsertRunToolCalls(messageId, provisional);
    }
  }

  private handleLlmDelta(runId: string, envelope: any): void {
    const runtime = useRuntimeStore.getState();
    const run = runtime.getRun(runId);
    if (!run) return;

    const payload = envelope?.payload ?? {};
    const contentDelta = typeof payload?.content_delta === 'string' ? payload.content_delta : '';
    const thinkingDelta = typeof payload?.thinking_delta === 'string' ? payload.thinking_delta : '';
    const deltaText = contentDelta || thinkingDelta;
    if (!deltaText) return;

    let messageId = this.deltaMessageIdByRunId.get(runId);
    if (!messageId) {
      messageId = `delta:${runId}`;
      this.deltaMessageIdByRunId.set(runId, messageId);
      const existingMessages = runtime.getRunMessages(runId);
      runtime.appendRunMessage({
        id: messageId,
        runId,
        seq: existingMessages.length + 1,
        role: 'assistant',
        data: {
          [run.language]: {
            contentParts: [{ type: 'content', text: deltaText }],
            thinkingDetails: [],
          },
        },
        createdAt: envelope?.ts ?? nowIso(),
      });
      return;
    }

    const existingMessages = runtime.getRunMessages(runId);
    const message = existingMessages.find((m) => m.id === messageId);
    const langEntry = message?.data?.[run.language];
    const parts = Array.isArray(langEntry?.contentParts) ? langEntry.contentParts : [];
    const last = parts[parts.length - 1];
    const mergedParts =
      last && last.type === 'content'
        ? [...parts.slice(0, -1), { type: 'content', text: `${String(last.text || '')}${deltaText}` }]
        : [...parts, { type: 'content', text: deltaText }];

    runtime.patchRunMessage(runId, messageId, {
      data: {
        ...(message?.data ?? {}),
        [run.language]: {
          contentParts: mergedParts,
          thinkingDetails: Array.isArray(langEntry?.thinkingDetails) ? langEntry!.thinkingDetails : [],
        },
      },
    });
  }

  private async handleEvent(projectId: string, event: RunExecutionEvent): Promise<void> {
    const envelope = event.data ?? {};
    const runId = String(envelope?.run_id ?? '');
    if (!runId) return;

    const seqRaw = envelope?.event_seq;
    const seq = typeof seqRaw === 'number' ? seqRaw : Number(seqRaw);
    if (Number.isFinite(seq) && seq > 0) {
      const lastSeq = this.lastEventSeqByRunId.get(runId) ?? 0;
      if (seq <= lastSeq) {
        return;
      }
      this.lastEventSeqByRunId.set(runId, seq);
    }

    const runtime = useRuntimeStore.getState();
    const run = await this.ensureRunLoaded(projectId, runId);
    if (!run) return;

    const payload = envelope?.payload ?? {};
    const updatedAt = envelope?.ts ?? nowIso();

    switch (event.event) {
      case 'run:status': {
        const status = (payload?.status ?? run.status) as RunStatus;
        runtime.patchRun(runId, {
          status,
          error: payload?.error ?? run.error,
          updatedAt,
        });
        if (isTerminalStatus(status) || status === 'paused') {
          const stream = this.streamByRunId.get(runId);
          if (stream) {
            stream.abort();
            this.streamByRunId.delete(runId);
          }
        }
        break;
      }
      case 'run:llm_delta':
        this.handleLlmDelta(runId, envelope);
        break;
      case 'run:llm_final':
        this.handleLlmFinal(runId, envelope);
        break;
      case 'run:tool_calls':
      case 'run:tool_calls_executed':
        this.handleToolCallsEvent(runId, payload);
        break;
      case 'run:complete':
        runtime.patchRun(runId, {
          status: 'completed',
          finalOutput: payload?.final_output ?? payload?.output ?? run.finalOutput,
          updatedAt,
        });
        break;
      case 'run:error':
        runtime.patchRun(runId, {
          status: 'error',
          error: payload?.error ?? 'Run failed',
          updatedAt,
        });
        break;
      case 'run:child_start': {
        const childRunId = payload?.child_run_id ? String(payload.child_run_id) : '';
        if (childRunId) {
          await this.ensureRunLoaded(projectId, childRunId);
        }
        break;
      }
      case 'run:child_waiting': {
        const childRunId = payload?.child_run_id ? String(payload.child_run_id) : '';
        if (childRunId) {
          await this.ensureRunLoaded(projectId, childRunId);
        }
        runtime.patchRun(runId, {
          status: 'running',
          updatedAt,
        });
        break;
      }
      case 'run:child_end': {
        const childRunId = payload?.child_run_id ? String(payload.child_run_id) : '';
        if (childRunId) {
          await this.ensureRunLoaded(projectId, childRunId);
        }
        break;
      }
      case 'run:step_completed':
      case 'run:heartbeat':
      default:
        break;
    }
  }

  async startRootRun(input: {
    projectId: string;
    agentId: string;
    runMode: 'planMode' | 'agentMode';
    surface: 'story-object' | 'outline-manager' | 'novel-editor' | 'config';
    userInput: string;
    language: string;
    contextObjectIds?: string[];
    signal?: AbortSignal;
    onMemoryStageChange?: (stage: import('./context/types').MemoryPreflightStage) => void;
  }): Promise<{ runId: string }> {
    void input.onMemoryStageChange;
    const runtime = useRuntimeStore.getState();

    let resolveRunId: ((runId: string) => void) | null = null;
    let rejectRunId: ((error: Error) => void) | null = null;
    const runIdPromise = new Promise<string>((resolve, reject) => {
      resolveRunId = resolve;
      rejectRunId = reject;
    });

    const handle = await runExecutionService.startRun(
      input.projectId,
      {
        run_type: 'agent',
        agent_id: input.agentId,
        run_mode: input.runMode,
        surface: input.surface,
        input_text: input.userInput ?? '',
        language: input.language,
        context_object_ids: input.contextObjectIds ?? [],
      },
      (event) => {
        const runId = String(event.data?.run_id ?? '');
        if (runId && resolveRunId) {
          resolveRunId(runId);
          resolveRunId = null;
        }
        void this.handleEvent(input.projectId, event);
      },
      { signal: input.signal },
      undefined,
    );

    void handle.done.catch((error) => {
      if (rejectRunId) {
        rejectRunId(error instanceof Error ? error : new Error(String(error)));
        rejectRunId = null;
      }
    });

    const runId = await runIdPromise;
    const run = await this.ensureRunLoaded(input.projectId, runId);
    this.bindStream(runId, handle);

    if (run && input.userInput.trim()) {
      const existingMessages = runtime.getRunMessages(runId);
      const hasUser = existingMessages.some((msg) => msg.role === 'user');
      if (!hasUser) {
        runtime.appendRunMessage({
          id: `user:${runId}:${existingMessages.length + 1}`,
          runId,
          seq: existingMessages.length + 1,
          role: 'user',
          data: {
            [input.language]: {
              contentParts: [{ type: 'content', text: input.userInput }],
              thinkingDetails: [],
            },
          },
          createdAt: nowIso(),
        });
      }
    }

    return { runId };
  }

  async resumeRunLoop(input: {
    runId: string;
    refreshMemory?: boolean;
    signal?: AbortSignal;
    onMemoryStageChange?: (stage: import('./context/types').MemoryPreflightStage) => void;
  }): Promise<void> {
    void input.refreshMemory;
    void input.onMemoryStageChange;

    const runtime = useRuntimeStore.getState();
    const run = runtime.getRun(input.runId);
    if (!run) return;
    if (this.streamByRunId.has(input.runId)) return;

    const handle = await runExecutionService.resumeRun(
      run.projectId,
      input.runId,
      (event) => {
        void this.handleEvent(run.projectId, event);
      },
      { signal: input.signal },
      this.getLastEventSeq(input.runId),
    );
    this.bindStream(input.runId, handle);
  }

  async invokeChildRun(_input: {
    projectId: string;
    agentId: string;
    language: string;
    inputText: string;
    parentRunId: string;
    parentRunMessageId: string;
    parentRunToolCallId: string;
    subAgentId: string;
  }): Promise<{ runId: string; output: string }> {
    throw new Error('invokeChildRun is not supported on frontend. Sub-agent runs are backend-managed via call_* tools.');
  }

  async applyRunToolCallDecisions(input: {
    runId: string;
    runMessageId: string;
    decisions: Record<string, ToolDecision>;
    options?: Record<string, unknown>;
  }): Promise<void> {
    const runtime = useRuntimeStore.getState();
    const run = runtime.getRun(input.runId);
    if (!run) return;

    const normalized: Record<string, ToolDecision> = {};
    for (const [toolCallId, decision] of Object.entries(input.decisions || {})) {
      normalized[normalizeDecisionKey(toolCallId)] = decision;
    }

    const handle = await runExecutionService.applyDecisions(
      run.projectId,
      input.runId,
      {
        message_id: input.runMessageId,
        decisions: normalized,
        options: input.options,
      },
      (event) => {
        void this.handleEvent(run.projectId, event);
      },
      undefined,
      this.getLastEventSeq(input.runId),
    );

    this.bindStream(input.runId, handle);
    await handle.done.catch((error) => {
      console.error('[RuntimeOrchestrator] apply decisions stream failed:', error);
    });
  }

  async pauseRun(runId: string): Promise<void> {
    const runtime = useRuntimeStore.getState();
    const run = runtime.getRun(runId);
    if (!run) return;

    await runExecutionService.pauseRun(run.projectId, runId);
    runtime.patchRun(runId, { status: 'paused', updatedAt: nowIso() });
  }

  async retryRun(runId: string): Promise<void> {
    await this.resumeRunLoop({ runId });
  }

  async cancelRun(runId: string): Promise<void> {
    const runtime = useRuntimeStore.getState();
    const run = runtime.getRun(runId);
    if (!run) return;

    const stream = this.streamByRunId.get(runId);
    if (stream) {
      stream.abort();
      this.streamByRunId.delete(runId);
    }

    await runExecutionService.cancelRun(run.projectId, runId);
    runtime.patchRun(runId, { status: 'cancelled', updatedAt: nowIso() });
  }

  async recoverRuns(projectId: string, agentId: string): Promise<void> {
    const runtime = useRuntimeStore.getState();
    const response = await runExecutionService.queryRuns(projectId, {
      run_types: ['agent', 'subAgent'],
      statuses: ['running', 'waiting', 'paused', 'error', 'completed', 'cancelled'],
      limit: 200,
    });

    const mapped = (response.items ?? [])
      .map((item) => mapBackendRun(item, runtime.getRun(String(item.id))))
      .filter((run) => run.agentId === agentId);
    runtime.upsertRuns(mapped);
  }

  findLatestOpenRootRunId(projectId: string, agentId: string): string | undefined {
    return useRuntimeStore.getState().findLatestOpenRootRunId(projectId, agentId);
  }
}

export const runtimeOrchestrator = new DefaultRuntimeOrchestrator();
