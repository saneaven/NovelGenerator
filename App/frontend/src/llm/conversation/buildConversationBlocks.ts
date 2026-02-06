import type { ChatMessage, ContentPart, ConversationBlock } from '../requestTypes';
import type { PromptBundle } from '../types';
import { PromptManager } from '../PromptManager';

export type ConversationBlockMeta = {
  kind: 'system' | 'user' | 'assistant' | 'tool_results' | 'prefill' | 'other';
  sourceMessageId?: string;
  sourceRole?: string;
};

export type ConversationBlockWithMeta = {
  block: ConversationBlock;
  meta: ConversationBlockMeta;
};

function getMessageText(msg: ChatMessage): string {
  return msg.contentParts
    .filter((p: ContentPart) => p.type === 'content')
    .map((p: ContentPart) => p.text)
    .join('');
}

export function buildConversationBlocksWithMeta(
  history: ChatMessage[],
  promptBundle: PromptBundle,
  opts: {
    toolCallHistoryLimit: number;
    thinkingHistoryLimit: number;
    includePrefill?: boolean;
  }
): ConversationBlockWithMeta[] {
  const messages: ConversationBlockWithMeta[] = [];
  const fcLimit = opts.toolCallHistoryLimit;
  const thinkingLimit = opts.thinkingHistoryLimit;

  // 1. System prompt
  messages.push({
    block: {
      role: 'system',
      contentParts: [{ type: 'content', text: promptBundle.systemPrompt }],
    },
    meta: { kind: 'system' },
  });

  // 1.5. Agent memory prompt (synthetic user message)
  const agentMemory = promptBundle.templateData.agent;
  const hasMemory = Boolean(
    agentMemory &&
      ((agentMemory.previousSummaries?.length ?? 0) > 0 || (agentMemory.relevantChats?.length ?? 0) > 0)
  );
  if (hasMemory && promptBundle.memoryPrompt.trim()) {
    messages.push({
      block: {
        role: 'user',
        contentParts: [{ type: 'content', text: promptBundle.memoryPrompt }],
      },
      meta: { kind: 'user' },
    });
  }

  // 2. Count assistant messages to determine which ones should include tool calls / thinking
  const assistantIndices: number[] = [];
  for (let i = 0; i < history.length; i++) {
    if (history[i].role === 'assistant') assistantIndices.push(i);
  }
  const totalAssistants = assistantIndices.length;

  // Find all user message indices for position-based template selection
  const userIndices: number[] = [];
  for (let i = 0; i < history.length; i++) {
    if (history[i].role === 'user') userIndices.push(i);
  }
  const totalUsers = userIndices.length;
  const firstUserIndex = userIndices[0] ?? -1;
  const lastUserIndex = userIndices[userIndices.length - 1] ?? -1;
  const isSingleUser = totalUsers === 1;

  // 3. Process history
  let assistantCount = 0;
  for (let i = 0; i < history.length; i++) {
    const msg = history[i];

    if (msg.role === 'user') {
      // Position-based template selection
      let template: string;
      if (isSingleUser) {
        template =
          promptBundle.initialUserPrompt ??
          promptBundle.lastUserPrompt ??
          promptBundle.firstUserPrompt ??
          promptBundle.userPrompt;
      } else if (i === firstUserIndex) {
        template = promptBundle.firstUserPrompt ?? promptBundle.userPrompt;
      } else if (i === lastUserIndex) {
        template = promptBundle.lastUserPrompt ?? promptBundle.userPrompt;
      } else {
        template = promptBundle.userPrompt;
      }

      const injectedKey = promptBundle.messageInputKey;
      const injectedText = getMessageText(msg);
      const rendered = PromptManager.renderTemplate(template, {
        ...promptBundle.templateData,
        input: { ...promptBundle.templateData.input, [injectedKey]: injectedText },
      });

      messages.push({
        block: {
          role: 'user',
          contentParts: [{ type: 'content', text: rendered }],
        },
        meta: { kind: 'user', sourceMessageId: msg.id, sourceRole: msg.role },
      });
      continue;
    }

    if (msg.role === 'assistant') {
      assistantCount++;

      const shouldIncludeFC =
        fcLimit === -1 || (fcLimit > 0 && assistantCount > totalAssistants - fcLimit);
      const shouldIncludeThinking =
        thinkingLimit === -1 ||
        (thinkingLimit > 0 && assistantCount > totalAssistants - thinkingLimit);

      const filteredContentParts = shouldIncludeThinking
        ? msg.contentParts
        : msg.contentParts.filter((part) => part.type !== 'thinking');

      const block: ConversationBlock = {
        role: msg.role,
        contentParts:
          filteredContentParts.length > 0 ? filteredContentParts : [{ type: 'content', text: '' }],
      };

      // Add tool_calls if applicable
      if (shouldIncludeFC && msg.toolCalls && msg.toolCalls.length > 0) {
        block.tool_calls = msg.toolCalls.map((fc) => ({
          id: fc.id,
          type: 'function' as const,
          extra_content: fc.extra_content,
          function: {
            name: fc.tool_name,
            arguments:
              typeof fc.arguments === 'string' ? fc.arguments : JSON.stringify(fc.arguments),
          },
        }));
      }

      messages.push({
        block,
        meta: { kind: 'assistant', sourceMessageId: msg.id, sourceRole: msg.role },
      });

      // Add tool_results message if this assistant message had tool_calls with results
      if (block.tool_calls && block.tool_calls.length > 0 && msg.toolCalls) {
        const toolResults = msg.toolCalls
          .filter((fc) => fc.status !== 'pending' && fc.status !== 'running')
          .map((fc) => {
            let content: string;
            switch (fc.status) {
              case 'accepted':
                content = fc.result?.message || 'Applied successfully';
                break;
              case 'rejected':
                content = fc.reason ? `User rejected: ${fc.reason}` : 'User rejected this action';
                break;
              case 'failed':
                content = `Failed: ${fc.reason || 'Unknown error'}`;
                break;
              default:
                content = 'Pending user confirmation';
            }
            return {
              tool_call_id: fc.id,
              tool_name: fc.tool_name,
              content,
            };
          });

        if (toolResults.length > 0) {
          messages.push({
            block: {
              role: 'tool_results' as const,
              contentParts: [], // Required by ConversationBlock but not used for tool_results
              tool_results: toolResults,
            },
            meta: { kind: 'tool_results', sourceMessageId: msg.id, sourceRole: msg.role },
          });
        }
      }

      continue;
    }

    // Other roles: pass through raw message content
    messages.push({
      block: {
        role: msg.role,
        contentParts: msg.contentParts.length > 0 ? msg.contentParts : [{ type: 'content', text: '' }],
      },
      meta: { kind: 'other', sourceMessageId: msg.id, sourceRole: msg.role },
    });
  }

  // 4. Prefill (if configured)
  if (opts.includePrefill && promptBundle.prefill) {
    messages.push({
      block: {
        role: 'assistant',
        contentParts: [{ type: 'content', text: promptBundle.prefill }],
      },
      meta: { kind: 'prefill' },
    });
  }

  return messages;
}

export function buildConversationBlocks(
  history: ChatMessage[],
  promptBundle: PromptBundle,
  opts: {
    toolCallHistoryLimit: number;
    thinkingHistoryLimit: number;
    includePrefill?: boolean;
  }
): ConversationBlock[] {
  return buildConversationBlocksWithMeta(history, promptBundle, opts).map((m) => m.block);
}

