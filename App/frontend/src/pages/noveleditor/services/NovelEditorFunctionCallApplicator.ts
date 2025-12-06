import type { FunctionCallMetadata } from '../../../llm/requestTypes';
import type { UnifiedObject, UpdateObjectRequest } from '../../../types/unifiedObject';

export interface NovelEditorFunctionCallResult {
  success: boolean;
  message: string;
  error?: string;
}

export interface UnifiedStoreActions {
  getManuscriptByChapterId: (chapterId: string) => UnifiedObject | null;
  updateObject: (type: 'manuscript', id: string, request: UpdateObjectRequest) => Promise<void>;
  listObjects: (type: 'manuscript', projectId: string) => Promise<UnifiedObject[]>;
  createObject: (
    type: 'manuscript',
    projectId: string,
    data: any,
    language: string,
    metadata?: Record<string, any>
  ) => Promise<UnifiedObject>;
}

export interface ApplicatorConfig {
  store: UnifiedStoreActions;
  language: string;
}

export class NovelEditorFunctionCallApplicator {
  private store: UnifiedStoreActions;
  private language: string;

  constructor(config: ApplicatorConfig) {
    this.store = config.store;
    this.language = config.language;
  }

  async applyFunctionCall(
    projectId: string,
    functionCall: FunctionCallMetadata
  ): Promise<NovelEditorFunctionCallResult> {
    try {
      switch (functionCall.function_name) {
        case 'update_manuscript':
          return await this.applyUpdateManuscript(projectId, functionCall.arguments);
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

  private async applyUpdateManuscript(
    projectId: string,
    args: any
  ): Promise<NovelEditorFunctionCallResult> {
    console.log('NovelEditorFunctionCallApplicator: applyUpdateManuscript called', { projectId, args });

    if (!args || !args.chapterId || !args.content) {
      return {
        success: false,
        message: 'Invalid update_manuscript arguments',
        error: 'Function must receive chapterId and content'
      };
    }

    try {
      // Step 1: Try to find manuscript in store
      let manuscriptObj = this.store.getManuscriptByChapterId(args.chapterId);

      // Step 2: If not in store, try to fetch from API
      if (!manuscriptObj) {
        console.log('NovelEditorFunctionCallApplicator: Manuscript not in store, fetching from API...');
        const manuscripts = await this.store.listObjects('manuscript', projectId);
        manuscriptObj = manuscripts.find(m => m.metadata?.chapter_id === args.chapterId) || null;
      }

      // Step 3: If still not found, create new manuscript
      if (!manuscriptObj) {
        console.log('NovelEditorFunctionCallApplicator: Manuscript not found, creating new one...');
        manuscriptObj = await this.store.createObject(
          'manuscript',
          projectId,
          { content: '', wordCount: 0 },
          this.language,
          { chapter_id: args.chapterId }
        );
      }

      // Calculate word count
      const wordCount = args.content.trim().split(/\s+/).filter(Boolean).length;

      // Update via unified object store
      console.log('NovelEditorFunctionCallApplicator: Calling store.updateObject');
      await this.store.updateObject('manuscript', manuscriptObj.id, {
        data: {
          content: args.content,
          wordCount,
        },
        language: this.language,
        create_new_version: true,
        user_request: 'AI Generated Content',
      });

      return {
        success: true,
        message: `Successfully updated manuscript`
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to update manuscript',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}
