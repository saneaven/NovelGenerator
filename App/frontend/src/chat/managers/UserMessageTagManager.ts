import type { ChatMessage, FunctionCallResultSummary } from '../../llm_request/types';
import type { ChatPipelineContext } from '../types';
import { findLastUserMessageIdx } from '../processors/ChatManager';
import { renderTemplate } from '../../templateEngine/engine';
import { useSettingsStore } from '../../store/settingsStore';
// import type { PromptCategory, FunctionType } from '../../types/prompts'; // Not strictly needed if we use string literals, but good for reference.
// Removing unused imports to fix lint errors.

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

  // Output language
  outputLanguage?: string;
}

/**
 * Context for non-last user message (minimal - only function results)
 */
export interface NonLastUserMessageTagContext {
  // Only function call results
  functionCallResults?: FunctionCallResultSummary[];

  // Output language
  outputLanguage?: string;
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
  static async generateTag(type: typeof UserTagType.LAST_USER_MESSAGE, context: LastUserMessageTagContext): Promise<string>;
  static async generateTag(type: typeof UserTagType.NON_LAST_USER_MESSAGE, context: NonLastUserMessageTagContext): Promise<string>;
  static async generateTag(type: UserTagType, context: unknown): Promise<string> {
    switch (type) {
      case UserTagType.LAST_USER_MESSAGE:
        return await this.generateLastUserMessageTag(context as LastUserMessageTagContext);
      case UserTagType.NON_LAST_USER_MESSAGE:
        return await this.generateNonLastUserMessageTag(context as NonLastUserMessageTagContext);
      default:
        throw new Error(`Unknown user tag type: ${type}`);
    }
  }

  /**
   * Main entry point - replaces SystemTagManager.buildSystemTag
   * Determines if this is the last user message and generates appropriate tag
   */
  static async buildSystemTag(
    userMessageContent: string,
    context: ChatPipelineContext,
    messageIndex: number,
    allMessages: ChatMessage[],
    outputLanguage?: string
  ): Promise<string> {
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
        outputLanguage,
      };

      const tag = await this.generateTag(UserTagType.LAST_USER_MESSAGE, tagContext);
      return this.wrapUserMessageWithTag(userMessageContent, tag);
    } else {
      // Non-last user message - only function results
      const tagContext: NonLastUserMessageTagContext = {
        functionCallResults,
        outputLanguage,
      };

      const tag = await this.generateTag(UserTagType.NON_LAST_USER_MESSAGE, tagContext);
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
  private static async generateLastUserMessageTag(context: LastUserMessageTagContext): Promise<string> {
    const data = {
      variable: {
        language: this.resolveLanguage(context.outputLanguage),
      },
      context: {
        functionResults: context.functionCallResults || [],
        storyContext: context.includeStoryContext ? this.simplifyStoryObjects(context.storyObjects) : null,
        novelContent: context.includeNovelContent ? this.buildNovelContentActs(context.storyObjects, context.novelData) : null,
        customSections: context.customSections || [],
      }
    };

    const template = await useSettingsStore.getState().loadPrompt('chat', 'userMessageTag', 'lastMessage');

    return this.renderUserMessageTemplate(
      'chat/userMessageTag/lastMessage',
      template,
      data
    );
  }

  /**
   * Generate tag for non-last user message (only function results)
   */
  private static async generateNonLastUserMessageTag(context: NonLastUserMessageTagContext): Promise<string> {
    const data = {
      variable: {
        language: this.resolveLanguage(context.outputLanguage),
      },
      context: {
        functionResults: context.functionCallResults || [],
      }
    };

    const template = await useSettingsStore.getState().loadPrompt('chat', 'userMessageTag', 'nonLastMessage');

    return this.renderUserMessageTemplate(
      'chat/userMessageTag/nonLastMessage',
      template,
      data
    );
  }

  private static renderUserMessageTemplate(
    _templateId: string,
    template: string,
    data: any
  ): string {
    const rendered = renderTemplate(template, data);
    return rendered.replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Resolve language parameter to a display string
   */
  private static resolveLanguage(language?: string): string {
    const trimmed = language ? language.trim() : '';
    return trimmed.length > 0 ? trimmed : 'the language used by the user';
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
      // Include all confirmed function calls (both applied and rejected)
      const confirmedFunctionCalls = message.functionCalls.filter(funcCall =>
        funcCall.isApplied && funcCall.appliedAt
      );

      // Convert to FunctionCallResultSummary format
      return confirmedFunctionCalls.map(funcCall => ({
        functionCallId: funcCall.id,
        functionName: funcCall.function_name,
        success: this.determineFunctionCallSuccess(funcCall),
        isRejected: funcCall.isRejected ?? false, // Include rejection status
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
    // If explicitly rejected by user, it was not successful
    if (funcCall.isRejected) {
      return false;
    }

    // If there's an error, it was not successful
    if (funcCall.error) {
      return false;
    }

    // If resultMessage indicates rejection or failure, it was not successful
    if (funcCall.resultMessage?.includes('rejected') || funcCall.resultMessage?.includes('failed')) {
      return false;
    }

    // If it was applied and has a result, it was successful
    if (funcCall.isApplied && funcCall.result) {
      return true;
    }

    // Default: if applied without error and not rejected, consider successful
    return funcCall.isApplied && !funcCall.isRejected;
  }

  /**
   * Extract appropriate result message from function call metadata
   */
  private static extractResultMessage(funcCall: any): string {
    // If explicitly rejected, use rejection message
    if (funcCall.isRejected) {
      return funcCall.resultMessage || `User rejected ${funcCall.function_name}`;
    }

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

