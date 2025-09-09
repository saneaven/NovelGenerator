import type { EditTagMetadata } from '../../llm_request/types';
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
}

export class EditTagApplicator {
  private storeActions: StoryObjectStoreActions;

  constructor(storeActions: StoryObjectStoreActions) {
    this.storeActions = storeActions;
  }

  private createVersionForItem<T>(
    projectId: string, 
    category: import('../../types/storyObject').StoryObjectCategory, 
    itemId: string, 
    data: T, 
    editType: string, 
    summary?: string
  ): void {
    const userRequest = `AI Edit (${editType})${summary ? `: ${summary}` : ''}`;
    this.storeActions.addVersion(projectId, category, itemId, userRequest, data);
  }

  async applyEditTag(
    projectId: string, 
    editTag: EditTagMetadata
  ): Promise<EditTagApplicationResult> {
    try {
      switch (editTag.type) {
        case 'init':
          return await this.applyInitTag(projectId, editTag);
        case 'add':
          return await this.applyAddTag(projectId, editTag);
        case 'edit':
          return await this.applyEditTagContent(projectId, editTag);
        case 'remove':
          return await this.applyRemoveTag(projectId, editTag);
        default:
          return {
            success: false,
            message: 'Unknown edit tag type',
            error: `Unsupported edit tag type: ${editTag.type}`
          };
      }
    } catch (error) {
      return {
        success: false,
        message: 'Failed to apply edit tag',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async applyInitTag(
    projectId: string, 
    editTag: EditTagMetadata
  ): Promise<EditTagApplicationResult> {
    const data = editTag.content;
    
    if (!data || typeof data !== 'object') {
      return {
        success: false,
        message: 'Invalid init data format',
        error: 'Init tag must contain valid JSON data'
      };
    }

    let appliedCount = 0;

    // Initialize basic info if provided
    if (data.basic_info) {
      const basicInfoId = crypto.randomUUID();
      const basicInfoData = {
        id: basicInfoId,
        title: data.basic_info.title || '',
        logline: data.basic_info.logline || '',
        genre: data.basic_info.genre || '',
        description: data.basic_info.description || '',
        createdAt: new Date(),
        updatedAt: new Date(),
        versions: [],
        activeVersionId: ''
      };
      
      this.storeActions.setBasicInfo(projectId, basicInfoData);
      
      // Create version for this initialization
      this.createVersionForItem(
        projectId, 
        'basicInfo', 
        basicInfoId, 
        basicInfoData, 
        'init', 
        'Initialize basic info'
      );
      
      appliedCount++;
    }

    // Initialize characters if provided
    if (data.characters && Array.isArray(data.characters)) {
      data.characters.forEach((char: any) => {
        const newCharacter = this.storeActions.addCharacter(projectId, {
          name: char.name || '',
          description: char.description || '',
          ...char
        });
        
        // Create version for this character initialization
        this.createVersionForItem(
          projectId, 
          'character', 
          newCharacter.id, 
          newCharacter, 
          'init', 
          `Initialize character: ${newCharacter.name}`
        );
        
        appliedCount++;
      });
    }

    // Initialize organizations if provided
    if (data.organizations && Array.isArray(data.organizations)) {
      data.organizations.forEach((org: any) => {
        const newOrganization = this.storeActions.addOrganization(projectId, {
          name: org.name || '',
          description: org.description || '',
          ...org
        });
        
        // Create version for this organization initialization
        this.createVersionForItem(
          projectId, 
          'organization', 
          newOrganization.id, 
          newOrganization, 
          'init', 
          `Initialize organization: ${newOrganization.name}`
        );
        
        appliedCount++;
      });
    }

    // Initialize locations if provided
    if (data.locations && Array.isArray(data.locations)) {
      data.locations.forEach((loc: any) => {
        const newLocation = this.storeActions.addLocation(projectId, {
          name: loc.name || '',
          description: loc.description || '',
          ...loc
        });
        
        // Create version for this location initialization
        this.createVersionForItem(
          projectId, 
          'location', 
          newLocation.id, 
          newLocation, 
          'init', 
          `Initialize location: ${newLocation.name}`
        );
        
        appliedCount++;
      });
    }

    // Initialize acts if provided
    if (data.acts && Array.isArray(data.acts)) {
      data.acts.forEach((act: any) => {
        const newAct = this.storeActions.addAct(projectId, {
          name: act.name || '',
          description: act.description || '',
          ...act
        });
        
        // Create version for this act initialization
        this.createVersionForItem(
          projectId, 
          'outline', 
          newAct.id, 
          newAct, 
          'init', 
          `Initialize act: ${newAct.name}`
        );
        
        // Add chapters to this act if provided
        if (act.chapters && Array.isArray(act.chapters)) {
          act.chapters.forEach((chapter: any) => {
            const newChapter = this.storeActions.addChapter(projectId, newAct.id, {
              name: chapter.name || '',
              description: chapter.description || '',
              ...chapter
            });
            
            // Create version for chapter initialization
            this.createVersionForItem(
              projectId, 
              'outline', 
              newChapter.id, 
              newChapter, 
              'init', 
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

  private async applyAddTag(
    projectId: string, 
    editTag: EditTagMetadata
  ): Promise<EditTagApplicationResult> {
    const data = editTag.content;
    
    if (!data || typeof data !== 'object') {
      return {
        success: false,
        message: 'Invalid add data format',
        error: 'Add tag must contain valid JSON data'
      };
    }

    let addedCount = 0;

    // Add characters
    if (data.characters && Array.isArray(data.characters)) {
      data.characters.forEach((char: any) => {
        const newCharacter = this.storeActions.addCharacter(projectId, {
          name: char.name || '',
          description: char.description || '',
          ...char
        });
        
        // Create version for this character addition
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
    if (data.organizations && Array.isArray(data.organizations)) {
      data.organizations.forEach((org: any) => {
        const newOrganization = this.storeActions.addOrganization(projectId, {
          name: org.name || '',
          description: org.description || '',
          ...org
        });
        
        // Create version for this organization addition
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
    if (data.locations && Array.isArray(data.locations)) {
      data.locations.forEach((loc: any) => {
        const newLocation = this.storeActions.addLocation(projectId, {
          name: loc.name || '',
          description: loc.description || '',
          ...loc
        });
        
        // Create version for this location addition
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
    if (data.lorebook && Array.isArray(data.lorebook)) {
      data.lorebook.forEach((entry: any) => {
        const newEntry = this.storeActions.addLorebookEntry(projectId, {
          name: entry.name || '',
          description: entry.description || '',
          ...entry
        });
        
        // Create version for this lorebook entry addition
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
    if (data.acts && Array.isArray(data.acts)) {
      data.acts.forEach((act: any) => {
        const newAct = this.storeActions.addAct(projectId, {
          name: act.name || '',
          description: act.description || '',
          ...act
        });
        
        // Create version for this act addition
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
              ...chapter
            });
            
            // Create version for this chapter addition
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
    if (data.chapters && Array.isArray(data.chapters)) {
      data.chapters.forEach((chapter: any) => {
        if (chapter.actId) {
          const newChapter = this.storeActions.addChapter(projectId, chapter.actId, {
            name: chapter.name || '',
            description: chapter.description || '',
            ...chapter
          });
          
          // Create version for this chapter addition
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

  private async applyEditTagContent(
    projectId: string, 
    editTag: EditTagMetadata
  ): Promise<EditTagApplicationResult> {
    const data = editTag.content;
    
    if (!data || typeof data !== 'object') {
      return {
        success: false,
        message: 'Invalid edit data format',
        error: 'Edit tag must contain valid JSON data'
      };
    }

    let editedCount = 0;

    // Edit basic info
    if (data.basic_info) {
      this.storeActions.updateBasicInfo(projectId, data.basic_info);
      
      // Get the updated basic info to create version
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
    if (data.objects && Array.isArray(data.objects)) {
      data.objects.forEach((obj: any) => {
        if (!obj.id || !obj.type) return;

        const updates = { ...obj };
        delete updates.id;
        delete updates.type;

        const itemName = updates.name || obj.name || 'Unknown';

        switch (obj.type) {
          case 'character':
            this.storeActions.updateCharacter(projectId, obj.id, updates);
            
            // Get updated item and create version
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
            
            // Get updated item and create version
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
            
            // Get updated item and create version
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
            
            // Get updated item and create version
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
            
            // Get updated item and create version
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
            
            // Find chapter across all acts
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

  private async applyRemoveTag(
    projectId: string, 
    editTag: EditTagMetadata
  ): Promise<EditTagApplicationResult> {
    const data = editTag.content;
    
    if (!Array.isArray(data)) {
      return {
        success: false,
        message: 'Invalid remove data format',
        error: 'Remove tag must contain an array of objects with id and type'
      };
    }

    let removedCount = 0;

    data.forEach((obj: any) => {
      if (!obj.id || !obj.type) return;

      const itemName = obj.name || 'Unknown';

      switch (obj.type) {
        case 'character':
          // Get item before deletion to create version
          const storyObjects = this.storeActions.getStoryObjects(projectId);
          const characterToDelete = storyObjects.characters.find(c => c.id === obj.id);
          
          this.storeActions.deleteCharacter(projectId, obj.id);
          
          if (characterToDelete) {
            this.createVersionForItem(
              projectId, 
              'character', 
              obj.id, 
              { ...characterToDelete, deleted: true }, 
              'remove', 
              `Remove character: ${itemName}`
            );
          }
          
          removedCount++;
          break;
        case 'organization':
          // Get item before deletion to create version
          const storyObjects2 = this.storeActions.getStoryObjects(projectId);
          const orgToDelete = storyObjects2.organizations.find(o => o.id === obj.id);
          
          this.storeActions.deleteOrganization(projectId, obj.id);
          
          if (orgToDelete) {
            this.createVersionForItem(
              projectId, 
              'organization', 
              obj.id, 
              { ...orgToDelete, deleted: true }, 
              'remove', 
              `Remove organization: ${itemName}`
            );
          }
          
          removedCount++;
          break;
        case 'location':
          // Get item before deletion to create version
          const storyObjects3 = this.storeActions.getStoryObjects(projectId);
          const locationToDelete = storyObjects3.locations.find(l => l.id === obj.id);
          
          this.storeActions.deleteLocation(projectId, obj.id);
          
          if (locationToDelete) {
            this.createVersionForItem(
              projectId, 
              'location', 
              obj.id, 
              { ...locationToDelete, deleted: true }, 
              'remove', 
              `Remove location: ${itemName}`
            );
          }
          
          removedCount++;
          break;
        case 'lorebook':
          // Get item before deletion to create version
          const storyObjects4 = this.storeActions.getStoryObjects(projectId);
          const entryToDelete = storyObjects4.lorebook.find(e => e.id === obj.id);
          
          this.storeActions.deleteLorebookEntry(projectId, obj.id);
          
          if (entryToDelete) {
            this.createVersionForItem(
              projectId, 
              'lorebook', 
              obj.id, 
              { ...entryToDelete, deleted: true }, 
              'remove', 
              `Remove lorebook entry: ${itemName}`
            );
          }
          
          removedCount++;
          break;
        case 'act':
          // Get item before deletion to create version
          const storyObjects5 = this.storeActions.getStoryObjects(projectId);
          const actToDelete = storyObjects5.outline?.acts.find(a => a.id === obj.id);
          
          this.storeActions.deleteAct(projectId, obj.id);
          
          if (actToDelete) {
            this.createVersionForItem(
              projectId, 
              'outline', 
              obj.id, 
              { ...actToDelete, deleted: true }, 
              'remove', 
              `Remove act: ${itemName}`
            );
          }
          
          removedCount++;
          break;
        case 'chapter':
          // Find chapter before deletion to create version
          const storyObjects6 = this.storeActions.getStoryObjects(projectId);
          let chapterToDelete = null;
          if (storyObjects6.outline) {
            for (const act of storyObjects6.outline.acts) {
              const chapter = act.chapters.find(c => c.id === obj.id);
              if (chapter) {
                chapterToDelete = chapter;
                break;
              }
            }
          }
          
          this.storeActions.deleteChapter(projectId, obj.id);
          
          if (chapterToDelete) {
            this.createVersionForItem(
              projectId, 
              'outline', 
              obj.id, 
              { ...chapterToDelete, deleted: true }, 
              'remove', 
              `Remove chapter: ${itemName}`
            );
          }
          
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