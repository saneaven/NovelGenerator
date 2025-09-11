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

    if (storyObjects.basicInfo) {
      simplified.basic_info = {
        id: storyObjects.basicInfo.id,
        title: storyObjects.basicInfo.title,
        logline: storyObjects.basicInfo.logline,
        genre: storyObjects.basicInfo.genre
      };
    }

    if (storyObjects.characters?.length > 0) {
      simplified.characters = storyObjects.characters.map((char: any) => ({
        id: char.id,
        name: char.name,
        description: char.description
      }));
    }

    if (storyObjects.organizations?.length > 0) {
      simplified.organizations = storyObjects.organizations.map((org: any) => ({
        id: org.id,
        name: org.name,
        description: org.description
      }));
    }

    if (storyObjects.locations?.length > 0) {
      simplified.locations = storyObjects.locations.map((loc: any) => ({
        id: loc.id,
        name: loc.name,
        description: loc.description
      }));
    }

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
    }

    return simplified;
  }

  private summarizeEditTags(content: string): string {
    // Find and summarize edit tags
    const initRegex = /<init>([\s\S]*?)<\/init>/gi;
    const addRegex = /<add>([\s\S]*?)<\/add>/gi;
    const editRegex = /<edit>([\s\S]*?)<\/edit>/gi;
    const removeRegex = /<remove>([\s\S]*?)<\/remove>/gi;

    let processedContent = content;

    // Replace init tags
    processedContent = processedContent.replace(initRegex, () => {
      return `<init>\n[Summarized by system: Story objects initialized]\n</init>`;
    });

    // Replace add tags
    processedContent = processedContent.replace(addRegex, (match) => {
      try {
        const jsonMatch = match.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[1]);
          const counts = this.countAddedItems(data);
          return `<add>\n[Summarized by system: ${counts}]\n</add>`;
        }
      } catch (e) {
        // If parsing fails, keep original
      }
      return `<add>\n[Summarized by system: Items added]\n</add>`;
    });

    // Replace edit tags
    processedContent = processedContent.replace(editRegex, (match) => {
      try {
        const jsonMatch = match.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[1]);
          const counts = this.countEditedItems(data);
          return `<edit>\n[Summarized by system: ${counts}]\n</edit>`;
        }
      } catch (e) {
        // If parsing fails, keep original
      }
      return `<edit>\n[Summarized by system: Items edited]\n</edit>`;
    });

    // Replace remove tags
    processedContent = processedContent.replace(removeRegex, (match) => {
      try {
        const jsonMatch = match.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[1]);
          const count = Array.isArray(data) ? data.length : 0;
          return `<remove>\n[Summarized by system: ${count} items removed]\n</remove>`;
        }
      } catch (e) {
        // If parsing fails, keep original
      }
      return `<remove>\n[Summarized by system: Items removed]\n</remove>`;
    });

    return processedContent;
  }

  private countAddedItems(data: any): string {
    const counts: string[] = [];
    
    if (data.characters?.length) counts.push(`${data.characters.length} characters`);
    if (data.organizations?.length) counts.push(`${data.organizations.length} organizations`);
    if (data.locations?.length) counts.push(`${data.locations.length} locations`);
    if (data.acts?.length) counts.push(`${data.acts.length} acts`);
    if (data.chapters?.length) counts.push(`${data.chapters.length} chapters`);
    
    return counts.length > 0 ? `Added ${counts.join(', ')}` : 'Items added';
  }

  private countEditedItems(data: any): string {
    const counts: string[] = [];
    
    if (data.basic_info) counts.push('basic info');
    if (data.objects?.length) counts.push(`${data.objects.length} objects`);
    
    return counts.length > 0 ? `Edited ${counts.join(', ')}` : 'Items edited';
  }
}