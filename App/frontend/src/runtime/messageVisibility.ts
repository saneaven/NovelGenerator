import { resolveRunMessageDisplay, type ThreadMessage, type ThreadToolCall } from '../types/thread';
import { getByDotPath } from '../utils/dotPath';

function hasVisibleReasoningText(message: ThreadMessage, language: string, fallbackLanguage?: string): boolean {
  const detail = message.isStreaming
    ? message.streamingData?.reasoningDetail
    : resolveRunMessageDisplay(message, language, fallbackLanguage).reasoningDetail;
  if (!detail || typeof detail !== 'object') return false;
  const path = detail.meta?.thinking_display?.trim();
  if (!path) return false;
  const value = getByDotPath(detail.data ?? {}, path);
  return typeof value === 'string' && value.trim().length > 0;
}

function hasVisibleContent(message: ThreadMessage, language: string, fallbackLanguage?: string): boolean {
  const contentParts = message.isStreaming
    ? message.streamingData?.contentParts ?? []
    : resolveRunMessageDisplay(message, language, fallbackLanguage).contentParts;
  return contentParts.some((part) => part.type === 'content' && typeof part.text === 'string' && part.text.trim().length > 0);
}

export function hasRenderableAssistantOutput(params: {
  message: ThreadMessage;
  language: string;
  fallbackLanguage?: string;
  toolCalls: ThreadToolCall[];
}): boolean {
  const {
    message,
    language,
    fallbackLanguage,
    toolCalls,
  } = params;

  if (message.role !== 'assistant') return true;
  if (message.isStreaming) return true;
  if (hasVisibleContent(message, language, fallbackLanguage)) return true;
  if (hasVisibleReasoningText(message, language, fallbackLanguage)) return true;
  return toolCalls.length > 0;
}
