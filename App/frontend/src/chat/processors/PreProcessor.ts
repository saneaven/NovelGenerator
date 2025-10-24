import type { ConversationBlock, ChatMessage } from '../../llm_request/types';
import type {
  PreProcessor,
  PreProcessingResult,
  ProcessedChatMessage,
  ChatPipelineContext
} from '../types';
import type { FunctionCallSchema } from '../types/functionCalling';
import { UserMessageTagManager } from '../managers/UserMessageTagManager';
import { SystemPromptManager, PromptType, type ChatSystemPromptContext } from '../managers/SystemPromptManager';
import { PrefillManager, PrefillType, type ChatAssistantPrefillContext } from '../managers/PrefillManager';

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
      functions: context.systemInsertConfig.enabled && context.systemInsertConfig.includeProjectInfo ? functions : undefined,
      enablePrefill: context.enablePrefill,
      enableThinking: context.enableThinking,
    };

    return SystemPromptManager.generatePrompt(PromptType.CHAT_SYSTEM, promptContext);
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