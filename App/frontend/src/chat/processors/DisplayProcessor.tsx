import React from 'react';
import type { FunctionCallMetadata } from '../../llm_request/types';
import type { 
  DisplayProcessor, 
  DisplayProcessingResult, 
  ProcessedChatMessage, 
  EditCard,
  ChatPipelineContext 
} from '../types';

export class DefaultDisplayProcessor implements DisplayProcessor {
  process(
    message: ProcessedChatMessage,
    context: ChatPipelineContext
  ): DisplayProcessingResult {
    let editCards: EditCard[] = [];

    if (message.role === 'assistant') {
      // Assistant messages: only show function call selection cards if not yet applied
      if (message.functionCalls && message.functionCalls.length > 0) {
        // Only show cards for unapplied function calls
        const unappliedFunctionCalls = message.functionCalls.filter(fc => !fc.isApplied);
        if (unappliedFunctionCalls.length > 0) {
          editCards = this.generateEditCardsFromFunctionCalls(unappliedFunctionCalls, context);
        }
      } 
    } else if (message.role === 'user') {
      // User messages: only show system message result cards
      const systemCards = this.extractSystemCards(message);
      editCards = systemCards;
    }
    
    // Process message content for display
    const displayContent = this.processMessageContent(message);

    return {
      displayContent,
      editCards
    };
  }


  private processMessageContent(message: ProcessedChatMessage): React.ReactNode {
    let content = message.originalContent || message.content || '';

    // Remove edit tags and system messages from display content
    content = this.removeSystemTags(content);
    
    // Process markdown-like formatting
    content = this.processMarkdown(content);

    return (
      <div className="message-content">
        <div 
          className="message-text"
          dangerouslySetInnerHTML={{ __html: content }}
        />
      </div>
    );
  }


  /**
   * Remove system tags from content for display
   */
  private removeSystemTags(content: string): string {
    if (!content || typeof content !== 'string') return '';
    
    // Remove system tags completely
    return content.replace(/<system>[\s\S]*?<\/system>/gi, '').trim();
  }


  private processMarkdown(content: string): string {
    // Basic markdown processing
    return content
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Code blocks
      .replace(/```(\w+)?\n([\s\S]*?)\n```/g, '<pre><code class="language-$1">$2</code></pre>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Line breaks
      .replace(/\n/g, '<br>');
  }


  /**
   * Extract system messages and convert to status cards
   */
  private extractSystemCards(message: ProcessedChatMessage): EditCard[] {
    if (!message.content || typeof message.content !== 'string') return [];
    
    const systemCards: EditCard[] = [];
    const systemRegex = /<system>(.*?)<\/system>/gi;
    let match;
    
    while ((match = systemRegex.exec(message.content)) !== null) {
      const systemText = match[1].trim();
      const card = this.createSystemCard(systemText);
      if (card) {
        systemCards.push(card);
      }
    }
    
    return systemCards;
  }

  /**
   * Create a system status card
   */
  private createSystemCard(systemText: string): EditCard | null {
    // Parse system message patterns
    const functionCallPattern = /Function call (\w+) was (accepted|rejected)\.\s*(.*)/i;
    const match = functionCallPattern.exec(systemText);
    
    if (match) {
      const [, functionName, status, details] = match;
      const isAccepted = status.toLowerCase() === 'accepted';
      
      return {
        id: crypto.randomUUID(),
        type: 'system',
        title: isAccepted ? '✅ Function Applied' : '❌ Function Rejected',
        description: this.formatSystemCardDescription(functionName, details, isAccepted),
        isApplied: true, // System cards are always "applied" (completed)
        data: { functionName, status, details },
        onApply: () => {}, // No-op for system cards
        onReject: () => {} // No-op for system cards
      };
    }
    
    // Fallback for other system messages
    return {
      id: crypto.randomUUID(),
      type: 'system',
      title: '📋 System Status',
      description: systemText,
      isApplied: true,
      data: { message: systemText },
      onApply: () => {},
      onReject: () => {}
    };
  }

  /**
   * Format system card description
   */
  private formatSystemCardDescription(functionName: string, details: string, isAccepted: boolean): string {
    const action = this.getFunctionDisplayName(functionName);
    const status = isAccepted ? 'successfully applied' : 'was rejected';
    
    if (details.trim()) {
      return `${action} ${status}: ${details}`;
    } else {
      return `${action} ${status}`;
    }
  }

  /**
   * Get user-friendly function name
   */
  private getFunctionDisplayName(functionName: string): string {
    switch (functionName) {
      case 'initialize_story_objects': return 'Story initialization';
      case 'add_story_objects': return 'Story objects addition';
      case 'edit_story_objects': return 'Story objects modification';
      case 'remove_story_objects': return 'Story objects removal';
      default: return `Function "${functionName}"`;
    }
  }

  /**
   * Generate edit cards from function calls
   */
  generateEditCardsFromFunctionCalls(functionCalls: FunctionCallMetadata[], context: ChatPipelineContext): EditCard[] {
    return functionCalls.map(funcCall => ({
      id: funcCall.id,
      type: this.mapFunctionToEditType(funcCall.function_name),
      title: this.getFunctionCallTitle(funcCall.function_name),
      description: this.generateFunctionCallSummary(funcCall.function_name, funcCall.arguments),
      isApplied: funcCall.isApplied,
      data: funcCall.arguments,
      onApply: () => {}, // Will be set by the chat component
      onReject: () => {} // Will be set by the chat component
    }));
  }

  /**
   * Map function name to edit tag type
   */
  private mapFunctionToEditType(functionName: string): string {
    switch (functionName) {
      case 'initialize_story_objects': return 'init';
      case 'add_story_objects': return 'add';
      case 'edit_story_objects': return 'edit';
      case 'remove_story_objects': return 'remove';
      default: return 'edit';
    }
  }

  /**
   * Get function call title for display
   */
  private getFunctionCallTitle(functionName: string): string {
    switch (functionName) {
      case 'initialize_story_objects': return '🔄 Initialize Story';
      case 'add_story_objects': return '➕ Add Items';
      case 'edit_story_objects': return '✏️ Edit Items';
      case 'remove_story_objects': return '🗑️ Remove Items';
      default: return '📝 Function Call';
    }
  }

  /**
   * Get function call description
   */
  private getFunctionCallDescription(functionName: string): string {
    switch (functionName) {
      case 'initialize_story_objects': return 'Initialize all story objects for the project';
      case 'add_story_objects': return 'Add new story objects to the project';
      case 'edit_story_objects': return 'Modify existing story objects';
      case 'remove_story_objects': return 'Remove story objects from the project';
      default: return 'Execute function call';
    }
  }

  /**
   * Generate function call summary based on arguments
   */
  generateFunctionCallSummary(functionName: string, args: any): string {
    if (!args) return this.getFunctionCallDescription(functionName);
    
    const parts: string[] = [];
    
    // Generate summary based on function arguments
    switch (functionName) {
      case 'initialize_story_objects':
        if (args.basic_info) parts.push('basic info');
        if (args.characters?.length) parts.push(`${args.characters.length} character${args.characters.length > 1 ? 's' : ''}`);
        if (args.organizations?.length) parts.push(`${args.organizations.length} organization${args.organizations.length > 1 ? 's' : ''}`);
        if (args.locations?.length) parts.push(`${args.locations.length} location${args.locations.length > 1 ? 's' : ''}`);
        if (args.lorebook?.length) parts.push(`${args.lorebook.length} lorebook entr${args.lorebook.length > 1 ? 'ies' : 'y'}`);
        if (args.acts?.length) parts.push(`${args.acts.length} act${args.acts.length > 1 ? 's' : ''}`);
        break;
        
      case 'add_story_objects':
        if (args.characters?.length) parts.push(`${args.characters.length} character${args.characters.length > 1 ? 's' : ''}`);
        if (args.organizations?.length) parts.push(`${args.organizations.length} organization${args.organizations.length > 1 ? 's' : ''}`);
        if (args.locations?.length) parts.push(`${args.locations.length} location${args.locations.length > 1 ? 's' : ''}`);
        if (args.lorebook?.length) parts.push(`${args.lorebook.length} lorebook entr${args.lorebook.length > 1 ? 'ies' : 'y'}`);
        if (args.acts?.length) parts.push(`${args.acts.length} act${args.acts.length > 1 ? 's' : ''}`);
        if (args.chapters?.length) parts.push(`${args.chapters.length} chapter${args.chapters.length > 1 ? 's' : ''}`);
        break;
        
      case 'edit_story_objects':
        if (args.basic_info) parts.push('basic info');
        if (args.objects?.length) parts.push(`${args.objects.length} object${args.objects.length > 1 ? 's' : ''}`);
        break;
        
      case 'remove_story_objects':
        if (args.objects?.length) parts.push(`${args.objects.length} object${args.objects.length > 1 ? 's' : ''}`);
        break;
    }
    
    return parts.length > 0 
      ? `${this.getFunctionCallDescription(functionName)}: ${parts.join(', ')}`
      : this.getFunctionCallDescription(functionName);
  }
}

// Edit Card Component
export const EditCardComponent: React.FC<{ card: EditCard }> = ({ card }) => {
  return (
    <div className={`edit-card ${card.isApplied ? 'applied' : 'pending'}`}>
      <div className="edit-card-header">
        <h4 className="edit-card-title">{card.title}</h4>
        <div className="edit-card-status">
          {card.isApplied ? (
            <span className="status-applied">✓ Applied</span>
          ) : (
            <span className="status-pending">⏳ Pending</span>
          )}
        </div>
      </div>
      
      <p className="edit-card-description">{card.description}</p>
      
      {card.data && (
        <div className="edit-card-preview">
          <details>
            <summary>Preview Changes</summary>
            <pre className="json-preview">
              {JSON.stringify(card.data, null, 2)}
            </pre>
          </details>
        </div>
      )}
      
      {!card.isApplied && (
        <div className="edit-card-actions">
          <button 
            className="apply-button"
            onClick={card.onApply}
          >
            Apply
          </button>
          <button 
            className="reject-button"
            onClick={card.onReject}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
};

