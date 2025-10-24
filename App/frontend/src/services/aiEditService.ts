import type { StoryObjects, StoryObjectCategory } from '../types/storyObject';
import type { ConversationBlock } from '../llm_request/types';
import { SystemPromptManager, PromptType, type StoryObjectEditPromptContext } from '../chat/managers/SystemPromptManager';
import { PrefillManager, PrefillType, type StoryObjectEditPrefillContext } from '../chat/managers/PrefillManager';

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
  enablePrefill?: boolean;
  enableThinking?: boolean;
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
        case 'act':
          // Find act in outline
          return storyObjects.outline?.acts.find(a => a.id === targetId);
        case 'chapter':
          // Find chapter in any act
          for (const act of storyObjects.outline?.acts || []) {
            const chapter = act.chapters.find(c => c.id === targetId);
            if (chapter) return chapter;
          }
          return null;
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
        case 'act':
          return storyObjects.outline?.acts || [];
        case 'chapter':
          // Return all chapters from all acts
          const allChapters = [];
          for (const act of storyObjects.outline?.acts || []) {
            allChapters.push(...act.chapters);
          }
          return allChapters;
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
        case 'act':
        case 'chapter':
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
        case 'act':
        case 'chapter':
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
      act: 'Act',
      chapter: 'Chapter',
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
    outputLanguage?: string,
    enablePrefill?: boolean,
    enableThinking?: boolean
  ): string {
    const promptContext: StoryObjectEditPromptContext = {
      category,
      targetId,
      contextData: context,
      currentData,
      jsonSchema,
      outputLanguage,
      enablePrefill,
      enableThinking
    };

    return SystemPromptManager.generatePrompt(PromptType.STORY_OBJECT_EDIT, promptContext);
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
      request.outputLanguage,
      request.enablePrefill,
      request.enableThinking
    );

    const messages: ConversationBlock[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: request.userRequest },
    ];

    // Add prefill if enabled
    if (request.enablePrefill) {
      const prefillContext: StoryObjectEditPrefillContext = {
        category: request.category,
        editScope: request.targetId ? 'a specific item' : 'the entire category',
        outputLanguage: request.outputLanguage
      };
      const prefill = PrefillManager.generatePrefill(PrefillType.STORY_OBJECT_EDIT_ASSISTANT, prefillContext);
      if (prefill && prefill.trim().length > 0) {
        messages.push({ role: 'assistant', content: prefill });
      }
    }

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
        case 'act':
        case 'chapter':
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
        case 'act':
        case 'chapter':
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
