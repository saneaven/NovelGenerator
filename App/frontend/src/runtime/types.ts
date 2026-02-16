import type { MemoryContext } from './context/types';

export type RunType = 'agent' | 'subAgent' | 'journey';
export type RunStatus = 'running' | 'waiting' | 'paused' | 'completed' | 'error' | 'cancelled';
export type RunMode = 'planMode' | 'agentMode';
export type RunSurface = 'story-object' | 'outline-manager' | 'novel-editor' | 'config';
export type RunMessageRole = 'user' | 'assistant' | 'system' | 'tool';
export type RunToolCallStatus = 'pending' | 'running' | 'accepted' | 'rejected' | 'failed';
export type RunToolCallFailureType = 'validation' | 'execution' | 'partial';
export type JourneyKind = 'aiEdit' | 'translation' | 'imagePrompt';

export interface Run {
  id: string;
  projectId: string;
  agentId: string;
  runType: RunType;
  status: RunStatus;
  language: string;
  inputText: string;
  inputPayload?: Record<string, unknown>;
  finalOutput?: string;
  error?: string;
  runMode?: RunMode;
  surface?: RunSurface;
  contextObjectIds: string[];
  journeyKind?: JourneyKind;
  journeyTargetIds?: string[];
  parentRunId?: string;
  parentRunMessageId?: string;
  parentRunToolCallId?: string;
  subAgentId?: string;
  rootRunSeq?: number;
  nextMessageSeq: number;
  runStepCount: number;
  activeSessionId: string | null;
  frozenProjectData?: unknown;
  memoryContext?: MemoryContext | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunMessageLangEntry {
  contentParts: Array<{ type: string; text: string }>;
  thinkingDetails?: Array<Record<string, unknown>>;
}

export interface RunMessage {
  id: string;
  runId: string;
  seq: number;
  role: RunMessageRole;
  data: Record<string, RunMessageLangEntry>;
  createdAt: string;
}

export interface RunToolCall {
  id: string;
  runId: string;
  messageId: string;
  llmCallId: string;
  callSeq: number;
  toolName: string;
  arguments: Record<string, unknown>;
  status: RunToolCallStatus;
  failureType?: RunToolCallFailureType;
  reason?: string;
  result?: Record<string, unknown>;
  acceptedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeOrchestrator {
  startRootRun(input: {
    projectId: string;
    agentId: string;
    runMode: RunMode;
    surface: RunSurface;
    userInput: string;
    language: string;
    contextObjectIds?: string[];
    signal?: AbortSignal;
    onMemoryStageChange?: (stage: import('./context/types').MemoryPreflightStage) => void;
  }): Promise<{ runId: string }>;

  resumeRunLoop(input: {
    runId: string;
    refreshMemory?: boolean;
    signal?: AbortSignal;
    onMemoryStageChange?: (stage: import('./context/types').MemoryPreflightStage) => void;
  }): Promise<void>;

  invokeChildRun(input: {
    projectId: string;
    agentId: string;
    language: string;
    inputText: string;
    parentRunId: string;
    parentRunMessageId: string;
    parentRunToolCallId: string;
    subAgentId: string;
  }): Promise<{ runId: string; output: string }>;

  applyRunToolCallDecisions(input: {
    runId: string;
    runMessageId: string;
    decisions: Record<string, 'accept' | 'reject'>;
    options?: Record<string, unknown>;
  }): Promise<void>;

  pauseRun(runId: string): Promise<void>;
  retryRun(runId: string): Promise<void>;
  cancelRun(runId: string): Promise<void>;
  recoverRuns(projectId: string, agentId: string): Promise<void>;

  findLatestOpenRootRunId(projectId: string, agentId: string): string | undefined;
}
