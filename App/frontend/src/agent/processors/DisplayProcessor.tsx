import React from 'react';
import { MarkdownRenderer } from '../../components/MarkdownRenderer';
import type {
  DisplayProcessor,
  DisplayProcessingResult,
  ProcessedChatMessage,
} from '../types';

export class DefaultDisplayProcessor implements DisplayProcessor {
  process(message: ProcessedChatMessage): DisplayProcessingResult {
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

    return (
      <MarkdownRenderer className="message-text">
        {content}
      </MarkdownRenderer>
    );
  }
}
