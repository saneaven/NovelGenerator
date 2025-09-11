import type { ConversationBlock, ChatMessage } from '../../llm_request/types';
import type { 
  PreProcessor, 
  PreProcessingResult, 
  ProcessedChatMessage, 
  ChatPipelineContext 
} from '../types';
import { STORY_FUNCTIONS } from '../types/functionCalling';

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
    context: ChatPipelineContext
  ): PreProcessingResult {
    const processedMessages: ProcessedChatMessage[] = [];
    const conversationBlocks: ConversationBlock[] = [];

    const lastUserMessageIdx = findLastUserMessageIdx(messages);

    // Add comprehensive system prompt
    conversationBlocks.push({
      role: 'system',
      content: this.generateSystemPrompt(context)
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

  private generateSystemPrompt(context: ChatPipelineContext): string {
    let systemPrompt = `You are an AI assistant specialized in novel writing and story development. You help writers create, develop, and refine their stories.

Your primary capabilities include:
- Creative brainstorming and idea development
- Character creation and development
- Plot structure and story organization
- World-building and setting creation
- Writing advice and feedback`;

    if (context.systemInsertConfig.enabled && context.systemInsertConfig.includeProjectInfo) {
      systemPrompt += `

IMPORTANT: You have access to specialized functions for managing story objects. When the user requests changes to their story (characters, locations, plot, etc.), you can call these functions:

Available Functions:
1. initialize_story_objects - Initialize or completely replace all story objects
2. add_story_objects - Add new characters, locations, organizations, etc.
3. edit_story_objects - Modify existing story objects by ID
4. remove_story_objects - Remove story objects by ID

Function Usage Rules:
- Only call these functions when the user explicitly requests changes to story objects
- The user will be asked to approve function calls before they're applied
- You can continue your normal conversation along with function calls
- Use the exact parameter formats as defined in the function schemas`;
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
    let systemInfo = '';

    if (context.systemInsertConfig.includeStoryObjects && context.storyObjects) {
      systemInfo = `<system>
# Current Project Status
\`\`\`json
${JSON.stringify(this.simplifyStoryObjects(context.storyObjects), null, 2)}
\`\`\`
</system>

`;
    }

    return systemInfo + content;
  }

  private simplifyStoryObjects(storyObjects: any): any {
    // Convert complex story objects to simple format for AI
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

  private summarizeEditTags(content: string): string {
    // No edit tags to summarize anymore, just return content as-is
    return content;
  }


}