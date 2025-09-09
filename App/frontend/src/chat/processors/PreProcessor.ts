import type { ConversationBlock, ChatMessage } from '../../llm_request/types';
import type { 
  PreProcessor, 
  PreProcessingResult, 
  ProcessedChatMessage, 
  ChatPipelineContext 
} from '../types';

export class DefaultPreProcessor implements PreProcessor {
  process(
    messages: ChatMessage[], 
    newMessage: ChatMessage,
    context: ChatPipelineContext
  ): PreProcessingResult {
    const processedMessages: ProcessedChatMessage[] = [];
    const conversationBlocks: ConversationBlock[] = [];

    // Add comprehensive system prompt
    conversationBlocks.push({
      role: 'system',
      content: this.generateSystemPrompt(context)
    });

    // Process existing messages
    for (const message of messages) {
      const processed = this.processExistingMessage(message);
      processedMessages.push(processed);
      conversationBlocks.push({
        role: processed.role,
        content: processed.content
      });
    }

    // Process new message
    const processedNewMessage = this.processNewMessage(newMessage, context);
    processedMessages.push(processedNewMessage);
    conversationBlocks.push({
      role: processedNewMessage.role,
      content: processedNewMessage.content
    });

    return {
      conversationBlocks,
      processedMessages
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

IMPORTANT: You have special editing capabilities using XML tags. You can modify story objects using these tags:

1. <init> - Initialize/overwrite all story objects (use only when starting fresh)
Format:
<init>
\`\`\`json
{
    "basic_info": {
        "title": "string",
        "logline": "string", 
        "genre": "string"
    },
    "characters": [{
        "name": "string",
        "description": "string"
    }],
    "organizations": [{
        "name": "string",
        "description": "string"
    }],
    "locations": [{
        "name": "string", 
        "description": "string"
    }],
    "outline": {
        "acts": [{
            "name": "string",
            "description": "string",
            "chapters": [{
                "name": "string",
                "description": "string"
            }]
        }]
    }
}
\`\`\`
</init>

2. <add> - Add new story objects
Examples:
- Add characters/locations: 
<add>
\`\`\`json
{
    "characters": [{"name": "...", "description": "..."}],
    "locations": [{"name": "...", "description": "..."}]
}
\`\`\`
</add>

- Add new acts:
<add>
\`\`\`json
{
    "acts": [{
        "name": "...",
        "description": "...",
        "chapters": [{"name": "...", "description": "..."}]
    }]
}
\`\`\`
</add>

- Add chapters to existing act:
<add>
\`\`\`json
{
    "chapters": [{
        "act_id": "existing_act_id",
        "name": "...",
        "description": "..."
    }]
}
\`\`\`
</add>

3. <edit> - Modify existing objects
<edit>
\`\`\`json
{
    "basic_info": {
        "title": "...",
        "logline": "...",
        "genre": "..."
    },
    "objects": [{
        "id": "object_id",
        "name": "new_name",
        "description": "new_description"
    }]
}
\`\`\`
</edit>

4. <remove> - Delete objects by ID
<remove>
\`\`\`json
[{
    "id": "object_id_to_delete"
}]
\`\`\`
</remove>

RULES:
- Only use these tags when the user explicitly requests changes to story objects
- Always use the exact JSON format shown above
- The user will be asked to approve changes before they're applied
- Continue your normal conversation after using tags`;
    }

    return systemPrompt;
  }

  private processExistingMessage(message: ChatMessage): ProcessedChatMessage {
    const processed: ProcessedChatMessage = {
      ...message,
      originalContent: message.content
    };

    // Summarize edit tags in existing AI messages
    if (message.role === 'assistant') {
      processed.content = this.summarizeEditTags(message.content);
    }

    return processed;
  }

  private processNewMessage(message: ChatMessage, context: ChatPipelineContext): ProcessedChatMessage {
    const processed: ProcessedChatMessage = {
      ...message,
      originalContent: message.content
    };

    // Add system info to user messages if enabled
    if (message.role === 'user' && context.systemInsertConfig.enabled) {
      processed.content = this.addSystemInfo(message.content, context);
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