import {
  threadService,
  type ChatRequest,
  type ToolCallBatchDecisionRequest,
  type ToolCallDecisionResponse,
} from '../api/threadService';
import { threadRuntimeCoordinator } from './threadRuntimeCoordinator';
import { useThreadStore } from '../store/threadStore';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import type {
  ThreadInfo,
  ThreadStatus,
} from '../types/thread';

type EngineThreadType = 'agent' | 'subAgent' | 'journey';

interface ChatEngineParams {
  threadId: string;
  projectId: string;
  threadType: EngineThreadType;
}

function toThreadType(threadType: EngineThreadType): ThreadInfo['threadType'] {
  if (threadType === 'subAgent') return 'subAgent';
  if (threadType === 'journey') return 'journey';
  return 'agent';
}

function nowIso(): string {
  return new Date().toISOString();
}

export class ChatEngine {
  private readonly threadId: string;
  private readonly projectId: string;
  private readonly threadType: EngineThreadType;

  private initialized = false;
  private inFlightChat = false;
  private lastRunId: string | null = null;

  constructor(params: ChatEngineParams) {
    this.threadId = params.threadId;
    this.projectId = params.projectId;
    this.threadType = params.threadType;
  }

  async init(): Promise<void> {
    threadRuntimeCoordinator.registerThread(this.projectId, this.threadId);
    if (this.initialized) return;
    await threadRuntimeCoordinator.loadThreadSnapshot(this.projectId, this.threadId);
    this.initialized = true;
  }

  async listMessages(): Promise<void> {
    await this.init();
    await threadRuntimeCoordinator.loadThreadSnapshot(this.projectId, this.threadId);
  }

  async send(inputText: string, opts?: Partial<ChatRequest>): Promise<void> {
    const trimmed = inputText.trim();
    if (!trimmed) {
      await this.resume(opts);
      return;
    }
    await this.init();
    if (this.inFlightChat) return;

    this.inFlightChat = true;
    try {
      const response = await threadService.chat(this.threadId, {
        input_text: trimmed,
        ...opts,
      });
      this.lastRunId = response.runId;
      this.upsertThreadStatus(response.threadStatus, null, response.runId, response.status);
    } finally {
      this.inFlightChat = false;
    }
  }

  async resume(opts?: Partial<ChatRequest>): Promise<void> {
    await this.init();
    if (this.inFlightChat) return;

    this.inFlightChat = true;
    try {
      const response = await threadService.chat(this.threadId, {
        input_text: '',
        ...opts,
      });
      this.lastRunId = response.runId;
      this.upsertThreadStatus(response.threadStatus, null, response.runId, response.status);
    } finally {
      this.inFlightChat = false;
    }
  }

  async acceptToolCall(toolCallId: string, reason?: string): Promise<void> {
    const response = await threadService.decideToolCall(this.threadId, toolCallId, {
      decision: 'accept',
      reason,
    });
    this.applyToolDecisionResponse(response);
  }

  async rejectToolCall(toolCallId: string, reason?: string): Promise<void> {
    const response = await threadService.decideToolCall(this.threadId, toolCallId, {
      decision: 'reject',
      reason,
    });
    this.applyToolDecisionResponse(response);
  }

  async acceptToolCallsBatch(ids: string[]): Promise<void> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return;

    const req: ToolCallBatchDecisionRequest = {
      decisions: unique.map((id) => ({
        tool_call_id: id,
        decision: 'accept',
      })),
    };
    const response = await threadService.decideToolCallsBatch(this.threadId, req);
    response.results.forEach((item) => this.applyToolDecisionResponse(item));
  }

  async completeSubAgentToolCall(toolCallId: string, result: string): Promise<void> {
    const response = await threadService.completeSubAgentToolCall(this.threadId, toolCallId, {
      result,
    });
    this.applyToolDecisionResponse(response);
  }

  async cancel(runId?: string): Promise<void> {
    const target = runId ?? this.lastRunId;
    if (!target) return;
    await threadService.cancelRun(this.threadId, target);
  }

  dispose(): void {
    threadRuntimeCoordinator.unregisterThread(this.projectId, this.threadId);
  }

  // Temporary compatibility for unchanged callsites.
  disconnectSSE(): void {
    this.dispose();
  }

  private upsertThreadStatus(
    status: ThreadStatus,
    error: string | null,
    runId?: string | null,
    runStatus?: ThreadStatus | null,
  ): void {
    const store = useThreadStore.getState();
    const existing = store.threadsById[this.threadId];
    const partial: Partial<ThreadInfo> = {
      status,
      lastError: error,
      updatedAt: nowIso(),
      latestRunId: runId ?? null,
      latestRunStatus: runStatus ?? status,
    };
    if (existing) {
      store.patchThread(this.threadId, partial);
      return;
    }
    store.upsertThread({
      id: this.threadId,
      projectId: this.projectId,
      threadType: toThreadType(this.threadType),
      ownerId: null,
      journeyKind: null,
      status,
      lastError: error,
      updatedAt: nowIso(),
      latestRunId: runId ?? null,
      latestRunStatus: runStatus ?? status,
      latestMessageAt: null,
      unresolvedToolCallCount: 0,
    });
  }

  private applyToolDecisionResponse(response: ToolCallDecisionResponse): void {
    const store = useThreadStore.getState();
    store.upsertToolCall(response.toolCall);

    const toolResult = response.toolCall.result as Record<string, unknown> | null | undefined;
    const deletedId = toolResult && typeof toolResult.deleted === 'object'
      ? String((toolResult.deleted as Record<string, unknown>).id ?? '')
      : '';
    const deletedIds = deletedId ? [deletedId] : [];
    const objects = Array.isArray(response.newObjects) ? response.newObjects : [];
    useUnifiedObjectStore.getState().applyAffectedObjects(objects as any[], deletedIds);

    let unresolvedCount = 0;
    for (const toolCall of Object.values(useThreadStore.getState().toolCallsById)) {
      if (!toolCall || toolCall.threadId !== this.threadId) continue;
      if (toolCall.status === 'pending' || toolCall.status === 'streaming' || toolCall.status === 'validating' || toolCall.status === 'processing') {
        unresolvedCount += 1;
      }
    }
    store.setThreadRuntime(this.threadId, {
      unresolvedToolCallCount: unresolvedCount,
      updatedAt: nowIso(),
    });
  }
}

export default ChatEngine;
