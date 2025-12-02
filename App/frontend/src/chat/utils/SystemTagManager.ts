import type { LLMRequestPipelineContext } from '../types';
import type { FunctionCallResultSummary, ChatMessage } from '../../llm_request/types';
import { findLastUserMessageIdx } from '../processors/ChatManager';

export interface NovelContentChapter {
  name: string;
  content: string;
}

export interface NovelContentAct {
  name: string;
  chapters: NovelContentChapter[];
}

export class SystemTagManager {
  /**
   * Main function: Generate complete system tag for a message
   * This is the only entry point you should use
   */
  static buildSystemTag(
    processingContent: string,
    context: LLMRequestPipelineContext,
    messageIndex: number,
    allMessages: ChatMessage[]
  ): string 
  {

    // Build system sections using individual checker functions
    const systemSections: string[] = [];

    const functionCallResults = this.extractLastFunctionCallResults(messageIndex, allMessages);
    if (this.shouldIncludeFunctionCallResults(functionCallResults)) 
    {
      systemSections.push(this.buildFunctionCallResultsSection(functionCallResults));
    }

    const LAST_USER_IDX = findLastUserMessageIdx(allMessages);
    if (messageIndex !== LAST_USER_IDX)
    {
      return this.exportSystemTagIncludedContent(systemSections, processingContent);
    }

    // If last user message, include novel content and story context if enabled
    if (this.shouldIncludeStoryContext(context, context.storyObjects))
    {
      systemSections.push(this.buildStoryContextSection(context.storyObjects));
    }
    if (this.shouldIncludeNovelContent(context, context.novelData))
    {
      const novelActs = this.buildNovelContentActs(context.storyObjects, context.novelData);
      if (novelActs.length > 0)
      {
        systemSections.push(this.buildNovelContentSection(novelActs));
      }
    }

    return this.exportSystemTagIncludedContent(systemSections, processingContent);
  }

  private static exportSystemTagIncludedContent(systemSections: string[], messageContent:string | null): string 
  {
    // Combine everything - if no system info, return raw message
    if (systemSections.length === 0) 
    {
      return messageContent || '';
    }

    const systemTag = `<system>\n${systemSections.join('\n\n')}\n</system>`;
    return `${systemTag}\n\n${messageContent}`;
  }

  // Individual checker functions
  private static shouldIncludeStoryContext(context: LLMRequestPipelineContext, storyObjects?: any): boolean {
    return !!(context.systemInsertConfig.includeStoryObjects && storyObjects);
  }

  private static shouldIncludeNovelContent(context: LLMRequestPipelineContext, novelData?: any): boolean {
    return !!(context.systemInsertConfig.includeNovelContent && novelData);
  }

  private static shouldIncludeFunctionCallResults(functionCallResults?: FunctionCallResultSummary[]): boolean {
    return !!(functionCallResults && functionCallResults.length > 0);
  }

  /**
   * Extract function call results from the nearest assistant message above current message index
   */
  private static extractLastFunctionCallResults(messageIndex: number, allMessages: ChatMessage[]): FunctionCallResultSummary[] {
    // Find nearest assistant message
    let assistantMessageIndex = -1;
    for (let i = messageIndex - 1; i >= 0; i--) 
    {
      if (i < 0) break;
      const message = allMessages[i];
      
      if (message.role === 'assistant')
      {
        assistantMessageIndex = i;
        break;
      }
    }

    if (assistantMessageIndex === -1) return []; // If no assistant message found, return empty

    // Extract function call results from that assistant message
    const message = allMessages[assistantMessageIndex];
    if (message.functionCalls && message.functionCalls.length > 0)
    {
      // Found nearest assistant message with function calls
      const appliedFunctionCalls = message.functionCalls.filter(funcCall =>
        funcCall.isApplied && funcCall.appliedAt
      );

      // Convert to FunctionCallResultSummary format
      return appliedFunctionCalls.map(funcCall => ({
        functionCallId: funcCall.id,
        functionName: funcCall.function_name,
        success: this.determineFunctionCallSuccess(funcCall),
        resultMessage: this.extractResultMessage(funcCall),
        appliedAt: funcCall.appliedAt!
      }));
    }

    // No assistant message with function calls found
    return [];
  }

  /**
   * Determine if function call was successful based on stored metadata
   */
  private static determineFunctionCallSuccess(funcCall: any): boolean {
    // If there's an error, it was not successful
    if (funcCall.error) {
      return false;
    }

    // If resultMessage indicates rejection, it was not successful
    if (funcCall.resultMessage?.includes('rejected') || funcCall.resultMessage?.includes('failed')) {
      return false;
    }

    // If it was applied and has a result, it was successful
    if (funcCall.isApplied && funcCall.result) {
      return true;
    }

    // Default: if applied without error, consider successful
    return funcCall.isApplied;
  }

  /**
   * Extract appropriate result message from function call metadata
   */
  private static extractResultMessage(funcCall: any): string {
    // Priority order: resultMessage > error > default success message
    if (funcCall.resultMessage) {
      return funcCall.resultMessage;
    }

    if (funcCall.error) {
      return funcCall.error;
    }

    // Default success message based on function name
    return `Successfully applied ${funcCall.function_name}`;
  }

  // Individual section builders
  private static buildStoryContextSection(storyObjects: any): string {
    return `# Current Project Status
\`\`\`json
${JSON.stringify(this.simplifyStoryObjects(storyObjects), null, 2)}
\`\`\``;
  }

  private static buildNovelContentSection(acts: NovelContentAct[]): string {
    return `# Current Novel Content
\`\`\`json
${JSON.stringify(acts, null, 2)}
\`\`\``;
  }

  private static buildFunctionCallResultsSection(functionCallResults: FunctionCallResultSummary[]): string {
    const results = functionCallResults.map(result =>
      `Function call ${result.functionName} was ${result.success ? 'accepted' : 'rejected'}. ${result.resultMessage}`
    ).join('\n');
    return `# Function Call Results\n${results}`;
  }

  private static buildNovelContentActs(storyObjects: any, novelData: any): NovelContentAct[] {
    if (!storyObjects?.outline?.acts || !novelData) {
      return [];
    }

    return storyObjects.outline.acts.map((act: any) => ({
      name: act.name,
      chapters: act.chapters.map((chapter: any) => {
        const chapterContent = novelData[chapter.id];
        return {
          name: chapter.name,
          content: chapterContent?.content || ''
        };
      })
    }));
  }

  // Keep only the simplifyStoryObjects helper

  /**
   * Simplify story objects for AI context
   */
  private static simplifyStoryObjects(storyObjects: any): any {
    const simplified: any = {};

    // Always include basic_info (even if null/empty)
    if (storyObjects.basicInfo) {
      simplified.basic_info = {
        id: storyObjects.basicInfo.id,
        title: storyObjects.basicInfo.title,
        logline: storyObjects.basicInfo.logline,
        genre: storyObjects.basicInfo.genre
      };
    } else {
      simplified.basic_info = null;
    }

    // Always include characters array (even if empty)
    simplified.characters = (storyObjects.characters || []).map((char: any) => ({
      id: char.id,
      name: char.name,
      description: char.description
    }));

    // Always include organizations array (even if empty)
    simplified.organizations = (storyObjects.organizations || []).map((org: any) => ({
      id: org.id,
      name: org.name,
      description: org.description
    }));

    // Always include locations array (even if empty)
    simplified.locations = (storyObjects.locations || []).map((loc: any) => ({
      id: loc.id,
      name: loc.name,
      description: loc.description
    }));

    // Always include lorebook array (even if empty)
    simplified.lorebook = (storyObjects.lorebook || []).map((entry: any) => ({
      id: entry.id,
      name: entry.name,
      description: entry.description
    }));

    // Always include outline (even if null/empty)
    if (storyObjects.outline) {
      simplified.outline = {
        acts: storyObjects.outline.acts?.map((act: any) => ({
          id: act.id,
          name: act.name,
          description: act.description,
          chapters: act.chapters?.map((chapter: any) => ({
            id: chapter.id,
            name: chapter.name,
            description: chapter.description
          })) || []
        })) || []
      };
    } else {
      simplified.outline = null;
    }

    return simplified;
  }
}
