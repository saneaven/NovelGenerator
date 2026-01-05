import React from 'react';
import { renderMarkdown } from '../../utils/markdown';
import type { FunctionCallMetadata } from '../../llm/requestTypes';
import type {
  DisplayProcessor,
  DisplayProcessingResult,
  ProcessedChatMessage,
  EditCard,
  LLMRequestPipelineContext
} from '../types';
import type { FunctionCallWithStatus } from '../../functionCall/types';
import { FunctionCallService } from '../../pages/workspace/services/FunctionCallService';

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

  generateEditCardsFromFunctionCalls(functionCalls: FunctionCallMetadata[]): EditCard[] {
    return functionCalls.map(funcCall => {
      // Convert FunctionCallMetadata to FunctionCallWithStatus
      const functionCallWithStatus: FunctionCallWithStatus = {
        id: funcCall.id,
        functionName: funcCall.function_name,
        arguments: typeof funcCall.arguments === 'string'
          ? JSON.parse(funcCall.arguments)
          : funcCall.arguments,
        status: funcCall.status ?? 'pending',
        reason: funcCall.reason,
        failureType: funcCall.failureType,
        result: funcCall.result,
        acceptedAt: funcCall.acceptedAt,
      };

      return {
        id: funcCall.id,
        type: FunctionCallService.mapFunctionToEditType(funcCall.function_name),
        title: FunctionCallService.getFunctionCallTitle(funcCall.function_name),
        description: FunctionCallService.generateFunctionCallSummary(funcCall.function_name, funcCall.arguments),
        data: typeof funcCall.arguments === 'string'
          ? JSON.parse(funcCall.arguments)
          : funcCall.arguments,
        functionCall: functionCallWithStatus,
        onApply: () => {},
        onReject: () => {},
      };
    });
  }
}


