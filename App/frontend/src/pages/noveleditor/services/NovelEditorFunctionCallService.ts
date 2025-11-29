export class NovelEditorFunctionCallService {
  static mapFunctionToEditType(functionName: string): any {
    switch (functionName) {
      case 'update_manuscript': return 'manuscript';
      default: return 'manuscript';
    }
  }

  static getFunctionCallTitle(functionName: string): string {
    switch (functionName) {
      case 'update_manuscript': return '📝 Update Manuscript';
      default: return '📝 Function Call';
    }
  }

  static getFunctionCallDescription(functionName: string): string {
    switch (functionName) {
      case 'update_manuscript': return 'Update manuscript with AI-generated text';
      default: return 'Execute function call';
    }
  }

  static getFunctionDisplayName(functionName: string): string {
    switch (functionName) {
      case 'update_manuscript': return 'Manuscript update';
      default: return `Function "${functionName}"`;
    }
  }

  static generateFunctionCallSummary(functionName: string, args: any): string {
    if (!args) return this.getFunctionCallDescription(functionName);

    switch (functionName) {
      case 'update_manuscript':
        const chapterInfo = args.chapterId ? `Chapter ${args.chapterId}` : 'Chapter';
        const wordCount = args.content ? ` (${this.getWordCount(args.content)} words)` : '';
        return `${chapterInfo}${wordCount}`;
      default:
        return this.getFunctionCallDescription(functionName);
    }
  }

  private static getWordCount(content: string): number {
    return content.trim().split(/\s+/).length;
  }
}