export class NovelEditorToolCallService {
  static mapToolToEditType(toolName: string): any {
    switch (toolName) {
      case 'update_manuscript': return 'manuscript';
      default: return 'manuscript';
    }
  }

  static getToolCallTitle(toolName: string): string {
    switch (toolName) {
      case 'update_manuscript': return 'Update Manuscript';
      default: return 'Tool Call';
    }
  }

  static getToolCallDescription(toolName: string): string {
    switch (toolName) {
      case 'update_manuscript': return 'Update manuscript with AI-generated text';
      default: return 'Execute tool call';
    }
  }

  static getToolDisplayName(toolName: string): string {
    switch (toolName) {
      case 'update_manuscript': return 'Manuscript update';
      default: return `Tool "${toolName}"`;
    }
  }

  static generateToolCallSummary(toolName: string, args: any): string {
    if (!args) return this.getToolCallDescription(toolName);

    switch (toolName) {
      case 'update_manuscript':
        const chapterInfo = args.chapterId ? `Chapter ${args.chapterId}` : 'Chapter';
        const wordCount = args.content ? ` (${this.getWordCount(args.content)} words)` : '';
        return `${chapterInfo}${wordCount}`;
      default:
        return this.getToolCallDescription(toolName);
    }
  }

  private static getWordCount(content: string): number {
    return content.trim().split(/\s+/).length;
  }
}