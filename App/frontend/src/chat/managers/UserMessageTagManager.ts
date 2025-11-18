import type { ChatMessage, FunctionCallResultSummary } from '../../llm_request/types';
import type { ChatPipelineContext } from '../types';
import { findLastUserMessageIdx } from '../processors/ChatManager';
import { TemplateRenderer, type RenderContext } from '../utils/TemplateRenderer';

import lastUserMessageTemplate from './prompts/userMessageSystemPrompts/LastUserMessageTag.md?raw';
import nonLastUserMessageTemplate from './prompts/userMessageSystemPrompts/NonLastUserMessageTag.md?raw';

/**
 * Enum defining different types of user message tags
 */
const USER_TAG_TYPE = {
  LAST_USER_MESSAGE: 'last_user_message',
  NON_LAST_USER_MESSAGE: 'non_last_user_message',
} as const;

export type UserTagType = typeof USER_TAG_TYPE[keyof typeof USER_TAG_TYPE];
export const UserTagType = USER_TAG_TYPE;

/**
 * Context for last user message (can include everything)
 */
export interface LastUserMessageTagContext {
  // Function call results from previous assistant
  functionCallResults?: FunctionCallResultSummary[];

  // Story/Novel context (only if enabled)
  storyObjects?: any;
  novelData?: any;

  // Control flags
  includeStoryContext?: boolean;
  includeNovelContent?: boolean;

  // Custom additions
  customSections?: CustomSection[];
}

/**
 * Context for non-last user message (minimal - only function results)
 */
export interface NonLastUserMessageTagContext {
  // Only function call results
  functionCallResults?: FunctionCallResultSummary[];
}

/**
 * Custom section that can be added to the tag
 */
export interface CustomSection {
  heading: string;
  content: string;
  format?: 'json' | 'text' | 'markdown';
}

interface NovelContentChapter {
  name: string;
  content: string;
}

interface NovelContentAct {
  name: string;
  chapters: NovelContentChapter[];
}

/**
 * Centralized user message tag manager that renders markdown templates with placeholders
 * Similar to SystemPromptManager but for <system> tags appended to user messages
 */
export class UserMessageTagManager {
  /**
   * Generate user message tag based on type and context - Overloaded for type safety
   */
  static generateTag(type: typeof UserTagType.LAST_USER_MESSAGE, context: LastUserMessageTagContext): string;
  static generateTag(type: typeof UserTagType.NON_LAST_USER_MESSAGE, context: NonLastUserMessageTagContext): string;
  static generateTag(type: UserTagType, context: unknown): string {
    switch (type) {
      case UserTagType.LAST_USER_MESSAGE:
        return this.generateLastUserMessageTag(context as LastUserMessageTagContext);
      case UserTagType.NON_LAST_USER_MESSAGE:
        return this.generateNonLastUserMessageTag(context as NonLastUserMessageTagContext);
      default:
        throw new Error(`Unknown user tag type: ${type}`);
    }
  }

  /**
   * Main entry point - replaces SystemTagManager.buildSystemTag
   * Determines if this is the last user message and generates appropriate tag
   */
  static buildSystemTag(
    userMessageContent: string,
    context: ChatPipelineContext,
    messageIndex: number,
    allMessages: ChatMessage[]
  ): string {
    const functionCallResults = this.extractLastFunctionCallResults(messageIndex, allMessages);
    const isLastUserMessage = findLastUserMessageIdx(allMessages) === messageIndex;

    if (isLastUserMessage) {
      // Last user message - can include everything
      const tagContext: LastUserMessageTagContext = {
        functionCallResults,
        storyObjects: context.storyObjects,
        novelData: context.novelData,
        includeStoryContext: context.systemInsertConfig.includeStoryObjects,
        includeNovelContent: context.systemInsertConfig.includeNovelContent,
      };

      const tag = this.generateTag(UserTagType.LAST_USER_MESSAGE, tagContext);
      return this.wrapUserMessageWithTag(userMessageContent, tag);
    } else {
      // Non-last user message - only function results
      const tagContext: NonLastUserMessageTagContext = {
        functionCallResults,
      };

      const tag = this.generateTag(UserTagType.NON_LAST_USER_MESSAGE, tagContext);
      return this.wrapUserMessageWithTag(userMessageContent, tag);
    }
  }

  /**
   * Validate context based on tag type
   */
  static validateContext(type: typeof UserTagType.LAST_USER_MESSAGE, context: LastUserMessageTagContext): { isValid: boolean; errors: string[] };
  static validateContext(type: typeof UserTagType.NON_LAST_USER_MESSAGE, context: NonLastUserMessageTagContext): { isValid: boolean; errors: string[] };
  static validateContext(_type: UserTagType, _context: unknown): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Both types have optional contexts, so validation is minimal
    // Could add more specific validation if needed

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Wrap user message content with system tag
   */
  private static wrapUserMessageWithTag(messageContent: string, tag: string): string {
    // If tag is effectively empty, just return message content
    if (!tag || tag.trim() === '' || tag.trim() === '<system>\n\n</system>') {
      return messageContent;
    }

    // Wrap tag in <system> tags and append to message
    const systemTag = `<system>\n${tag}\n</system>`;
    return `${systemTag}\n\n${messageContent}`;
  }

  /**
   * Generate tag for last user message (includes everything)
   */
  private static generateLastUserMessageTag(context: LastUserMessageTagContext): string {
    const renderContext: RenderContext = {
      context: {
        functionResults: this.formatFunctionResults(context.functionCallResults),
        storyContext: this.formatStoryContext(context),
        novelContent: this.formatNovelContent(context),
        customSections: this.formatCustomSections(context.customSections),
      },
    };

    return this.renderUserMessageTemplate(
      'chat/userMessageTag/lastMessage',
      lastUserMessageTemplate,
      renderContext
    );
  }

  /**
   * Generate tag for non-last user message (only function results)
   */
  private static generateNonLastUserMessageTag(context: NonLastUserMessageTagContext): string {
    const renderContext: RenderContext = {
      context: {
        functionResults: this.formatFunctionResults(context.functionCallResults),
      },
    };

    return this.renderUserMessageTemplate(
      'chat/userMessageTag/nonLastMessage',
      nonLastUserMessageTemplate,
      renderContext
    );
  }

  private static renderUserMessageTemplate(
    templateId: string,
    template: string,
    renderContext: RenderContext
  ): string {
    const rendered = TemplateRenderer.render(template, renderContext, { templateId });
    return rendered.replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Format function call results section
   */
  private static formatFunctionResults(functionCallResults?: FunctionCallResultSummary[]): string {
    if (!functionCallResults || functionCallResults.length === 0) {
      return '';
    }

    const results = functionCallResults.map(result =>
      `Function call ${result.functionName} was ${result.success ? 'accepted' : 'rejected'}. ${result.resultMessage}`
    ).join('\n');

    return `# Function Call Results\n${results}`;
  }

  /**
   * Format story context section
   */
  private static formatStoryContext(context: LastUserMessageTagContext): string {
    if (!context.includeStoryContext || !context.storyObjects) {
      return '';
    }

    return `# Current Project Status\n\`\`\`json\n${JSON.stringify(this.simplifyStoryObjects(context.storyObjects), null, 2)}\n\`\`\``;
  }

  /**
   * Format novel content section
   */
  private static formatNovelContent(context: LastUserMessageTagContext): string {
    if (!context.includeNovelContent || !context.novelData || !context.storyObjects) {
      return '';
    }

    const novelActs = this.buildNovelContentActs(context.storyObjects, context.novelData);
    if (novelActs.length === 0) {
      return '';
    }

    return `# Current Novel Content\n\`\`\`json\n${JSON.stringify(novelActs, null, 2)}\n\`\`\``;
  }

  /**
   * Format custom sections
   */
  private static formatCustomSections(sections?: CustomSection[]): string {
    if (!sections || sections.length === 0) {
      return '';
    }

    return sections.map(section => {
      const heading = `# ${section.heading}`;
      let content = section.content;

      // Format content based on specified format
      if (section.format === 'json') {
        try {
          const parsed = typeof content === 'string' ? JSON.parse(content) : content;
          content = `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
        } catch {
          content = `\`\`\`json\n${content}\n\`\`\``;
        }
      } else if (section.format === 'text') {
        content = `\`\`\`text\n${content}\n\`\`\``;
      }
      // markdown format or no format - use as-is

      return `${heading}\n${content}`;
    }).join('\n\n');
  }

  /**
   * Build novel content acts structure
   */
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

  /**
   * Extract function call results from the nearest assistant message above current message index
   */
  private static extractLastFunctionCallResults(messageIndex: number, allMessages: ChatMessage[]): FunctionCallResultSummary[] {
    // Find nearest assistant message
    let assistantMessageIndex = -1;
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (i < 0) break;
      const message = allMessages[i];

      if (message.role === 'assistant') {
        assistantMessageIndex = i;
        break;
      }
    }

    if (assistantMessageIndex === -1) return []; // If no assistant message found, return empty

    // Extract function call results from that assistant message
    const message = allMessages[assistantMessageIndex];
    if (message.functionCalls && message.functionCalls.length > 0) {
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
}

