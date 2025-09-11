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
        case 'initialize_story_objects':
          return await this.applyInitializeStoryObjects(projectId, functionCall.arguments);
        case 'add_story_objects':
          return await this.applyAddStoryObjects(projectId, functionCall.arguments);
        case 'edit_story_objects':
          return await this.applyEditStoryObjects(projectId, functionCall.arguments);
        case 'remove_story_objects':
          return await this.applyRemoveStoryObjects(projectId, functionCall.arguments);
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

  private createVersionForItem<T>(
    projectId: string, 
    category: import('../../types/storyObject').StoryObjectCategory, 
    itemId: string, 
    data: T, 
    editType: string, 
    summary?: string
  ): void {
    const userRequest = `AI Function Call (${editType})${summary ? `: ${summary}` : ''}`;
    
    // Extract only essential data to match initial version format
    let essentialData: any = data;
    if (data && typeof data === 'object' && 'name' in data && 'description' in data) {
      essentialData = {
        name: (data as any).name,
        description: (data as any).description,
      };
    }
    
    this.storeActions.addVersion(projectId, category, itemId, userRequest, essentialData);
  }

  private async applyInitializeStoryObjects(
    projectId: string, 
    args: any
  ): Promise<EditTagApplicationResult> {
    if (!args || typeof args !== 'object') {
      return {
        success: false,
        message: 'Invalid initialize arguments',
        error: 'Initialize function must receive valid arguments'
      };
    }

    // Clear all existing story objects first (init means overwrite/initialize)
    this.storeActions.clearStoryObjects(projectId);

    let appliedCount = 0;

    // Initialize basic info if provided
    if (args.basic_info) {
      const basicInfoId = crypto.randomUUID();
      const basicInfoData = {
        id: basicInfoId,
        title: args.basic_info.title || '',
        logline: args.basic_info.logline || '',
        genre: args.basic_info.genre || '',
        description: args.basic_info.description || '',
        createdAt: new Date(),
        updatedAt: new Date(),
        versions: [],
        activeVersionId: ''
      };
      
      this.storeActions.setBasicInfo(projectId, basicInfoData);
      
      this.createVersionForItem(
        projectId, 
        'basicInfo', 
        basicInfoId, 
        basicInfoData, 
        'initialize', 
        'Initialize basic info'
      );
      
      appliedCount++;
    }

    // Initialize characters if provided
    if (args.characters && Array.isArray(args.characters)) {
      args.characters.forEach((char: any) => {
        const newCharacter = this.storeActions.addCharacter(projectId, {
          name: char.name || '',
          description: char.description || ''
        });
        
        appliedCount++;
      });
    }

    // Initialize organizations if provided
    if (args.organizations && Array.isArray(args.organizations)) {
      args.organizations.forEach((org: any) => {
        const newOrganization = this.storeActions.addOrganization(projectId, {
          name: org.name || '',
          description: org.description || ''
        });
        
        appliedCount++;
      });
    }

    // Initialize locations if provided
    if (args.locations && Array.isArray(args.locations)) {
      args.locations.forEach((loc: any) => {
        const newLocation = this.storeActions.addLocation(projectId, {
          name: loc.name || '',
          description: loc.description || ''
        });
        
        appliedCount++;
      });
    }

    // Initialize lorebook if provided
    if (args.lorebook && Array.isArray(args.lorebook)) {
      args.lorebook.forEach((entry: any) => {
        const newEntry = this.storeActions.addLorebookEntry(projectId, {
          name: entry.name || '',
          description: entry.description || ''
        });
        
        appliedCount++;
      });
    }

    // Initialize acts if provided
    if (args.acts && Array.isArray(args.acts)) {
      args.acts.forEach((act: any) => {
        const newAct = this.storeActions.addAct(projectId, {
          name: act.name || '',
          description: act.description || '',
          ...act
        });
        
        this.createVersionForItem(
          projectId, 
          'outline', 
          newAct.id, 
          newAct, 
          'initialize', 
          `Initialize act: ${newAct.name}`
        );
        
        // Add chapters to this act if provided
        if (act.chapters && Array.isArray(act.chapters)) {
          act.chapters.forEach((chapter: any) => {
            const newChapter = this.storeActions.addChapter(projectId, newAct.id, {
              name: chapter.name || '',
              description: chapter.description || '',
              summary: chapter.summary || '',
              ...chapter
            });
            
            this.createVersionForItem(
              projectId, 
              'outline', 
              newChapter.id, 
              newChapter, 
              'initialize', 
              `Initialize chapter: ${newChapter.name}`
            );
          });
        }
        appliedCount++;
      });
    }

    return {
      success: true,
      message: `Initialized ${appliedCount} story objects`
    };
  }

  private async applyAddStoryObjects(
    projectId: string, 
    args: any
  ): Promise<EditTagApplicationResult> {
    if (!args || typeof args !== 'object') {
      return {
        success: false,
        message: 'Invalid add arguments',
        error: 'Add function must receive valid arguments'
      };
    }

    let addedCount = 0;

    // Add characters
    if (args.characters && Array.isArray(args.characters)) {
      args.characters.forEach((char: any) => {
        const newCharacter = this.storeActions.addCharacter(projectId, {
          name: char.name || '',
          description: char.description || '',
          age: char.age,
          role: char.role || '',
          backstory: char.backstory || '',
          ...char
        });
        
        this.createVersionForItem(
          projectId, 
          'character', 
          newCharacter.id, 
          newCharacter, 
          'add', 
          `Add character: ${newCharacter.name}`
        );
        
        addedCount++;
      });
    }

    // Add organizations
    if (args.organizations && Array.isArray(args.organizations)) {
      args.organizations.forEach((org: any) => {
        const newOrganization = this.storeActions.addOrganization(projectId, {
          name: org.name || '',
          description: org.description || '',
          type: org.type || '',
          purpose: org.purpose || '',
          ...org
        });
        
        this.createVersionForItem(
          projectId, 
          'organization', 
          newOrganization.id, 
          newOrganization, 
          'add', 
          `Add organization: ${newOrganization.name}`
        );
        
        addedCount++;
      });
    }

    // Add locations
    if (args.locations && Array.isArray(args.locations)) {
      args.locations.forEach((loc: any) => {
        const newLocation = this.storeActions.addLocation(projectId, {
          name: loc.name || '',
          description: loc.description || '',
          type: loc.type || '',
          significance: loc.significance || '',
          ...loc
        });
        
        this.createVersionForItem(
          projectId, 
          'location', 
          newLocation.id, 
          newLocation, 
          'add', 
          `Add location: ${newLocation.name}`
        );
        
        addedCount++;
      });
    }

    // Add lorebook entries
    if (args.lorebook && Array.isArray(args.lorebook)) {
      args.lorebook.forEach((entry: any) => {
        const newEntry = this.storeActions.addLorebookEntry(projectId, {
          name: entry.name || '',
          description: entry.description || '',
          category: entry.category || '',
          content: entry.content || '',
          ...entry
        });
        
        this.createVersionForItem(
          projectId, 
          'lorebook', 
          newEntry.id, 
          newEntry, 
          'add', 
          `Add lorebook entry: ${newEntry.name}`
        );
        
        addedCount++;
      });
    }

    // Add acts
    if (args.acts && Array.isArray(args.acts)) {
      args.acts.forEach((act: any) => {
        const newAct = this.storeActions.addAct(projectId, {
          name: act.name || '',
          description: act.description || '',
          ...act
        });
        
        this.createVersionForItem(
          projectId, 
          'outline', 
          newAct.id, 
          newAct, 
          'add', 
          `Add act: ${newAct.name}`
        );
        
        // Add chapters to this act if provided
        if (act.chapters && Array.isArray(act.chapters)) {
          act.chapters.forEach((chapter: any) => {
            const newChapter = this.storeActions.addChapter(projectId, newAct.id, {
              name: chapter.name || '',
              description: chapter.description || '',
              summary: chapter.summary || '',
              ...chapter
            });
            
            this.createVersionForItem(
              projectId, 
              'outline', 
              newChapter.id, 
              newChapter, 
              'add', 
              `Add chapter: ${newChapter.name}`
            );
          });
        }
        addedCount++;
      });
    }

    // Add chapters to existing acts
    if (args.chapters && Array.isArray(args.chapters)) {
      args.chapters.forEach((chapter: any) => {
        if (chapter.actId) {
          const newChapter = this.storeActions.addChapter(projectId, chapter.actId, {
            name: chapter.name || '',
            description: chapter.description || '',
            summary: chapter.summary || '',
            ...chapter
          });
          
          this.createVersionForItem(
            projectId, 
            'outline', 
            newChapter.id, 
            newChapter, 
            'add', 
            `Add chapter: ${newChapter.name}`
          );
          
          addedCount++;
        }
      });
    }

    return {
      success: true,
      message: `Added ${addedCount} story objects`
    };
  }

  private async applyEditStoryObjects(
    projectId: string, 
    args: any
  ): Promise<EditTagApplicationResult> {
    if (!args || typeof args !== 'object') {
      return {
        success: false,
        message: 'Invalid edit arguments',
        error: 'Edit function must receive valid arguments'
      };
    }

    let editedCount = 0;

    // Edit basic info
    if (args.basic_info) {
      this.storeActions.updateBasicInfo(projectId, args.basic_info);
      
      const storyObjects = this.storeActions.getStoryObjects(projectId);
      if (storyObjects.basicInfo) {
        this.createVersionForItem(
          projectId, 
          'basicInfo', 
          storyObjects.basicInfo.id, 
          storyObjects.basicInfo, 
          'edit', 
          'Edit basic info'
        );
      }
      
      editedCount++;
    }

    // Edit objects by type and ID
    if (args.objects && Array.isArray(args.objects)) {
      args.objects.forEach((obj: any) => {
        if (!obj.id || !obj.type) return;

        const updates = { ...obj };
        delete updates.id;
        delete updates.type;

        const itemName = updates.name || obj.name || 'Unknown';

        switch (obj.type) {
          case 'character':
            this.storeActions.updateCharacter(projectId, obj.id, updates);
            
            const storyObjects = this.storeActions.getStoryObjects(projectId);
            const updatedCharacter = storyObjects.characters.find(c => c.id === obj.id);
            if (updatedCharacter) {
              this.createVersionForItem(
                projectId, 
                'character', 
                obj.id, 
                updatedCharacter, 
                'edit', 
                `Edit character: ${itemName}`
              );
            }
            
            editedCount++;
            break;
          case 'organization':
            this.storeActions.updateOrganization(projectId, obj.id, updates);
            
            const storyObjects2 = this.storeActions.getStoryObjects(projectId);
            const updatedOrganization = storyObjects2.organizations.find(o => o.id === obj.id);
            if (updatedOrganization) {
              this.createVersionForItem(
                projectId, 
                'organization', 
                obj.id, 
                updatedOrganization, 
                'edit', 
                `Edit organization: ${itemName}`
              );
            }
            
            editedCount++;
            break;
          case 'location':
            this.storeActions.updateLocation(projectId, obj.id, updates);
            
            const storyObjects3 = this.storeActions.getStoryObjects(projectId);
            const updatedLocation = storyObjects3.locations.find(l => l.id === obj.id);
            if (updatedLocation) {
              this.createVersionForItem(
                projectId, 
                'location', 
                obj.id, 
                updatedLocation, 
                'edit', 
                `Edit location: ${itemName}`
              );
            }
            
            editedCount++;
            break;
          case 'lorebook':
            this.storeActions.updateLorebookEntry(projectId, obj.id, updates);
            
            const storyObjects4 = this.storeActions.getStoryObjects(projectId);
            const updatedEntry = storyObjects4.lorebook.find(e => e.id === obj.id);
            if (updatedEntry) {
              this.createVersionForItem(
                projectId, 
                'lorebook', 
                obj.id, 
                updatedEntry, 
                'edit', 
                `Edit lorebook entry: ${itemName}`
              );
            }
            
            editedCount++;
            break;
          case 'act':
            this.storeActions.updateAct(projectId, obj.id, updates);
            
            const storyObjects5 = this.storeActions.getStoryObjects(projectId);
            const updatedAct = storyObjects5.outline?.acts.find(a => a.id === obj.id);
            if (updatedAct) {
              this.createVersionForItem(
                projectId, 
                'outline', 
                obj.id, 
                updatedAct, 
                'edit', 
                `Edit act: ${itemName}`
              );
            }
            
            editedCount++;
            break;
          case 'chapter':
            this.storeActions.updateChapter(projectId, obj.id, updates);
            
            const storyObjects6 = this.storeActions.getStoryObjects(projectId);
            let updatedChapter = null;
            if (storyObjects6.outline) {
              for (const act of storyObjects6.outline.acts) {
                const chapter = act.chapters.find(c => c.id === obj.id);
                if (chapter) {
                  updatedChapter = chapter;
                  break;
                }
              }
            }
            
            if (updatedChapter) {
              this.createVersionForItem(
                projectId, 
                'outline', 
                obj.id, 
                updatedChapter, 
                'edit', 
                `Edit chapter: ${itemName}`
              );
            }
            
            editedCount++;
            break;
        }
      });
    }

    return {
      success: true,
      message: `Edited ${editedCount} story objects`
    };
  }

  private async applyRemoveStoryObjects(
    projectId: string, 
    args: any
  ): Promise<EditTagApplicationResult> {
    if (!args || !args.objects || !Array.isArray(args.objects)) {
      return {
        success: false,
        message: 'Invalid remove arguments',
        error: 'Remove function must receive objects array'
      };
    }

    let removedCount = 0;

    args.objects.forEach((obj: any) => {
      if (!obj.type || !obj.id) {
        console.warn(`Remove object missing required fields - type: "${obj.type}", id: "${obj.id}"`);
        return;
      }
      
      const targetId = obj.id;

      switch (obj.type) {
        case 'character':
          const storyObjects = this.storeActions.getStoryObjects(projectId);
          const characterToDelete = storyObjects.characters.find(c => c.id === targetId);
          
          if (!characterToDelete) {
            console.warn(`Character with id "${targetId}" not found`);
            return;
          }
          
          this.storeActions.deleteCharacter(projectId, targetId);
          
          this.createVersionForItem(
            projectId, 
            'character', 
            targetId, 
            { ...characterToDelete, deleted: true }, 
            'remove', 
            `Remove character: ${characterToDelete.name}`
          );
          
          removedCount++;
          break;
        case 'organization':
          const storyObjects2 = this.storeActions.getStoryObjects(projectId);
          const orgToDelete = storyObjects2.organizations.find(o => o.id === targetId);
          
          if (!orgToDelete) {
            console.warn(`Organization with id "${targetId}" not found`);
            return;
          }
          
          this.storeActions.deleteOrganization(projectId, targetId);
          
          this.createVersionForItem(
            projectId, 
            'organization', 
            targetId, 
            { ...orgToDelete, deleted: true }, 
            'remove', 
            `Remove organization: ${orgToDelete.name}`
          );
          
          removedCount++;
          break;
        case 'location':
          const storyObjects3 = this.storeActions.getStoryObjects(projectId);
          const locationToDelete = storyObjects3.locations.find(l => l.id === targetId);
          
          if (!locationToDelete) {
            console.warn(`Location with id "${targetId}" not found`);
            return;
          }
          
          this.storeActions.deleteLocation(projectId, targetId);
          
          this.createVersionForItem(
            projectId, 
            'location', 
            targetId, 
            { ...locationToDelete, deleted: true }, 
            'remove', 
            `Remove location: ${locationToDelete.name}`
          );
          
          removedCount++;
          break;
        case 'lorebook':
          const storyObjects4 = this.storeActions.getStoryObjects(projectId);
          const entryToDelete = storyObjects4.lorebook.find(e => e.id === targetId);
          
          if (!entryToDelete) {
            console.warn(`Lorebook entry with id "${targetId}" not found`);
            return;
          }
          
          this.storeActions.deleteLorebookEntry(projectId, targetId);
          
          this.createVersionForItem(
            projectId, 
            'lorebook', 
            targetId, 
            { ...entryToDelete, deleted: true }, 
            'remove', 
            `Remove lorebook entry: ${entryToDelete.name}`
          );
          
          removedCount++;
          break;
        case 'act':
          const storyObjects5 = this.storeActions.getStoryObjects(projectId);
          const actToDelete = storyObjects5.outline?.acts.find(a => a.id === targetId);
          
          if (!actToDelete) {
            console.warn(`Act with id "${targetId}" not found`);
            return;
          }
          
          this.storeActions.deleteAct(projectId, targetId);
          
          this.createVersionForItem(
            projectId, 
            'outline', 
            targetId, 
            { ...actToDelete, deleted: true }, 
            'remove', 
            `Remove act: ${actToDelete.name}`
          );
          
          removedCount++;
          break;
        case 'chapter':
          const storyObjects6 = this.storeActions.getStoryObjects(projectId);
          let chapterToDelete = null;
          if (storyObjects6.outline) {
            for (const act of storyObjects6.outline.acts) {
              const chapter = act.chapters.find(c => c.id === targetId);
              if (chapter) {
                chapterToDelete = chapter;
                break;
              }
            }
          }
          
          if (!chapterToDelete) {
            console.warn(`Chapter with id "${targetId}" not found`);
            return;
          }
          
          this.storeActions.deleteChapter(projectId, targetId);
          
          this.createVersionForItem(
            projectId, 
            'outline', 
            targetId, 
            { ...chapterToDelete, deleted: true }, 
            'remove', 
            `Remove chapter: ${chapterToDelete.name}`
          );
          
          removedCount++;
          break;
      }
    });

    return {
      success: true,
      message: `Removed ${removedCount} story objects`
    };
  }
}