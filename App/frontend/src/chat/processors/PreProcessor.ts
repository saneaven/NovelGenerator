import type { ConversationBlock, ChatMessage } from '../../llm_request/types';
import type {
  PreProcessor,
  PreProcessingResult,
  ProcessedChatMessage,
  ChatPipelineContext
} from '../types';
import type { FunctionCallSchema } from '../types/functionCalling';
import { UserMessageTagManager } from '../managers/UserMessageTagManager';
import {
  SystemPromptManager,
  PromptType,
  type PromptBundle,
  type ChatSystemPromptContext,
  type TranslationPromptContext,
  type BatchTranslationPromptContext,
  type StoryObjectEditPromptContext,
  type ChapterEditPromptContext
} from '../managers/SystemPromptManager';
import { PrefillManager, PrefillType, type ChatAssistantPrefillContext } from '../managers/PrefillManager';

export class DefaultPreProcessor implements PreProcessor {
  async process(
    messages: ChatMessage[],
    context: ChatPipelineContext,
    conversationLanguage?: string,
    functions?: FunctionCallSchema[]
  ): Promise<PreProcessingResult> {
    const processedMessages: ProcessedChatMessage[] = [];
    const conversationBlocks: ConversationBlock[] = [];

    // Add comprehensive system prompt and auto-generated user prompts
    const promptBundle = await this.generatePromptBundle(context, conversationLanguage, functions);
    conversationBlocks.push({
      role: 'system',
      content: promptBundle.systemPrompt
    });

    for (const autoUserContent of promptBundle.userPrompts) {
      conversationBlocks.push({
        role: 'user',
        content: autoUserContent
      });
    }

    // Process existing messages
    for (let i = 0; i < messages.length; i++)
    {
      let processed : ProcessedChatMessage = {} as ProcessedChatMessage;

      if (messages[i].role === 'user')
      {
        processed = this.processUserMessage(context, i, messages);
      }
      else
      {
        processed = this.processAssistantMessage(context, i, messages);
      }

        processedMessages.push(processed);
        conversationBlocks.push({
          role: processed.role,
          content: typeof processed.content === 'string' ? processed.content : (processed.content ?? ''),
          function_call: processed.function_call,
          name: processed.name
        });
    }

    // Add prefill at the end if enabled
    if (context.enablePrefill) {
      const prefill = this.generatePrefill(context, conversationLanguage, functions);
      if (prefill && prefill.trim().length > 0) {
        conversationBlocks.push({
          role: 'assistant',
          content: prefill
        });
      }
    }

    // Determine function availability based on prompt type
    const promptType = context.systemInsertConfig.promptType || 'chat';
    let availableFunctions: FunctionCallSchema[] | undefined;

    if (promptType === 'chat') {
      // For chat type, respect the enabled flag
      availableFunctions = context.systemInsertConfig.enabled ? functions : undefined;
    } else {
      // For all other prompt types (translation, editing, etc.), always provide functions
      availableFunctions = functions;
    }

    // Debug: Log function preparation and validate content types
    console.log("Chat to be sent to backend:", {
      conversationBlocks: conversationBlocks.map((block, idx) => ({
        index: idx,
        role: block.role,
        contentType: typeof block.content,
        contentValue: block.content,
        isString: typeof block.content === 'string'
      })),
      functions: availableFunctions
    });
    return {
      conversationBlocks,
      processedMessages,
      functions: availableFunctions
    };
  }

  private async generatePromptBundle(
    context: ChatPipelineContext,
    conversationLanguage?: string,
    functions?: FunctionCallSchema[]
  ): Promise<PromptBundle> {
    // Get prompt type from config, default to 'chat' if not specified
    const promptType = context.systemInsertConfig.promptType || 'chat';
    const promptContext = context.systemInsertConfig.promptContext;

    // Handle all prompt types uniformly
    switch (promptType) {
      case 'chat':
        // Build chat prompt context
        const chatPromptContext: ChatSystemPromptContext = promptContext
          ? (promptContext as ChatSystemPromptContext)
          : {
              mode: context.mode,
              outputLanguage: conversationLanguage,
              functions: context.systemInsertConfig.enabled && context.systemInsertConfig.includeProjectInfo ? functions : undefined,
              enablePrefill: context.enablePrefill,
              enableThinking: context.thinkingMode === 'custom',
            };
        return await SystemPromptManager.generatePromptBundle(PromptType.CHAT_SYSTEM, chatPromptContext);

      case 'translation':
        if (!promptContext) {
          throw new Error('Translation prompt requires promptContext to be set');
        }
        return await SystemPromptManager.generatePromptBundle(
          PromptType.TRANSLATION,
          promptContext as TranslationPromptContext
        );

      case 'story_object_edit':
        if (!promptContext) {
          throw new Error('Story object edit prompt requires promptContext to be set');
        }
        return await SystemPromptManager.generatePromptBundle(
          PromptType.STORY_OBJECT_EDIT,
          promptContext as StoryObjectEditPromptContext
        );

      case 'chapter_edit':
        if (!promptContext) {
          throw new Error('Chapter edit prompt requires promptContext to be set');
        }
        return await SystemPromptManager.generatePromptBundle(
          PromptType.CHAPTER_EDIT,
          promptContext as ChapterEditPromptContext
        );

      case 'batchTranslation':
        if (!promptContext) {
          throw new Error('Batch translation prompt requires promptContext to be set');
        }
        return await SystemPromptManager.generatePromptBundle(
          PromptType.BATCH_TRANSLATION,
          promptContext as BatchTranslationPromptContext
        );

      default:
        console.warn(`Unknown prompt type: ${promptType}, falling back to chat`);
        // Fallback to chat
        const fallbackContext: ChatSystemPromptContext = {
          mode: context.mode,
          outputLanguage: conversationLanguage,
          functions: context.systemInsertConfig.enabled && context.systemInsertConfig.includeProjectInfo ? functions : undefined,
          enablePrefill: context.enablePrefill,
          enableThinking: context.thinkingMode === 'custom',
        };
        return await SystemPromptManager.generatePromptBundle(PromptType.CHAT_SYSTEM, fallbackContext);
    }
  }

  private generatePrefill(context: ChatPipelineContext, conversationLanguage?: string, functions?: FunctionCallSchema[]): string {
    // For now, we only use CHAT_ASSISTANT prefill for normal chat mode
    // This can be extended to support other prefill types based on context
    const prefillContext: ChatAssistantPrefillContext = {
      mode: context.mode,
      outputLanguage: conversationLanguage,
      hasFunctions: context.systemInsertConfig.enabled && context.systemInsertConfig.includeProjectInfo && !!functions && functions.length > 0
    };

    return PrefillManager.generatePrefill(PrefillType.CHAT_ASSISTANT, prefillContext);
  }

  private processAssistantMessage(_context: ChatPipelineContext, messageIndex: number, allMessages: ChatMessage[]): ProcessedChatMessage {
    const message = allMessages[messageIndex];

    // Ensure content is a string before processing
    const messageContent = typeof message.content === 'string' ? message.content : '';

    const processed: ProcessedChatMessage = {
      ...message,
      content: messageContent,
      originalContent: messageContent
    };

    processed.content = this.summarizeEditTags(processed.content || '');

    return processed;
  }
  private processUserMessage(context: ChatPipelineContext, messageIndex: number, allMessages: ChatMessage[]): ProcessedChatMessage {
    const message = allMessages[messageIndex];

    // Ensure content is a string before processing
    const messageContent = typeof message.content === 'string' ? message.content : '';

    const processed: ProcessedChatMessage = {
      ...message,
      content: messageContent,
      originalContent: messageContent
    };

    processed.content = this.addSystemInfo(processed.content || '', context, messageIndex, allMessages);

    return processed;
  }


  private addSystemInfo(processedContent: string, context: ChatPipelineContext, messageIndex: number, allMessages: ChatMessage[]): string {
    // Pass message index and all messages to UserMessageTagManager to find nearest assistant function calls
    return UserMessageTagManager.buildSystemTag(
      processedContent,
      context,
      messageIndex,
      allMessages
    );
  }


  private summarizeEditTags(content: string): string {
    // No edit tags to summarize anymore, just return content as-is
    return content;
  }


}
