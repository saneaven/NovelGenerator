import type { ConversationBlock, ChatMessage } from '../../llm_request/types';
import type { 
  PreProcessor, 
  PreProcessingResult, 
  ProcessedChatMessage, 
  ChatPipelineContext 
} from '../types';
import { STORY_FUNCTIONS } from '../types/functionCalling';
import { SystemTagManager, type SystemTagData } from '../utils/SystemTagManager';

function findLastUserMessageIdx(messages: ChatMessage[]): number
  {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') 
      {
        return i;
      }
    }
    return -1;
  }

export class DefaultPreProcessor implements PreProcessor {
  process(
    messages: ChatMessage[], 
    context: ChatPipelineContext,
    outputLanguage?: string
  ): PreProcessingResult {
    const processedMessages: ProcessedChatMessage[] = [];
    const conversationBlocks: ConversationBlock[] = [];

    const lastUserMessageIdx = findLastUserMessageIdx(messages);

    // Add comprehensive system prompt
    conversationBlocks.push({
      role: 'system',
      content: this.generateSystemPrompt(context, outputLanguage)
    });

    // Process existing messages
    for (let i = 0; i < messages.length; i++) 
    {
      const message = messages[i];

      let processed : ProcessedChatMessage = {} as ProcessedChatMessage;
      if (messages.indexOf(message) === lastUserMessageIdx)
      {
        processed = this.processLastUserMessage(message, context);
      }
      else
      {
        processed = this.processExistingMessage(message);
      }

        processedMessages.push(processed);
        conversationBlocks.push({
          role: processed.role,
          content: processed.content,
          function_call: processed.function_call,
          name: processed.name
        });
    }

    const functions = context.systemInsertConfig.enabled ? STORY_FUNCTIONS : undefined;
    
    // Debug: Log function preparation
    console.log("Chat to be sent to backend:", {
      conversationBlocks,
      functions
    });
    return {
      conversationBlocks,
      processedMessages,
      functions
    };
  }

  private generateSystemPrompt(context: ChatPipelineContext, outputLanguage?: string): string 
  {

    let systemPrompt = `You are an AI assistant specialized in novel writing and story development. You help writers create, develop, and refine their stories.

Your primary capabilities include:
- Creative brainstorming and idea development
- Character creation and development
- Plot structure and story organization
- World-building and setting creation
- Writing advice and feedback

# Language
You Should respond in ${outputLanguage ? outputLanguage : 'the language used by the user'}.`;

    if (context.systemInsertConfig.enabled && context.systemInsertConfig.includeProjectInfo) {
      systemPrompt += `

IMPORTANT: You have access to a unified function for managing story objects. When the user requests changes to their story (characters, locations, plot, etc.), you can call this function:

Available Function:
manage_story_objects - Create, update, or delete story objects in batch operations

Function Usage Rules:
- Only call this function when the user explicitly requests changes to story objects
- The user will be asked to approve function calls before they're applied
- You can continue your normal conversation along with function calls
- Use operations array with action: "create"/"update"/"delete", type, and data as needed
- Multiple operations can be batched in a single function call for efficiency

Example usage:
- Create: {action: "create", type: "character", data: {name: "John", description: "Hero"}}
- Update: {action: "update", type: "character", id: "123", data: {name: "John Updated"}}
- Delete: {action: "delete", type: "character", id: "456"}`;
    }

    return systemPrompt;
  }

  private processExistingMessage(message: ChatMessage): ProcessedChatMessage {
    const processed: ProcessedChatMessage = {
      ...message,
      originalContent: message.content ?? undefined
    };

    // Summarize edit tags in existing AI messages
    if (message.role === 'assistant') {
      processed.content = this.summarizeEditTags(message.content || '');
    }

    return processed;
  }

  private processLastUserMessage(message: ChatMessage, context: ChatPipelineContext): ProcessedChatMessage {
    const processed: ProcessedChatMessage = {
      ...message,
      originalContent: message.content ?? undefined
    };

    // Add system info to user messages if enabled
    if (message.role === 'user' && context.systemInsertConfig.enabled) {
      processed.content = this.addSystemInfo(message.content || '', context);
      processed.processedForAI = true;
    }

    return processed;
  }

  private addSystemInfo(content: string, context: ChatPipelineContext): string {
    const additionalSystemData: SystemTagData = {
      storyContext: {
        enabled: context.systemInsertConfig.includeStoryObjects,
        storyObjects: context.storyObjects
      }
    };

    return SystemTagManager.processMessageForUnifiedSystemTag(content, additionalSystemData, context);
  }


  private summarizeEditTags(content: string): string {
    // No edit tags to summarize anymore, just return content as-is
    return content;
  }


}