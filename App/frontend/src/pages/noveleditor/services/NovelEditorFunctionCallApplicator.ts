import type { FunctionCallMetadata } from '../../../llm_request/types';

export interface NovelEditorFunctionCallResult {
  success: boolean;
  message: string;
  error?: string;
}

export interface NovelStoreActions {
  updateChapterContent: (projectId: string, chapterId: string, content: string, userRequest?: string) => void;
}

export class NovelEditorFunctionCallApplicator {
  private novelStoreActions: NovelStoreActions;

  constructor(novelStoreActions: NovelStoreActions) {
    this.novelStoreActions = novelStoreActions;
  }

  async applyFunctionCall(
    projectId: string,
    functionCall: FunctionCallMetadata
  ): Promise<NovelEditorFunctionCallResult> {
    try {
      switch (functionCall.function_name) {
        case 'update_chapter_content':
          return await this.applyUpdateChapterContent(projectId, functionCall.arguments);
        default:
          return {
            success: false,
            message: 'Unknown function name',
            error: `Unsupported function: ${functionCall.function_name}`
          };
      }
    } catch (error) {
      return {
        success: false,
        message: 'Failed to apply function call',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async applyUpdateChapterContent(
    projectId: string,
    args: any
  ): Promise<NovelEditorFunctionCallResult> {
    console.log('NovelEditorFunctionCallApplicator: applyUpdateChapterContent called', { projectId, args });

    if (!args || !args.chapterId || !args.content) {
      return {
        success: false,
        message: 'Invalid update_chapter_content arguments',
        error: 'Function must receive chapterId and content'
      };
    }

    try {
      // Update chapter content with the AI-generated content
      console.log('NovelEditorFunctionCallApplicator: Calling novelStoreActions.updateChapterContent');
      this.novelStoreActions.updateChapterContent(
        projectId,
        args.chapterId,
        args.content
      );

      return {
        success: true,
        message: `Successfully updated chapter content`
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to update chapter content',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}