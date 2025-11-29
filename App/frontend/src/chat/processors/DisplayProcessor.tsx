import React, { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { FunctionCallMetadata } from '../../llm_request/types';
import type {
  DisplayProcessor,
  DisplayProcessingResult,
  ProcessedChatMessage,
  EditCard,
  ChatPipelineContext
} from '../types';
import { buildOperationPreviewsFromArgs } from '../utils/functionCallPreview';
import FunctionCallReviewCard from '../../components/functionCall/FunctionCallReviewCard';
import { FunctionCallService } from '../../pages/workspace/services/FunctionCallService';

marked.setOptions({
  gfm: true,
  breaks: true,
});

export class DefaultDisplayProcessor implements DisplayProcessor {
  process(
    message: ProcessedChatMessage,
    _context: ChatPipelineContext
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
      functionCall: funcCall, // Include reference to full function call metadata
      onApply: () => {}, // wired later (for legacy EditCardComponent)
      onReject: () => {}, // wired later (for legacy EditCardComponent)
    }));
  }
}

export const EditCardComponent: React.FC<{ card: EditCard }> = ({ card }) => {
  const operationPreviews = useMemo(
    () => buildOperationPreviewsFromArgs(card.data),
    [card.data]
  );

  const actions = !card.isApplied ? (
    <div className="edit-card-actions">
      <button className="apply-button" onClick={card.onApply}>
        Apply
      </button>
      <button className="reject-button" onClick={card.onReject}>
        Reject
      </button>
    </div>
  ) : undefined;

  const footer = card.isApplied ? (
    <div className="review-card-applied-info">
      <span className="applied-timestamp">
        {card.appliedAt ? `Applied at ${new Date(card.appliedAt).toLocaleTimeString()}` : 'Applied'}
      </span>
    </div>
  ) : undefined;

  return (
    <FunctionCallReviewCard
      title={card.title}
      eyebrow={card.isApplied ? 'Applied Function Call' : 'Pending Function Call'}
      subtitle={card.description}
      status={card.isApplied ? 'applied' : 'pending'}
      operations={operationPreviews}
      placeholder="AI is finalizing the structured preview..."
      variant="pending"
      collapsible={operationPreviews.length > 0}
      defaultOpen={false}
      actions={actions}
      footer={footer}
    />
  );
};

