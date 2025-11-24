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
  type StoryObjectEditPromptContext,
  type ChapterEditPromptContext
} from '../managers/SystemPromptManager';
import { PrefillManager, PrefillType, type ChatAssistantPrefillContext, type TranslationPrefillContext } from '../managers/PrefillManager';

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
      contentParts: [{ type: 'content', text: promptBundle.systemPrompt }]
    });

    for (const autoUserContent of promptBundle.userPrompts) {
      conversationBlocks.push({
        role: 'user',
        contentParts: [{ type: 'content', text: autoUserContent }]
      });
    }

    // Process existing messages
    for (let i = 0; i < messages.length; i++)
    {
      let processed : ProcessedChatMessage = {} as ProcessedChatMessage;

      if (messages[i].role === 'user')
      {
        processed = await this.processUserMessage(context, i, messages, conversationLanguage);
      }
      else
      {
        processed = this.processAssistantMessage(context, i, messages);
      }

        processedMessages.push(processed);
        conversationBlocks.push({
          role: processed.role,
          contentParts: processed.contentParts,
          function_call: processed.function_call,
          name: processed.name
        });
    }

    // Add prefill at the end if enabled
    if (context.enablePrefill) {
      const prefill = await this.generatePrefill(context, conversationLanguage, functions);
      if (prefill && prefill.trim().length > 0) {
        conversationBlocks.push({
          role: 'assistant',
          contentParts: [{ type: 'content', text: prefill }]
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
        contentPartsLength: block.contentParts.length,
        contentParts: block.contentParts,
        isArray: Array.isArray(block.contentParts)
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
              enableCustomThinking: context.thinkingMode === 'custom',
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

      default:
        console.warn(`Unknown prompt type: ${promptType}, falling back to chat`);
        // Fallback to chat
        const fallbackContext: ChatSystemPromptContext = {
          mode: context.mode,
          outputLanguage: conversationLanguage,
          functions: context.systemInsertConfig.enabled && context.systemInsertConfig.includeProjectInfo ? functions : undefined,
          enablePrefill: context.enablePrefill,
          enableThinking: context.thinkingMode === 'custom',
          enableCustomThinking: context.thinkingMode === 'custom',
        };
        return await SystemPromptManager.generatePromptBundle(PromptType.CHAT_SYSTEM, fallbackContext);
    }
  }

  private async generatePrefill(context: ChatPipelineContext, conversationLanguage?: string, functions?: FunctionCallSchema[]): Promise<string> {
    const promptType = context.systemInsertConfig.promptType || 'chat';

    if (promptType === 'translation') {
      const translationContext = context.systemInsertConfig.promptContext as TranslationPromptContext | undefined;
      if (!translationContext) {
        return '';
      }

      const prefillContext: TranslationPrefillContext = {
        sourceLanguage: translationContext.sourceLanguage,
        targetLanguage: translationContext.targetLanguage,
        dataType: translationContext.translationType === 'chat' ? 'chatMessage' : 'general',
        translationType: translationContext.translationType || 'story',
        outputLanguage: conversationLanguage,
        objectCount: translationContext.translationType === 'chat' ? undefined : (translationContext as any).objectCount
      };

      return await PrefillManager.generatePrefill(PrefillType.TRANSLATION_ASSISTANT, prefillContext);
    }

    // Default: chat prefill
    const prefillContext: ChatAssistantPrefillContext = {
      mode: context.mode,
      outputLanguage: conversationLanguage,
      hasFunctions: context.systemInsertConfig.enabled && context.systemInsertConfig.includeProjectInfo && !!functions && functions.length > 0
    };

    return await PrefillManager.generatePrefill(PrefillType.CHAT_ASSISTANT, prefillContext);
  }

  private processAssistantMessage(_context: ChatPipelineContext, messageIndex: number, allMessages: ChatMessage[]): ProcessedChatMessage {
    const message = allMessages[messageIndex];

    // Extract text from contentParts
    const messageContent = message.contentParts
      .filter(part => part.type === 'content')
      .map(part => part.text)
      .join('');

    const processed: ProcessedChatMessage = {
      ...message,
      originalContent: messageContent,
      originalContentParts: [...message.contentParts]
    };

    // Process the content and update contentParts
    const processedContent = this.summarizeEditTags(messageContent);
    processed.contentParts = [{ type: 'content', text: processedContent }];

    return processed;
  }
  private async processUserMessage(context: ChatPipelineContext, messageIndex: number, allMessages: ChatMessage[], conversationLanguage?: string): Promise<ProcessedChatMessage> {
    const message = allMessages[messageIndex];

    // Extract text from contentParts
    const messageContent = message.contentParts
      .filter(part => part.type === 'content')
      .map(part => part.text)
      .join('');

    const processed: ProcessedChatMessage = {
      ...message,
      originalContent: messageContent,
      originalContentParts: [...message.contentParts]
    };

    // Process the content and update contentParts
    const processedContent = await this.addSystemInfo(messageContent, context, messageIndex, allMessages, conversationLanguage);
    processed.contentParts = [{ type: 'content', text: processedContent }];

    return processed;
  }


  private async addSystemInfo(processedContent: string, context: ChatPipelineContext, messageIndex: number, allMessages: ChatMessage[], conversationLanguage?: string): Promise<string> {
    // Pass message index and all messages to UserMessageTagManager to find nearest assistant function calls
    return await UserMessageTagManager.buildSystemTag(
      processedContent,
      context,
      messageIndex,
      allMessages,
      conversationLanguage
    );
  }


  private summarizeEditTags(content: string): string {
    // No edit tags to summarize anymore, just return content as-is
    return content;
  }


}
