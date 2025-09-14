export class NovelEditorFunctionCallService {
  static mapFunctionToEditType(functionName: string): any {
    switch (functionName) {
      case 'update_chapter_content': return 'chapter_content';
      default: return 'chapter_content';
    }
  }

  static getFunctionCallTitle(functionName: string): string {
    switch (functionName) {
      case 'update_chapter_content': return '📝 Update Chapter Content';
      default: return '📝 Function Call';
    }
  }

  static getFunctionCallDescription(functionName: string): string {
    switch (functionName) {
      case 'update_chapter_content': return 'Update chapter content with AI-generated text';
      default: return 'Execute function call';
    }
  }

  static getFunctionDisplayName(functionName: string): string {
    switch (functionName) {
      case 'update_chapter_content': return 'Chapter content update';
      default: return `Function "${functionName}"`;
    }
  }

  static generateFunctionCallSummary(functionName: string, args: any): string {
    if (!args) return this.getFunctionCallDescription(functionName);

    switch (functionName) {
      case 'update_chapter_content':
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