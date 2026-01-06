import React from 'react';
import { renderMarkdown } from '../../utils/markdown';
import type {
  DisplayProcessor,
  DisplayProcessingResult,
  ProcessedChatMessage,
  LLMRequestPipelineContext
} from '../types';

export class DefaultDisplayProcessor implements DisplayProcessor {
  process(
    message: ProcessedChatMessage,
    _context: LLMRequestPipelineContext
  ): DisplayProcessingResult {
    const displayContent = this.processMessageContent(message);

    return {
      displayContent,
      editCards: [],
    };
  }

  private processMessageContent(message: ProcessedChatMessage): React.ReactNode {
    let content = '';

    if (message.contentParts?.length) {
      const contentParts = message.contentParts.filter(part => part.type === 'content');
      content = contentParts.map(part => part.text).join('');
    } else {
      content = message.originalContent || '';
    }

    if (message.role === 'user') {
      content = this.removeSystemTags(content);
    }

    content = renderMarkdown(content);

    return (
      <div
        className="message-text"
        dangerouslySetInnerHTML={{ __html: content }}
      />
    );
  }

  private removeSystemTags(content: string): string {
    if (!content || typeof content !== 'string') return '';
    let result = content;
    const systemTagRegex = /<system>\s*[\s\S]*?\s*<\/system>\s*/gi;
    result = result.replace(systemTagRegex, '');
    result = result.replace(/\n\s*\n\s*\n/g, '\n\n');
    return result.trim();
  }
}

