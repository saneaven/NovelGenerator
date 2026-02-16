/**
 * Shared types for the unified run context pipeline.
 *
 * RunTypeConfig normalizes ALL run-type-specific configuration (root vs child)
 * into a single shape. buildExecutionConfig is completely generic and never
 * branches on run type.
 */

import type { LLMTaskModeType, ThinkingMode, AgentPromptContext, SubAgentPromptContext, MemoryRelevantChat } from '../../llm/types';
import type { ChatMessage } from '../../llm/requestTypes';
import type { ToolCallSchema } from '../../toolCall';
import type { ProviderType, ThinkingConfig, ThinkingFormat, RequestFormat } from '../../store/settingsStore';
import type { TemplateData } from '../../llm/types';

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export type MemoryContext = {
  previousSummaries: string[];
  relevantChats: MemoryRelevantChat[];
  archiveBoundary?: string | null;
};

export type MemoryPreflightStage =
  | 'checking'
  | 'summarizing'
  | 'archiving'
  | 'searching';

// ---------------------------------------------------------------------------
// Run type config — normalized bag of everything that differs per run type
// ---------------------------------------------------------------------------

export interface RunTypeConfig {
  mode: LLMTaskModeType;
  kind: 'agent' | 'subAgent';
  label: string;
  provider: ProviderType;
  model: string;
  temperature: number;
  thinkingMode: ThinkingMode | undefined;
  thinkingConfig: ThinkingConfig | undefined;
  requestFormat: RequestFormat | undefined;
  thinkingFormat: ThinkingFormat | undefined;
  enable_prefill: boolean;
  toolSchemas: ToolCallSchema[] | undefined;
  toolChoice?: 'auto' | 'required' | 'none';
  frozenProjectData: TemplateData['project'] | undefined;
  /** Type-specific prompt context fields (runMode/surface/contextObjectIds OR agentName). */
  promptFields: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Run execution config — fully assembled, ready for startLLMSession
// ---------------------------------------------------------------------------

export interface RunExecutionConfig {
  mode: LLMTaskModeType;
  kind: 'agent' | 'subAgent';
  label: string;
  provider: ProviderType;
  model: string;
  temperature: number;
  thinkingMode: ThinkingMode | undefined;
  thinkingConfig: ThinkingConfig | undefined;
  requestFormat: RequestFormat | undefined;
  thinkingFormat: ThinkingFormat | undefined;
  history: ChatMessage[];
  promptContext: AgentPromptContext | SubAgentPromptContext;
  toolSchemas: ToolCallSchema[] | undefined;
  toolChoice?: 'auto' | 'required' | 'none';
}

// ---------------------------------------------------------------------------
// RunContext — the complete context for a single run step
// ---------------------------------------------------------------------------

export interface RunContext {
  history: ChatMessage[];
  memoryContext: MemoryContext | null;
  executionConfig: RunExecutionConfig;
}

// ---------------------------------------------------------------------------
// Memory preparation params
// ---------------------------------------------------------------------------

export interface PrepareMemoryParams {
  projectId: string;
  agentId: string;
  runMode: string;
  surface: string;
  userInput: string;
  language: string;
  contextObjectIds?: string[];
  subAgentId?: string;
  signal?: AbortSignal;
  onStageChange?: (stage: MemoryPreflightStage) => void;
}
