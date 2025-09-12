import type { StoryObjects, StoryObjectCategory, BasicInfo, Character, Organization, Location, LorebookEntry, Outline } from '../types/storyObject';
import type { ConversationBlock } from '../llm_request/types';

export interface ContextOptions {
  basicInfo: boolean;
  characters: boolean;
  organizations: boolean;
  locations: boolean;
  lorebook: boolean;
  outline: boolean;
}

export interface AIEditRequest {
  category: StoryObjectCategory;
  targetId?: string;
  userRequest: string;
  contextOptions: ContextOptions;
  storyObjects: StoryObjects;
  outputLanguage?: string;
}

export interface AIEditResult {
  messages: ConversationBlock[];
  currentData: any;
  expectedSchema: any;
}

export class AIEditService {
  /**
   * Generate context data based on selected options and story objects
   */
  static generateContext(storyObjects: StoryObjects, contextOptions: ContextOptions): Record<string, any> {
    const context: Record<string, any> = {};

    if (contextOptions.basicInfo && storyObjects.basicInfo) {
      context.basicInfo = {
        title: storyObjects.basicInfo.title,
        logline: storyObjects.basicInfo.logline,
        genre: storyObjects.basicInfo.genre,
      };
    }

    if (contextOptions.characters && storyObjects.characters.length > 0) {
      context.characters = storyObjects.characters.map(char => ({
        id: char.id,
        name: char.name,
        description: char.description,
      }));
    }

    if (contextOptions.organizations && storyObjects.organizations.length > 0) {
      context.organizations = storyObjects.organizations.map(org => ({
        id: org.id,
        name: org.name,
        description: org.description,
      }));
    }

    if (contextOptions.locations && storyObjects.locations.length > 0) {
      context.locations = storyObjects.locations.map(loc => ({
        id: loc.id,
        name: loc.name,
        description: loc.description,
      }));
    }

    if (contextOptions.lorebook && storyObjects.lorebook.length > 0) {
      context.lorebook = storyObjects.lorebook.map(entry => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
      }));
    }

    if (contextOptions.outline && storyObjects.outline) {
      context.outline = {
        acts: storyObjects.outline.acts.map(act => ({
          id: act.id,
          name: act.name,
          description: act.description,
          chapters: act.chapters.map(chapter => ({
            id: chapter.id,
            name: chapter.name,
            description: chapter.description,
          })),
        })),
      };
    }

    return context;
  }

  /**
   * Get current data for editing based on category and target ID
   */
  static getCurrentData(storyObjects: StoryObjects, category: StoryObjectCategory, targetId?: string): any {
    if (targetId) {
      // Editing specific item
      switch (category) {
        case 'character':
          return storyObjects.characters.find(c => c.id === targetId);
        case 'organization':
          return storyObjects.organizations.find(o => o.id === targetId);
        case 'location':
          return storyObjects.locations.find(l => l.id === targetId);
        case 'lorebook':
          return storyObjects.lorebook.find(e => e.id === targetId);
        case 'basicInfo':
          return storyObjects.basicInfo;
        case 'outline':
          return storyObjects.outline;
        default:
          return null;
      }
    } else {
      // Editing entire category
      switch (category) {
        case 'character':
          return storyObjects.characters;
        case 'organization':
          return storyObjects.organizations;
        case 'location':
          return storyObjects.locations;
        case 'lorebook':
          return storyObjects.lorebook;
        case 'basicInfo':
          return storyObjects.basicInfo;
        case 'outline':
          return storyObjects.outline;
        default:
          return null;
      }
    }
  }

  /**
   * Generate JSON schema for the expected output format
   */
  static generateJSONSchema(category: StoryObjectCategory, targetId?: string): any {
    if (targetId) {
      // Schema for individual items
      switch (category) {
        case 'character':
        case 'organization':
        case 'location':
        case 'lorebook':
          return {
            id: "string (keep existing ID)",
            name: "string",
            description: "string"
          };
        case 'basicInfo':
          return {
            title: "string",
            logline: "string",
            genre: "string"
          };
        case 'outline':
          return {
            acts: [{
              id: "string (keep existing ID)",
              name: "string",
              description: "string",
              chapters: [{
                id: "string (keep existing ID)",
                name: "string",
                description: "string"
              }]
            }]
          };
        default:
          return {};
      }
    } else {
      // Schema for entire category
      switch (category) {
        case 'character':
        case 'organization':
        case 'location':
        case 'lorebook':
          return [{
            id: "string | null (existing ID for modification, null for addition)",
            name: "string",
            description: "string"
          }];
        case 'basicInfo':
          return {
            title: "string",
            logline: "string",
            genre: "string"
          };
        case 'outline':
          return {
            acts: [{
              id: "string | null (existing ID for modification, null for addition)",
              name: "string",
              description: "string",
              chapters: [{
                id: "string | null (existing ID for modification, null for addition)",
                name: "string",
                description: "string"
              }]
            }]
          };
        default:
          return {};
      }
    }
  }

  /**
   * Get display name for category
   */
  static getCategoryDisplayName(category: StoryObjectCategory): string {
    const names = {
      basicInfo: 'Basic Info',
      character: 'Character',
      organization: 'Organization',
      location: 'Location',
      lorebook: 'Lorebook',
      outline: 'Outline',
    };
    return names[category] || category;
  }

  /**
   * Generate system prompt for AI editing
   */
  static generateSystemPrompt(
    category: StoryObjectCategory,
    targetId: string | undefined,
    context: Record<string, any>,
    currentData: any,
    jsonSchema: any,
    outputLanguage?: string
  ): string {
    const editType = targetId ? 'specific item' : 'entire category';
    const categoryName = this.getCategoryDisplayName(category);

    const contextSection = Object.keys(context).length > 0 
      ? `<Context>
${Object.keys(context).map(key => `# ${key.charAt(0).toUpperCase() + key.slice(1)}\n${JSON.stringify(context[key], null, 2)}`).join('\n\n')}
</Context>`
      : '<Context>\nNo additional context provided.\n</Context>';

    return `You are an AI assistant that helps with novel writing. The user wants to modify the ${editType} (${categoryName}) of a story object.
Please refer to the following context and return the modified data in JSON format according to the user's request.

# Language
You Should respond in ${outputLanguage ? outputLanguage : 'the language used by the user'}.

${contextSection}

Current data:
${JSON.stringify(currentData, null, 2)}

Please modify the above data according to the request and return it in the following JSON schema:
${JSON.stringify(jsonSchema, null, 2)}

Important rules:
1. ID handling:
   - When modifying an existing item: Keep the current data's ID.
   - When adding a new item: Set the id to null.`;
  }

  /**
   * Prepare AI edit request data
   */
  static prepareEditRequest(request: AIEditRequest): AIEditResult {
    const context = this.generateContext(request.storyObjects, request.contextOptions);
    const currentData = this.getCurrentData(request.storyObjects, request.category, request.targetId);
    const jsonSchema = this.generateJSONSchema(request.category, request.targetId);
    
    const systemPrompt = this.generateSystemPrompt(
      request.category,
      request.targetId,
      context,
      currentData,
      jsonSchema,
      request.outputLanguage
    );

    const messages: ConversationBlock[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: request.userRequest },
    ];

    return {
      messages,
      currentData,
      expectedSchema: jsonSchema,
    };
  }

  /**
   * Parse AI response, handling code blocks and validation
   */
  static parseAIResponse(response: string): any {
    let jsonText = response.trim();
    
    // Extract JSON from markdown code blocks if present
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    }
    
    return JSON.parse(jsonText);
  }

  /**
   * Validate parsed result based on category and edit type
   */
  static validateResult(
    result: any,
    category: StoryObjectCategory,
    targetId?: string
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!result) {
      errors.push('Result is null or undefined');
      return { isValid: false, errors };
    }

    // Basic validation based on category
    if (targetId) {
      // Editing specific item
      switch (category) {
        case 'character':
        case 'organization':
        case 'location':
        case 'lorebook':
          if (!result.id || typeof result.name !== 'string' || typeof result.description !== 'string') {
            errors.push('Invalid name-description item format');
          }
          break;
        case 'basicInfo':
          if (typeof result.title !== 'string' || typeof result.logline !== 'string' || typeof result.genre !== 'string') {
            errors.push('Invalid basic info format');
          }
          break;
        case 'outline':
          if (!result.acts || !Array.isArray(result.acts)) {
            errors.push('Invalid outline format - acts must be an array');
          }
          break;
      }
    } else {
      // Editing entire category
      switch (category) {
        case 'character':
        case 'organization':
        case 'location':
        case 'lorebook':
          if (!Array.isArray(result)) {
            errors.push(`Invalid ${category} format - must be an array`);
          }
          break;
        case 'basicInfo':
          if (typeof result.title !== 'string' || typeof result.logline !== 'string' || typeof result.genre !== 'string') {
            errors.push('Invalid basic info format');
          }
          break;
        case 'outline':
          if (!result.acts || !Array.isArray(result.acts)) {
            errors.push('Invalid outline format - acts must be an array');
          }
          break;
      }
    }

    return { isValid: errors.length === 0, errors };
  }
}