import React from 'react';
import type { EditTagMetadata } from '../../llm_request/types';
import type { 
  DisplayProcessor, 
  DisplayProcessingResult, 
  ProcessedChatMessage, 
  EditCard,
  EditTag,
  EditTagType,
  ChatPipelineContext 
} from '../types';

export class DefaultDisplayProcessor implements DisplayProcessor {
  process(
    message: ProcessedChatMessage,
    context: ChatPipelineContext
  ): DisplayProcessingResult {
    // Use existing edit tags from message or extract new ones
    let editTagsMetadata: EditTagMetadata[] = [];
    
    if (message.editTags && message.editTags.length > 0) {
      // Use persisted edit tags
      editTagsMetadata = message.editTags;
    } else {
      // Extract new edit tags from content
      const extractedEditTags = this.extractEditTags(message.content);
      editTagsMetadata = this.convertToMetadata(extractedEditTags);
    }
    
    // Process message content for display
    const displayContent = this.processMessageContent(message);
    
    // Generate edit cards from edit tags metadata
    const editCards = this.generateEditCardsFromMetadata(editTagsMetadata, context);

    return {
      displayContent,
      editCards
    };
  }

  private extractEditTags(content: string): EditTag[] {
    const editTags: EditTag[] = [];
    
    // Extract init tags
    const initMatches = this.extractTagMatches(content, 'init');
    initMatches.forEach(match => {
      editTags.push({
        type: 'init',
        content: match.jsonContent,
        id: crypto.randomUUID(),
        isApplied: false,
        summary: 'Initialize story objects'
      });
    });

    // Extract add tags
    const addMatches = this.extractTagMatches(content, 'add');
    addMatches.forEach(match => {
      editTags.push({
        type: 'add',
        content: match.jsonContent,
        id: crypto.randomUUID(),
        isApplied: false,
        summary: this.generateAddSummary(match.jsonContent)
      });
    });

    // Extract edit tags
    const editMatches = this.extractTagMatches(content, 'edit');
    editMatches.forEach(match => {
      editTags.push({
        type: 'edit',
        content: match.jsonContent,
        id: crypto.randomUUID(),
        isApplied: false,
        summary: this.generateEditSummary(match.jsonContent)
      });
    });

    // Extract remove tags
    const removeMatches = this.extractTagMatches(content, 'remove');
    removeMatches.forEach(match => {
      editTags.push({
        type: 'remove',
        content: match.jsonContent,
        id: crypto.randomUUID(),
        isApplied: false,
        summary: this.generateRemoveSummary(match.jsonContent)
      });
    });

    return editTags;
  }

  private extractTagMatches(content: string, tagType: string): { jsonContent: any; rawMatch: string }[] {
    const regex = new RegExp(`<${tagType}>[\\s\\S]*?<\\/${tagType}>`, 'gi');
    const matches = content.match(regex) || [];
    
    return matches.map(match => {
      // Extract JSON content from the tag
      const jsonMatch = match.match(/```json\n([\s\S]*?)\n```/);
      let jsonContent = null;
      
      if (jsonMatch) {
        try {
          jsonContent = JSON.parse(jsonMatch[1]);
        } catch (e) {
          console.warn(`Failed to parse JSON in ${tagType} tag:`, e);
          jsonContent = { error: 'Invalid JSON format' };
        }
      }
      
      return {
        jsonContent,
        rawMatch: match
      };
    });
  }

  private generateAddSummary(data: any): string {
    if (!data) return 'Add items';
    
    const parts: string[] = [];
    
    if (data.characters?.length) {
      const names = data.characters.map((c: any) => c.name).filter(Boolean);
      parts.push(`${data.characters.length} character${data.characters.length > 1 ? 's' : ''}`);
      if (names.length > 0) {
        parts[parts.length - 1] += ` (${names.join(', ')})`;
      }
    }
    
    if (data.organizations?.length) {
      const names = data.organizations.map((o: any) => o.name).filter(Boolean);
      parts.push(`${data.organizations.length} organization${data.organizations.length > 1 ? 's' : ''}`);
      if (names.length > 0) {
        parts[parts.length - 1] += ` (${names.join(', ')})`;
      }
    }
    
    if (data.locations?.length) {
      const names = data.locations.map((l: any) => l.name).filter(Boolean);
      parts.push(`${data.locations.length} location${data.locations.length > 1 ? 's' : ''}`);
      if (names.length > 0) {
        parts[parts.length - 1] += ` (${names.join(', ')})`;
      }
    }
    
    if (data.acts?.length) {
      const names = data.acts.map((a: any) => a.name).filter(Boolean);
      parts.push(`${data.acts.length} act${data.acts.length > 1 ? 's' : ''}`);
      if (names.length > 0) {
        parts[parts.length - 1] += ` (${names.join(', ')})`;
      }
    }
    
    if (data.chapters?.length) {
      const names = data.chapters.map((c: any) => c.name).filter(Boolean);
      parts.push(`${data.chapters.length} chapter${data.chapters.length > 1 ? 's' : ''}`);
      if (names.length > 0) {
        parts[parts.length - 1] += ` (${names.join(', ')})`;
      }
    }
    
    return parts.length > 0 ? `Add ${parts.join(', ')}` : 'Add items';
  }

  private generateEditSummary(data: any): string {
    if (!data) return 'Edit items';
    
    const parts: string[] = [];
    
    if (data.basic_info) {
      const changes: string[] = [];
      if (data.basic_info.title) changes.push('title');
      if (data.basic_info.logline) changes.push('logline');
      if (data.basic_info.genre) changes.push('genre');
      parts.push(`basic info${changes.length > 0 ? ` (${changes.join(', ')})` : ''}`);
    }
    
    if (data.objects?.length) {
      const names = data.objects.map((o: any) => o.name).filter(Boolean);
      parts.push(`${data.objects.length} object${data.objects.length > 1 ? 's' : ''}`);
      if (names.length > 0) {
        parts[parts.length - 1] += ` (${names.join(', ')})`;
      }
    }
    
    return parts.length > 0 ? `Edit ${parts.join(', ')}` : 'Edit items';
  }

  private generateRemoveSummary(data: any): string {
    if (!data) return 'Remove items';
    
    if (Array.isArray(data)) {
      return `Remove ${data.length} item${data.length > 1 ? 's' : ''}`;
    }
    
    return 'Remove items';
  }

  private processMessageContent(message: ProcessedChatMessage): React.ReactNode {
    let content = message.originalContent || message.content;

    // Remove edit tags from display content
    content = this.removeEditTags(content);
    
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

  private removeEditTags(content: string): string {
    // Replace edit tags with inline preview cards instead of removing them
    let processedContent = content;

    // Replace init tags
    processedContent = processedContent.replace(/<init>([\s\S]*?)<\/init>/gi, (match) => {
      return this.createInlineTagCard('init', 'Initialize Story', '🔄', '#007bff');
    });

    // Replace add tags
    processedContent = processedContent.replace(/<add>([\s\S]*?)<\/add>/gi, (match) => {
      const summary = this.extractTagSummary(match, 'add');
      return this.createInlineTagCard('add', summary || 'Add Items', '➕', '#28a745');
    });

    // Replace edit tags
    processedContent = processedContent.replace(/<edit>([\s\S]*?)<\/edit>/gi, (match) => {
      const summary = this.extractTagSummary(match, 'edit');
      return this.createInlineTagCard('edit', summary || 'Edit Items', '✏️', '#ffc107');
    });

    // Replace remove tags
    processedContent = processedContent.replace(/<remove>([\s\S]*?)<\/remove>/gi, (match) => {
      const summary = this.extractTagSummary(match, 'remove');
      return this.createInlineTagCard('remove', summary || 'Remove Items', '🗑️', '#dc3545');
    });

    // Remove system tags (these shouldn't be shown to user)
    processedContent = processedContent.replace(/<system>[\s\S]*?<\/system>/gi, '');

    return processedContent.trim();
  }

  private createInlineTagCard(type: string, title: string, icon: string, color: string): string {
    return `<div class="inline-tag-card inline-tag-${type}" style="border-color: ${color};">
      <span class="inline-tag-icon">${icon}</span>
      <span class="inline-tag-title">${title}</span>
    </div>`;
  }

  private extractTagSummary(tagMatch: string, tagType: string): string | null {
    try {
      const jsonMatch = tagMatch.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[1]);
        
        if (tagType === 'add') {
          return this.generateAddSummary(data);
        } else if (tagType === 'edit') {
          return this.generateEditSummary(data);
        } else if (tagType === 'remove') {
          return this.generateRemoveSummary(data);
        }
      }
    } catch (e) {
      // If parsing fails, return null to use default
    }
    return null;
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

  private generateEditCards(editTags: EditTag[], context: ChatPipelineContext): EditCard[] {
    return editTags.map(tag => ({
      id: tag.id,
      type: tag.type,
      title: this.getCardTitle(tag),
      description: tag.summary || this.getCardDescription(tag),
      isApplied: tag.isApplied || false,
      data: tag.content,
      onApply: () => this.handleApplyEdit(tag, context),
      onReject: () => this.handleRejectEdit(tag, context)
    }));
  }

  private convertToMetadata(editTags: EditTag[]): EditTagMetadata[] {
    return editTags.map(tag => ({
      id: tag.id,
      type: tag.type,
      content: tag.content,
      summary: tag.summary || this.getDefaultSummary(tag.type),
      isApplied: tag.isApplied || false,
      appliedAt: undefined
    }));
  }

  private generateEditCardsFromMetadata(editTagsMetadata: EditTagMetadata[], context: ChatPipelineContext): EditCard[] {
    return editTagsMetadata.map(tag => ({
      id: tag.id,
      type: tag.type,
      title: this.getCardTitleFromType(tag.type),
      description: tag.summary,
      isApplied: tag.isApplied,
      data: tag.content,
      onApply: () => {
        // This will be overridden by Chat.tsx when creating the final edit cards
        console.log('Apply button clicked for tag:', tag.id);
      },
      onReject: () => {
        // This will be overridden by Chat.tsx when creating the final edit cards
        console.log('Reject button clicked for tag:', tag.id);
      }
    }));
  }

  private getDefaultSummary(type: string): string {
    switch (type) {
      case 'init': return 'Initialize story objects';
      case 'add': return 'Add items';
      case 'edit': return 'Edit items';
      case 'remove': return 'Remove items';
      default: return 'Edit operation';
    }
  }

  private getCardTitleFromType(type: string): string {
    switch (type) {
      case 'init': return '🔄 Initialize Story';
      case 'add': return '➕ Add Items';
      case 'edit': return '✏️ Edit Items';
      case 'remove': return '🗑️ Remove Items';
      default: return '📝 Edit';
    }
  }

  private handleApplyEditMetadata(tag: EditTagMetadata, context: ChatPipelineContext): void {
    // This will be implemented to actually apply the edits to the store
    console.log('Applying edit metadata:', tag);
    // TODO: Update the tag status in chat store
    // TODO: Apply changes to story object store
  }

  private handleRejectEditMetadata(tag: EditTagMetadata, context: ChatPipelineContext): void {
    // This will be implemented to reject the edit
    console.log('Rejecting edit metadata:', tag);
    // TODO: Update the tag status in chat store
  }

  private getCardTitle(tag: EditTag): string {
    switch (tag.type) {
      case 'init':
        return '🔄 Initialize Story';
      case 'add':
        return '➕ Add Items';
      case 'edit':
        return '✏️ Edit Items';
      case 'remove':
        return '🗑️ Remove Items';
      default:
        return '📝 Edit';
    }
  }

  private getCardDescription(tag: EditTag): string {
    switch (tag.type) {
      case 'init':
        return 'Initialize and overwrite story objects with new data';
      case 'add':
        return 'Add new story objects to the project';
      case 'edit':
        return 'Modify existing story objects';
      case 'remove':
        return 'Remove story objects from the project';
      default:
        return 'Perform story object operation';
    }
  }

  private handleApplyEdit(tag: EditTag, context: ChatPipelineContext): void {
    // This would be implemented to actually apply the edits to the store
    console.log('Applying edit:', tag);
    // TODO: Implement actual edit application logic
    // This would interact with the story object store to apply changes
  }

  private handleRejectEdit(tag: EditTag, context: ChatPipelineContext): void {
    // This would be implemented to reject the edit
    console.log('Rejecting edit:', tag);
    // TODO: Implement edit rejection logic
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