/**
 * Pure derivation of the tool-call index maps consumers read.
 *
 * Extracted verbatim from the former `threadStore` so the merged view (snapshot
 * query + live overlay) produces byte-identical indexes to the old in-place store.
 * No React, no Zustand — unit-testable.
 */

import type { ThreadToolCall } from '../types/thread';

export interface ThreadToolCallIndexes {
  toolCallsById: Record<string, ThreadToolCall | undefined>;
  toolCallIdsByMessageId: Record<string, string[] | undefined>;
  toolCallIdsByAssistantMessageId: Record<string, string[] | undefined>;
  toolCallsByMessageId: Record<string, ThreadToolCall[] | undefined>;
  pendingToolCallIdsByThread: Record<string, string[] | undefined>;
  pendingToolCallMessageByThread: Record<string, string | undefined>;
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values)];
}

export function buildMessageMap(
  toolCallsById: Record<string, ThreadToolCall | undefined>,
): Record<string, ThreadToolCall[] | undefined> {
  const byMessageId: Record<string, ThreadToolCall[]> = {};
  for (const tc of Object.values(toolCallsById)) {
    if (!tc) continue;
    const existing = byMessageId[tc.messageId] ?? [];
    byMessageId[tc.messageId] = [...existing, tc];
  }
  return byMessageId;
}

export function buildToolCallIdsByMessageId(
  toolCallsById: Record<string, ThreadToolCall | undefined>,
): Record<string, string[] | undefined> {
  const out: Record<string, string[]> = {};
  for (const tc of Object.values(toolCallsById)) {
    if (!tc || !tc.messageId) continue;
    out[tc.messageId] = uniqueIds([...(out[tc.messageId] ?? []), tc.id]);
  }
  return out;
}

export function buildToolCallIdsByAssistantMessageId(
  toolCallsById: Record<string, ThreadToolCall | undefined>,
): Record<string, string[] | undefined> {
  const out: Record<string, string[]> = {};
  for (const tc of Object.values(toolCallsById)) {
    if (!tc || !tc.assistantMessageId) continue;
    out[tc.assistantMessageId] = uniqueIds([...(out[tc.assistantMessageId] ?? []), tc.id]);
  }
  return out;
}

export function buildPendingByThread(
  toolCallsById: Record<string, ThreadToolCall | undefined>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const tc of Object.values(toolCallsById)) {
    if (!tc) continue;
    if (tc.status !== 'pending') continue;
    const current = out[tc.threadId] ?? [];
    current.push(tc.id);
    out[tc.threadId] = current;
  }
  return out;
}

export function buildPendingMessageByThread(
  toolCallsById: Record<string, ThreadToolCall | undefined>,
  pendingToolCallIdsByThread: Record<string, string[]>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [threadId, ids] of Object.entries(pendingToolCallIdsByThread)) {
    const first = ids[0];
    if (!first) continue;
    const row = toolCallsById[first];
    if (row) {
      out[threadId] = row.messageId;
    }
  }
  return out;
}

/** Build every tool-call index from a flat id->toolCall map. */
export function buildThreadToolCallIndexes(
  toolCallsById: Record<string, ThreadToolCall | undefined>,
): ThreadToolCallIndexes {
  const pendingToolCallIdsByThread = buildPendingByThread(toolCallsById);
  return {
    toolCallsById,
    toolCallIdsByMessageId: buildToolCallIdsByMessageId(toolCallsById),
    toolCallIdsByAssistantMessageId: buildToolCallIdsByAssistantMessageId(toolCallsById),
    toolCallsByMessageId: buildMessageMap(toolCallsById),
    pendingToolCallIdsByThread,
    pendingToolCallMessageByThread: buildPendingMessageByThread(toolCallsById, pendingToolCallIdsByThread),
  };
}
