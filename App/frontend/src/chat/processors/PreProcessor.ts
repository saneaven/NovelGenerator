import type { ConversationBlock, ChatMessage } from '../../llm_request/types';
import type {
  PreProcessor,
  PreProcessingResult,
  ProcessedChatMessage,
  ChatPipelineContext
} from '../types';
import type { FunctionCallSchema } from '../types/functionCalling';
import { SystemTagManager } from '../utils/SystemTagManager';
import { SystemPromptManager, PromptType, type ChatSystemPromptContext } from '../managers/SystemPromptManager';

export class DefaultPreProcessor implements PreProcessor {
  process(
    messages: ChatMessage[],
    context: ChatPipelineContext,
    conversationLanguage?: string,
    functions?: FunctionCallSchema[]
  ): PreProcessingResult {
    const processedMessages: ProcessedChatMessage[] = [];
    const conversationBlocks: ConversationBlock[] = [];

    // Add comprehensive system prompt
    conversationBlocks.push({
      role: 'system',
      content: this.generateSystemPrompt(context, conversationLanguage, functions)
    });

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
          content: processed.content,
          function_call: processed.function_call,
          name: processed.name
        });
    }

    const availableFunctions = context.systemInsertConfig.enabled ? functions : undefined;
    
    // Debug: Log function preparation
    console.log("Chat to be sent to backend:", {
      conversationBlocks,
      functions: availableFunctions
    });
    return {
      conversationBlocks,
      processedMessages,
      functions: availableFunctions
    };
  }

  private generateSystemPrompt(context: ChatPipelineContext, conversationLanguage?: string, functions?: FunctionCallSchema[]): string {
    const promptContext: ChatSystemPromptContext = {
      mode: context.mode,
      outputLanguage: conversationLanguage,
      functions: context.systemInsertConfig.enabled && context.systemInsertConfig.includeProjectInfo ? functions : undefined
    };

    return SystemPromptManager.generatePrompt(PromptType.CHAT_SYSTEM, promptContext);
  }

  private processAssistantMessage(_context: ChatPipelineContext, messageIndex: number, allMessages: ChatMessage[]): ProcessedChatMessage {
    const message = allMessages[messageIndex];
    const processed: ProcessedChatMessage = {
      ...message,
      originalContent: message.content ?? undefined
    };

    processed.content = this.summarizeEditTags(processed.content || '');

    return processed;
  }
  private processUserMessage(context: ChatPipelineContext, messageIndex: number, allMessages: ChatMessage[]): ProcessedChatMessage {
    const message = allMessages[messageIndex];
    const processed: ProcessedChatMessage = {
      ...message,
      originalContent: message.content ?? undefined
    };

    processed.content = this.addSystemInfo(processed.content || '', context, messageIndex, allMessages);

    return processed;
  }


  private addSystemInfo(processedContent: string, context: ChatPipelineContext, messageIndex: number, allMessages: ChatMessage[]): string {
    // Pass message index and all messages to SystemTagManager to find nearest assistant function calls
    return SystemTagManager.buildSystemTag(
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