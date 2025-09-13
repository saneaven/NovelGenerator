import type { ChatPipelineContext } from '../types';

export interface SystemTagData {
  storyContext?: {
    enabled: boolean;
    storyObjects: any;
  };
  functionCallResults?: Array<{
    functionCall: any;
    accepted: boolean;
    resultMessage: string;
  }>;
}

export class SystemTagManager {
  /**
   * Generate a single unified system tag containing all system information
   */
  static generateSystemTag(data: SystemTagData, context?: ChatPipelineContext): string {
    const systemParts: string[] = [];

    // Add story context if enabled
    if (data.storyContext?.enabled && context?.systemInsertConfig.includeStoryObjects && data.storyContext.storyObjects) {
      systemParts.push(`# Current Project Status
\`\`\`json
${JSON.stringify(this.simplifyStoryObjects(data.storyContext.storyObjects), null, 2)}
\`\`\``);
    }

    // Add function call results
    if (data.functionCallResults && data.functionCallResults.length > 0) {
      const functionCallSection = data.functionCallResults.map(result => 
        `Function call ${result.functionCall.function_name} was ${result.accepted ? 'accepted' : 'rejected'}. ${result.resultMessage}`
      ).join('\n');
      systemParts.push(`# Function Call Results\n${functionCallSection}`);
    }

    // Return unified system tag if we have any content
    if (systemParts.length > 0) {
      return `<system>\n${systemParts.join('\n\n')}\n</system>`;
    }

    return '';
  }

  /**
   * Parse existing system tags from message content and extract system data
   */
  static parseExistingSystemTags(content: string): { systemTagData: SystemTagData; cleanContent: string } {
    const systemTagData: SystemTagData = {};
    
    // Extract and parse existing system tags
    const systemTagRegex = /<system>([\s\S]*?)<\/system>/g;
    let match;
    const existingSystemContent: string[] = [];
    
    while ((match = systemTagRegex.exec(content)) !== null) {
      const systemContent = match[1].trim();
      existingSystemContent.push(systemContent);
      
      // Check if this contains function call results
      if (systemContent.includes('Function call') && systemContent.includes('was')) {
        // This is likely function call results - parse them
        const functionResults = systemContent.split('\n')
          .filter(line => line.includes('Function call') && line.includes('was'))
          .map(line => {
            // Simple parsing - might need to be more robust
            const parts = line.match(/Function call (\w+) was (accepted|rejected)\. (.+)/);
            if (parts) {
              return {
                functionCall: { function_name: parts[1] },
                accepted: parts[2] === 'accepted',
                resultMessage: parts[3]
              };
            }
            return null;
          })
          .filter(Boolean);
        
        if (functionResults.length > 0) {
          systemTagData.functionCallResults = functionResults as any[];
        }
      }
    }
    
    // Remove all system tags from content
    const cleanContent = content.replace(systemTagRegex, '').trim();
    
    return { systemTagData, cleanContent };
  }

  /**
   * Merge system tag data from multiple sources
   */
  static mergeSystemTagData(...dataSources: SystemTagData[]): SystemTagData {
    const merged: SystemTagData = {};
    
    for (const data of dataSources) {
      if (data.storyContext) {
        merged.storyContext = data.storyContext;
      }
      if (data.functionCallResults) {
        merged.functionCallResults = [...(merged.functionCallResults || []), ...data.functionCallResults];
      }
    }
    
    return merged;
  }

  /**
   * Process message content to ensure single unified system tag
   */
  static processMessageForUnifiedSystemTag(
    content: string, 
    additionalSystemData?: SystemTagData, 
    context?: ChatPipelineContext
  ): string {
    // Parse existing system tags
    const { systemTagData: existingData, cleanContent } = this.parseExistingSystemTags(content);
    
    // Merge with additional system data
    const mergedData = additionalSystemData 
      ? this.mergeSystemTagData(existingData, additionalSystemData)
      : existingData;
    
    // Generate unified system tag
    const unifiedSystemTag = this.generateSystemTag(mergedData, context);
    
    // Return content with unified system tag
    return this.addSystemTagToMessage(cleanContent, unifiedSystemTag);
  }

  /**
   * Add system tag to user message content
   */
  static addSystemTagToMessage(content: string, systemTag: string): string {
    if (!systemTag.trim()) {
      return content;
    }
    return `${systemTag}\n\n${content}`;
  }

  /**
   * Simplify story objects for AI context
   */
  private static simplifyStoryObjects(storyObjects: any): any {
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
}