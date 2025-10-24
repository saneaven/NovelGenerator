import type { FunctionCallMetadata } from '../../llm_request/types';
import type { 
  StoryObjects,
  BasicInfo,
  Character,
  Organization,
  Location,
  LorebookEntry,
  Act,
  Chapter
} from '../../types/storyObject';

export interface EditTagApplicationResult {
  success: boolean;
  message: string;
  error?: string;
}

export interface StoryObjectStoreActions {
  // Basic Info
  setBasicInfo: (projectId: string, basicInfo: BasicInfo) => void;
  updateBasicInfo: (projectId: string, updates: Partial<BasicInfo>) => void;
  
  // Characters
  addCharacter: (projectId: string, character?: Partial<Character>) => Character;
  updateCharacter: (projectId: string, id: string, updates: Partial<Character>) => void;
  deleteCharacter: (projectId: string, id: string) => void;
  
  // Organizations
  addOrganization: (projectId: string, organization?: Partial<Organization>) => Organization;
  updateOrganization: (projectId: string, id: string, updates: Partial<Organization>) => void;
  deleteOrganization: (projectId: string, id: string) => void;
  
  // Locations
  addLocation: (projectId: string, location?: Partial<Location>) => Location;
  updateLocation: (projectId: string, id: string, updates: Partial<Location>) => void;
  deleteLocation: (projectId: string, id: string) => void;
  
  // Lorebook
  addLorebookEntry: (projectId: string, entry?: Partial<LorebookEntry>) => LorebookEntry;
  updateLorebookEntry: (projectId: string, id: string, updates: Partial<LorebookEntry>) => void;
  deleteLorebookEntry: (projectId: string, id: string) => void;
  
  // Acts
  addAct: (projectId: string, act?: Partial<Act>) => Act;
  updateAct: (projectId: string, actId: string, updates: Partial<Act>) => void;
  deleteAct: (projectId: string, actId: string) => void;
  
  // Chapters
  addChapter: (projectId: string, actId: string, chapter?: Partial<Chapter>) => Chapter;
  updateChapter: (projectId: string, chapterId: string, updates: Partial<Chapter>) => void;
  deleteChapter: (projectId: string, chapterId: string) => void;
  
  // Version Management
  addVersion: <T>(projectId: string, category: import('../../types/storyObject').StoryObjectCategory, itemId: string, userRequest: string, data: T) => string;
  
  // Utility
  getStoryObjects: (projectId: string) => StoryObjects;
  clearStoryObjects: (projectId: string) => void;
}

export class FunctionCallApplicator {
  private storeActions: StoryObjectStoreActions;

  constructor(storeActions: StoryObjectStoreActions) {
    this.storeActions = storeActions;
  }

  async applyFunctionCall(
    projectId: string, 
    functionCall: FunctionCallMetadata
  ): Promise<EditTagApplicationResult> {
    try {
      switch (functionCall.function_name) {
        case 'manage_story_objects':
          return await this.applyManageStoryObjects(projectId, functionCall.arguments);
        default:
          return {
            success: false,
            message: 'Unknown function name',
            error: `Unsupported function: ${functionCall.function_name}`
          };
      }
    } catch (error) {
      return {
        success: false,
        message: 'Failed to apply function call',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }


  private async applyManageStoryObjects(
    projectId: string,
    args: any
  ): Promise<EditTagApplicationResult> {
    if (!args || !args.operations || !Array.isArray(args.operations)) {
      return {
        success: false,
        message: 'Invalid manage_story_objects arguments',
        error: 'Function must receive operations array'
      };
    }

    let processedCount = 0;
    const results: string[] = [];

    for (const operation of args.operations) {
      const { action, type, id, data } = operation;

      if (!action || !type) {
        results.push(`Skipped operation: missing action or type`);
        continue;
      }

      try {
        switch (action) {
          case 'create':
            await this.handleCreateOperation(projectId, type, data, results);
            processedCount++;
            break;
          case 'update':
            if (!id || !data) {
              results.push(`Skipped update operation for ${type}: missing id or data`);
              continue;
            }
            await this.handleUpdateOperation(projectId, type, id, data, results);
            processedCount++;
            break;
          case 'delete':
            if (!id) {
              results.push(`Skipped delete operation for ${type}: missing id`);
              continue;
            }
            await this.handleDeleteOperation(projectId, type, id, results);
            processedCount++;
            break;
          default:
            results.push(`Unknown action: ${action}`);
        }
      } catch (error) {
        results.push(`Error processing ${action} ${type}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return {
      success: true,
      message: `Processed ${processedCount} operations: ${results.join(', ')}`
    };
  }

  private async handleCreateOperation(
    projectId: string,
    type: string,
    data: any,
    results: string[]
  ): Promise<void> {
    if (!data) {
      results.push(`Skipped create ${type}: missing data`);
      return;
    }

    switch (type) {
      case 'basic_info':
        // Use updateBasicInfo instead of setBasicInfo to ensure proper version creation
        await this.storeActions.updateBasicInfo(projectId, {
          title: data.title || '',
          logline: data.logline || '',
          genre: data.genre || ''
        });
        results.push(`Created basic info`);
        break;
      case 'character':
        await this.storeActions.addCharacter(projectId, { name: data.name || '', description: data.description || '' });
        results.push(`Created character: ${data.name}`);
        break;
      case 'organization':
        await this.storeActions.addOrganization(projectId, { name: data.name || '', description: data.description || '' });
        results.push(`Created organization: ${data.name}`);
        break;
      case 'location':
        await this.storeActions.addLocation(projectId, { name: data.name || '', description: data.description || '' });
        results.push(`Created location: ${data.name}`);
        break;
      case 'lorebook':
        await this.storeActions.addLorebookEntry(projectId, { name: data.name || '', description: data.description || '' });
        results.push(`Created lorebook entry: ${data.name}`);
        break;
      case 'act':
        const newAct = await this.storeActions.addAct(
          projectId,
          data.name || '',
          data.description || '',
          data.order ?? 0
        );
        // Version is automatically created by addAct

        // Handle chapters within act if provided
        if (data.chapters && Array.isArray(data.chapters)) {
          for (const chapter of data.chapters) {
            await this.storeActions.addChapter(
              projectId,
              newAct.id,
              chapter.name || '',
              chapter.description || '',
              chapter.order ?? 0
            );
            // Version is automatically created by addChapter
          }
        }
        results.push(`Created act: ${newAct.name}`);
        break;
      case 'chapter':
        if (!data.actId) {
          results.push(`Skipped create chapter: missing actId`);
          return;
        }
        const newChapter = await this.storeActions.addChapter(
          projectId,
          data.actId,
          data.name || '',
          data.description || '',
          data.order ?? 0
        );
        // Version is automatically created by addChapter
        results.push(`Created chapter: ${newChapter.name}`);
        break;
      default:
        results.push(`Unknown create type: ${type}`);
    }
  }

  private async handleUpdateOperation(
    projectId: string,
    type: string,
    id: string,
    data: any,
    results: string[]
  ): Promise<void> {
    const itemName = data.name || 'Unknown';

    switch (type) {
      case 'basic_info':
        this.storeActions.updateBasicInfo(projectId, data);
        // Version is automatically created by updateBasicInfo
        results.push(`Updated basic info`);
        break;
      case 'character':
        this.storeActions.updateCharacter(projectId, id, data);
        // Version is automatically created by updateCharacter
        results.push(`Updated character: ${itemName}`);
        break;
      case 'organization':
        this.storeActions.updateOrganization(projectId, id, data);
        // Version is automatically created by updateOrganization
        results.push(`Updated organization: ${itemName}`);
        break;
      case 'location':
        this.storeActions.updateLocation(projectId, id, data);
        // Version is automatically created by updateLocation
        results.push(`Updated location: ${itemName}`);
        break;
      case 'lorebook':
        this.storeActions.updateLorebookEntry(projectId, id, data);
        // Version is automatically created by updateLorebookEntry
        results.push(`Updated lorebook entry: ${itemName}`);
        break;
      case 'act':
        this.storeActions.updateAct(projectId, id, data);
        // Version is automatically created by updateAct
        results.push(`Updated act: ${itemName}`);
        break;
      case 'chapter':
        this.storeActions.updateChapter(projectId, id, data);
        // Version is automatically created by updateChapter
        results.push(`Updated chapter: ${itemName}`);
        break;
      default:
        results.push(`Unknown update type: ${type}`);
    }
  }

  private async handleDeleteOperation(
    projectId: string,
    type: string,
    id: string,
    results: string[]
  ): Promise<void> {
    const storyObjects = this.storeActions.getStoryObjects(projectId);

    switch (type) {
      case 'character':
        const charToDelete = storyObjects.characters.find(c => c.id === id);
        if (!charToDelete) {
          results.push(`Character with id ${id} not found`);
          return;
        }
        this.storeActions.deleteCharacter(projectId, id);
        results.push(`Deleted character: ${charToDelete.name}`);
        break;
      case 'organization':
        const orgToDelete = storyObjects.organizations.find(o => o.id === id);
        if (!orgToDelete) {
          results.push(`Organization with id ${id} not found`);
          return;
        }
        this.storeActions.deleteOrganization(projectId, id);
        results.push(`Deleted organization: ${orgToDelete.name}`);
        break;
      case 'location':
        const locToDelete = storyObjects.locations.find(l => l.id === id);
        if (!locToDelete) {
          results.push(`Location with id ${id} not found`);
          return;
        }
        this.storeActions.deleteLocation(projectId, id);
        results.push(`Deleted location: ${locToDelete.name}`);
        break;
      case 'lorebook':
        const entryToDelete = storyObjects.lorebook.find(e => e.id === id);
        if (!entryToDelete) {
          results.push(`Lorebook entry with id ${id} not found`);
          return;
        }
        this.storeActions.deleteLorebookEntry(projectId, id);
        results.push(`Deleted lorebook entry: ${entryToDelete.name}`);
        break;
      case 'act':
        const actToDelete = storyObjects.outline?.acts.find(a => a.id === id);
        if (!actToDelete) {
          results.push(`Act with id ${id} not found`);
          return;
        }
        this.storeActions.deleteAct(projectId, id);
        results.push(`Deleted act: ${actToDelete.name}`);
        break;
      case 'chapter':
        let chapterToDelete = null;
        if (storyObjects.outline) {
          for (const act of storyObjects.outline.acts) {
            const chapter = act.chapters.find(c => c.id === id);
            if (chapter) {
              chapterToDelete = chapter;
              break;
            }
          }
        }
        if (!chapterToDelete) {
          results.push(`Chapter with id ${id} not found`);
          return;
        }
        this.storeActions.deleteChapter(projectId, id);
        results.push(`Deleted chapter: ${chapterToDelete.name}`);
        break;
      default:
        results.push(`Unknown delete type: ${type}`);
    }
  }

}