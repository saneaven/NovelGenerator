/**
 * Unified history assembly for ALL run types.
 *
 * - Root runs: cross-run history from all root runs for the agent, with archive boundary
 * - Child runs: cross-invocation history from all child runs for the same sub-agent,
 *   with archive boundary from run.memoryContext
 *
 * Both branches produce ChatMessage[] — the orchestrator never branches on run type for history.
 */

import type { ChatMessage, ToolCallMetadata } from '../../llm/requestTypes';
import type { Run, RunMessage, RunToolCall } from '../types';
import { useRuntimeStore } from '../store/runtimeStore';
import { useAgentStore } from '../../store/agentStore';
import { resolveRunMessageDisplay } from '../utils/displayMessage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toToolCallMetadata(toolCall: RunToolCall): ToolCallMetadata {
  return {
    id: toolCall.llmCallId,
    tool_name: toolCall.toolName,
    arguments: toolCall.arguments,
    status: toolCall.status,
    reason: toolCall.reason,
    failureType: toolCall.failureType,
    result: toolCall.result as any,
    acceptedAt: toolCall.acceptedAt ? new Date(toolCall.acceptedAt) : undefined,
  };
}

function runMessageToChatMessage(params: {
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

// ---------------------------------------------------------------------------
// buildRunBackedHistory — cross-run history for root runs
// ---------------------------------------------------------------------------

/**
 * Build cross-run history from ALL root runs for a given agent.
 * Messages are sorted by rootRunSeq → timestamp → id.
 * An archive boundary (messageId) can be provided to slice off old messages.
 */
export function buildRunBackedHistory(
  projectId: string,
  agentId: string,
  archiveBoundary: string | null,
  language: string,
): ChatMessage[] {
  const runtime = useRuntimeStore.getState();

  const rootRuns = runtime
    .listRuns({ projectId, agentId, runKind: 'root' })
    .sort((a, b) => {
      const aSeq = a.rootRunSeq ?? Number.MAX_SAFE_INTEGER;
      const bSeq = b.rootRunSeq ?? Number.MAX_SAFE_INTEGER;
      if (aSeq !== bSeq) return aSeq - bSeq;
      return a.createdAt.localeCompare(b.createdAt);
    });

  const history: ChatMessage[] = [];
  let foundBoundary = !archiveBoundary; // if no boundary, include everything

  for (const rootRun of rootRuns) {
    const rootMessages = runtime.getRunMessages(rootRun.id);
    for (const message of rootMessages) {
      // Skip messages before archive boundary
      if (!foundBoundary) {
        if (message.id === archiveBoundary) {
          foundBoundary = true;
        }
        continue;
      }

      const toolCalls = message.role === 'assistant'
        ? runtime.getRunToolCalls(message.id)
        : [];

      history.push(runMessageToChatMessage({ message, toolCalls, language }));
    }
  }

  // Stable sort by timestamp then id
  history.sort((a, b) => {
    const aTs = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const bTs = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    if (aTs !== bTs) return aTs - bTs;
    return String(a.id).localeCompare(String(b.id));
  });

  return history;
}

// ---------------------------------------------------------------------------
// buildSubAgentBackedHistory — cross-invocation history for child runs
// ---------------------------------------------------------------------------

/**
 * Build cross-invocation history from ALL child runs for a given sub-agent.
 * This gives sub-agents persistent memory across invocations.
 */
export function buildSubAgentBackedHistory(
  projectId: string,
  agentId: string,
  subAgentId: string,
  archiveBoundary: string | null,
  language: string,
): ChatMessage[] {
  const runtime = useRuntimeStore.getState();

  // Get all child runs for this sub-agent, sorted by creation time
  const childRuns = runtime
    .listRuns({ projectId, agentId, runKind: 'child' })
    .filter((r) => r.subAgentId === subAgentId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const history: ChatMessage[] = [];
  let foundBoundary = !archiveBoundary;

  for (const childRun of childRuns) {
    const messages = runtime.getRunMessages(childRun.id);
    for (const message of messages) {
      if (!foundBoundary) {
        if (message.id === archiveBoundary) {
          foundBoundary = true;
        }
        continue;
      }

      const toolCalls = message.role === 'assistant'
        ? runtime.getRunToolCalls(message.id)
        : [];

      history.push(runMessageToChatMessage({ message, toolCalls, language }));
    }
  }

  // Sort by timestamp then id
  history.sort((a, b) => {
    const aTs = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const bTs = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    if (aTs !== bTs) return aTs - bTs;
    return String(a.id).localeCompare(String(b.id));
  });

  return history;
}

// ---------------------------------------------------------------------------
// buildRunHistory — unified for all run types
// ---------------------------------------------------------------------------

/**
 * Build the chat history for any run type.
 *
 * - Root runs: cross-run history (all root runs, archive boundary from agent store)
 * - Child runs: cross-invocation history (all child runs for the same sub-agent,
 *   archive boundary from run.memoryContext)
 */
export function buildRunHistory(run: Run): ChatMessage[] {
  const runtime = useRuntimeStore.getState();

  if (run.runKind === 'root') {
    const agent = useAgentStore.getState().getAgent(run.projectId, run.agentId);
    const boundary = agent?.archived_until_message_id ?? null;

    // Cross-run history already includes current run's committed messages.
    // buildRunBackedHistory reads ALL root runs including the current one.
    return buildRunBackedHistory(run.projectId, run.agentId, boundary, run.language);
  }

  if (run.runKind === 'child') {
    if (run.subAgentId) {
      // Cross-invocation history for the sub-agent, with archive boundary from memory.
      const boundary = run.memoryContext?.archiveBoundary ?? null;
      return buildSubAgentBackedHistory(
        run.projectId,
        run.agentId,
        run.subAgentId,
        boundary,
        run.language,
      );
    }

    // Fallback: child run without subAgentId — only own messages
    const messages = runtime.getRunMessages(run.id);
    return messages.map((message) => {
      const toolCalls = runtime.getRunToolCalls(message.id);
      return runMessageToChatMessage({ message, toolCalls, language: run.language });
    });
  }

  return [];
}
