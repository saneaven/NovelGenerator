import React from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { FunctionCallMetadata } from '../../llm/requestTypes';
import type {
  DisplayProcessor,
  DisplayProcessingResult,
  ProcessedChatMessage,
  EditCard,
  LLMRequestPipelineContext
} from '../types';
import { FunctionCallService } from '../../pages/workspace/services/FunctionCallService';

marked.setOptions({
  gfm: true,
  breaks: true,
});

export class DefaultDisplayProcessor implements DisplayProcessor {
  process(
    message: ProcessedChatMessage,
    _context: LLMRequestPipelineContext
  ): DisplayProcessingResult {
    let editCards: EditCard[] = [];

    if (message.role === 'assistant' && message.functionCalls?.length) {
      editCards = this.generateEditCardsFromFunctionCalls(message.functionCalls);
    } else if (message.role === 'user') {
      editCards = [];
    }

    const displayContent = this.processMessageContent(message);

    return {
      displayContent,
      editCards,
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

    content = this.processMarkdown(content);

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

  private processMarkdown(content: string): string {
    const parsed = marked.parse(content, { async: false });
    const html = typeof parsed === 'string' ? parsed : '';
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }

  generateEditCardsFromFunctionCalls(functionCalls: FunctionCallMetadata[]): EditCard[] {
    return functionCalls.map(funcCall => ({
      id: funcCall.id,
      type: FunctionCallService.mapFunctionToEditType(funcCall.function_name),
      title: FunctionCallService.getFunctionCallTitle(funcCall.function_name),
      description: FunctionCallService.generateFunctionCallSummary(funcCall.function_name, funcCall.arguments),
      isApplied: funcCall.isApplied,
      isRejected: funcCall.isRejected,
      data: funcCall.arguments,
      functionCall: funcCall,
      onApply: () => {},
      onReject: () => {},
    }));
  }
}


