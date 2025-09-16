import React from 'react';
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

marked.setOptions({
  gfm: true,
  breaks: true,
});

// Component to display preview changes in a user-friendly format
const PreviewChangesComponent: React.FC<{ data: any }> = ({ data }) => {
  const renderValue = (value: any): React.ReactNode => {
    if (value === null || value === undefined) {
      return <span className="preview-null">null</span>;
    }
    
    if (typeof value === 'boolean') {
      return <span className="preview-boolean">{value.toString()}</span>;
    }
    
    if (typeof value === 'number') {
      return <span className="preview-number">{value}</span>;
    }
    
    if (typeof value === 'string') {
      // Show strings with limited length
      if (value.length > 100) {
        return <span className="preview-string" title={value}>{value.substring(0, 100)}...</span>;
      }
      return <span className="preview-string">{value}</span>;
    }
    
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return <span className="preview-empty">[]</span>;
      }
      
      // For simple arrays (strings, numbers, booleans), show compactly
      const isSimpleArray = value.every(item => 
        typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
      );
      
      if (isSimpleArray && value.length <= 5) {
        return (
          <div className="preview-array-compact">
            <span className="preview-array-header">Array ({value.length}): </span>
            <span className="preview-array-values">
              {value.map((item, index) => (
                <span key={index} className="preview-array-value">
                  {renderValue(item)}
                  {index < value.length - 1 && <span className="preview-separator">, </span>}
                </span>
              ))}
            </span>
          </div>
        );
      }
      
      // For complex arrays or long arrays, show in full format
      return (
        <div className="preview-array">
          <div className="preview-array-header">Array ({value.length} items):</div>
          {value.map((item, index) => (
            <div key={index} className="preview-array-item">
              <span className="preview-index">[{index}]</span>
              <div className="preview-array-item-content">{renderValue(item)}</div>
            </div>
          ))}
        </div>
      );
    }
    
    if (typeof value === 'object') {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        return <span className="preview-empty">{}</span>;
      }
      return (
        <div className="preview-object">
          {entries.map(([objKey, objValue]) => (
            <div key={objKey} className="preview-object-item">
              <span className="preview-key">{objKey}:</span>
              <div className="preview-value">{renderValue(objValue)}</div>
            </div>
          ))}
        </div>
      );
    }
    
    return <span className="preview-unknown">{String(value)}</span>;
  };

  return (
    <div className="preview-changes">
      {renderValue(data)}
    </div>
  );
};

export class DefaultDisplayProcessor implements DisplayProcessor {
  process(
    message: ProcessedChatMessage,
    _context: ChatPipelineContext
  ): DisplayProcessingResult {
    let editCards: EditCard[] = [];

    if (message.role === 'assistant') {
      // Assistant messages: show function call cards (both applied and unapplied)
      if (message.functionCalls && message.functionCalls.length > 0) {
        editCards = this.generateEditCardsFromFunctionCalls(message.functionCalls);
      } 
    } else if (message.role === 'user') {
      // User messages: no longer show system cards - they're handled by function call cards directly
      editCards = [];
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

    // Only remove system tags for user messages, not assistant messages
    if (message.role === 'user') {
      content = this.removeSystemTags(content);
    }
    
    // Render markdown content with full syntax support
    content = this.processMarkdown(content);

    return (
      <div 
        className="message-text"
        dangerouslySetInnerHTML={{ __html: content }}
      />
    );
  }


  /**
   * Remove system tags from content for display
   */
  private removeSystemTags(content: string): string {
    if (!content || typeof content !== 'string') return '';
    
    // Remove system tags while preserving user content
    // Be very careful to only remove complete <system>...</system> blocks
    let result = content;
    
    // Match system tags with proper boundaries
    const systemTagRegex = /<system>\s*[\s\S]*?\s*<\/system>\s*/gi;
    result = result.replace(systemTagRegex, '');
    
    // Clean up multiple consecutive newlines but preserve single ones
    result = result.replace(/\n\s*\n\s*\n/g, '\n\n');
    result = result.trim();
    
    return result;
  }


  private processMarkdown(content: string): string {
    const parsed = marked.parse(content, { async: false });
    const html = typeof parsed === 'string' ? parsed : '';
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }



  /**
   * Generate edit cards from function calls
   */
  generateEditCardsFromFunctionCalls(functionCalls: FunctionCallMetadata[]): EditCard[] {
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
      
      {card.data && !card.isApplied && (
        <div className="edit-card-preview">
          <details>
            <summary>Preview Changes</summary>
            <PreviewChangesComponent data={card.data} />
          </details>
        </div>
      )}
      
      {!card.isApplied ? (
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
      ) : (
        <div className="edit-card-applied-info">
          <span className="applied-timestamp">
            {card.appliedAt ? `Applied at ${new Date(card.appliedAt).toLocaleTimeString()}` : 'Applied'}
          </span>
        </div>
      )}
    </div>
  );
};




