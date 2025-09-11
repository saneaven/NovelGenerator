import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  StoryObjects,
  BasicInfo,
  Character,
  Organization,
  Location,
  LorebookEntry,
  Outline,
  Act,
  Chapter,
  ObjectVersion,
  StoryObjectCategory,
} from '../types/storyObject';
import {
  createEmptyStoryObjects,
  createEmptyBasicInfo,
  createNameDescriptionItem,
  createEmptyOutline,
  createEmptyAct,
  createEmptyChapter,
  ensureVersionFields,
} from '../types/storyObject';

interface StoryObjectStore {
  // Data storage by project
  storyObjectsByProject: Record<string, StoryObjects>;
  
  // Basic Info Actions
  setBasicInfo: (projectId: string, basicInfo: BasicInfo) => void;
  updateBasicInfo: (projectId: string, updates: Partial<Omit<BasicInfo, 'id' | 'createdAt'>>) => void;
  updateBasicInfoAI: (projectId: string, updates: Partial<Omit<BasicInfo, 'id' | 'createdAt'>>) => void;
  getBasicInfo: (projectId: string) => BasicInfo | null;
  
  // Character Actions
  addCharacter: (projectId: string, character?: Partial<Character>) => Character;
  updateCharacter: (projectId: string, id: string, updates: Partial<Omit<Character, 'id' | 'createdAt'>>) => void;
  updateCharacterAI: (projectId: string, id: string, updates: Partial<Omit<Character, 'id' | 'createdAt'>>) => void;
  deleteCharacter: (projectId: string, id: string) => void;
  getCharacters: (projectId: string) => Character[];
  
  // Organization Actions
  addOrganization: (projectId: string, organization?: Partial<Organization>) => Organization;
  updateOrganization: (projectId: string, id: string, updates: Partial<Omit<Organization, 'id' | 'createdAt'>>) => void;
  deleteOrganization: (projectId: string, id: string) => void;
  getOrganizations: (projectId: string) => Organization[];
  
  // Location Actions
  addLocation: (projectId: string, location?: Partial<Location>) => Location;
  updateLocation: (projectId: string, id: string, updates: Partial<Omit<Location, 'id' | 'createdAt'>>) => void;
  deleteLocation: (projectId: string, id: string) => void;
  getLocations: (projectId: string) => Location[];
  
  // Lorebook Actions
  addLorebookEntry: (projectId: string, entry?: Partial<LorebookEntry>) => LorebookEntry;
  updateLorebookEntry: (projectId: string, id: string, updates: Partial<Omit<LorebookEntry, 'id' | 'createdAt'>>) => void;
  deleteLorebookEntry: (projectId: string, id: string) => void;
  getLorebookEntries: (projectId: string) => LorebookEntry[];
  
  // Outline Actions
  setOutline: (projectId: string, outline: Outline) => void;
  getOutline: (projectId: string) => Outline | null;
  
  // Act Actions
  addAct: (projectId: string, act?: Partial<Act>) => Act;
  updateAct: (projectId: string, actId: string, updates: Partial<Omit<Act, 'id' | 'createdAt' | 'chapters'>>) => void;
  deleteAct: (projectId: string, actId: string) => void;
  
  // Chapter Actions
  addChapter: (projectId: string, actId: string, chapter?: Partial<Chapter>) => Chapter;
  updateChapter: (projectId: string, chapterId: string, updates: Partial<Omit<Chapter, 'id' | 'createdAt' | 'actId'>>) => void;
  deleteChapter: (projectId: string, chapterId: string) => void;
  
  // Version Management Actions
  addVersion: <T>(projectId: string, category: StoryObjectCategory, itemId: string, userRequest: string, data: T) => string;
  setActiveVersion: (projectId: string, category: StoryObjectCategory, itemId: string, versionId: string) => void;
  getVersions: (projectId: string, category: StoryObjectCategory, itemId: string) => ObjectVersion[];
  deleteVersion: (projectId: string, category: StoryObjectCategory, itemId: string, versionId: string) => void;
  getItemByCategoryAndId: (projectId: string, category: StoryObjectCategory, itemId: string) => any;
  
  // Utility Actions
  getStoryObjects: (projectId: string) => StoryObjects;
  clearStoryObjects: (projectId: string) => void;
}

export const useStoryObjectStore = create<StoryObjectStore>()(
  persist(
    (set, get) => ({
      storyObjectsByProject: {},

      // Helper function to create version for update
      createUpdateVersion: (currentData: any, userRequest: string = 'User Edit') => {
        const versionId = crypto.randomUUID();
        const now = new Date();
        
        // Extract only essential data
        let versionData: any = currentData;
        if (currentData && typeof currentData === 'object') {
          if ('name' in currentData && 'description' in currentData) {
            versionData = {
              name: currentData.name,
              description: currentData.description,
            };
          } else if ('title' in currentData && 'logline' in currentData && 'genre' in currentData) {
            versionData = {
              title: currentData.title,
              logline: currentData.logline,
              genre: currentData.genre,
            };
          } else if ('acts' in currentData) {
            versionData = {
              acts: currentData.acts?.map((act: any) => ({
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
        }
        
        return {
          versionId,
          timestamp: now,
          userRequest,
          data: versionData,
          isActive: true,
        };
      },

      // Helper function to add version to item
      addVersionToItem: (item: any, newVersion: any) => {
        const updatedVersions = item.versions.map((v: any) => ({ ...v, isActive: false }));
        updatedVersions.push(newVersion);
        
        return {
          ...item,
          versions: updatedVersions,
          activeVersionId: newVersion.versionId,
        };
      },

      // AI Edit specific update functions with custom userRequest
      updateCharacterAI: (projectId: string, id: string, updates: Partial<Omit<Character, 'id' | 'createdAt'>>) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const { createUpdateVersion, addVersionToItem } = get();
          
          const updatedCharacters = projectObjects.characters.map((char) => {
            if (char.id === id) {
              const updatedChar = { 
                ...char, 
                name: updates.name !== undefined ? updates.name : char.name,
                description: updates.description !== undefined ? updates.description : char.description,
                updatedAt: new Date() 
              };
              
              // Auto-create version for AI edit
              const newVersion = createUpdateVersion(updatedChar, 'AI Edit');
              return addVersionToItem(updatedChar, newVersion);
            }
            return char;
          });
          
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                characters: updatedCharacters,
              },
            },
          };
        });
      },

      updateBasicInfoAI: (projectId: string, updates: Partial<Omit<BasicInfo, 'id' | 'createdAt'>>) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const currentBasicInfo = projectObjects.basicInfo || createEmptyBasicInfo();
          const { createUpdateVersion, addVersionToItem } = get();
          
          const updatedBasicInfo = {
            ...currentBasicInfo,
            ...updates,
            updatedAt: new Date(),
          };
          
          // Auto-create version for AI edit
          const newVersion = createUpdateVersion(updatedBasicInfo, 'AI Edit');
          const basicInfoWithVersion = addVersionToItem(updatedBasicInfo, newVersion);
          
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                basicInfo: basicInfoWithVersion,
              },
            },
          };
        });
      },

      // Utility to ensure project exists
      ensureProject: (projectId: string) => {
        const state = get();
        if (!state.storyObjectsByProject[projectId]) {
          set({
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: createEmptyStoryObjects(),
            },
          });
        }
      },

      // Basic Info Actions
      setBasicInfo: (projectId: string, basicInfo: BasicInfo) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                basicInfo: { ...basicInfo, updatedAt: new Date() },
              },
            },
          };
        });
      },

      updateBasicInfo: (projectId: string, updates: Partial<Omit<BasicInfo, 'id' | 'createdAt'>>) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const currentBasicInfo = projectObjects.basicInfo || createEmptyBasicInfo();
          const { createUpdateVersion, addVersionToItem } = get();
          
          const updatedBasicInfo = {
            ...currentBasicInfo,
            ...updates,
            updatedAt: new Date(),
          };
          
          // Auto-create version for update
          const newVersion = createUpdateVersion(updatedBasicInfo);
          const basicInfoWithVersion = addVersionToItem(updatedBasicInfo, newVersion);
          
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                basicInfo: basicInfoWithVersion,
              },
            },
          };
        });
      },

      getBasicInfo: (projectId: string) => {
        const state = get();
        return state.storyObjectsByProject[projectId]?.basicInfo || null;
      },

      // Character Actions
      addCharacter: (projectId: string, character?: Partial<Character>) => {
        const newCharacter = {
          ...createNameDescriptionItem(character?.name || '', character?.description || ''),
        } as Character;

        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                characters: [...projectObjects.characters, newCharacter],
              },
            },
          };
        });

        return newCharacter;
      },

      updateCharacter: (projectId: string, id: string, updates: Partial<Omit<Character, 'id' | 'createdAt'>>) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const { createUpdateVersion, addVersionToItem } = get();
          
          const updatedCharacters = projectObjects.characters.map((char) => {
            if (char.id === id) {
              const updatedChar = { 
                ...char, 
                name: updates.name !== undefined ? updates.name : char.name,
                description: updates.description !== undefined ? updates.description : char.description,
                updatedAt: new Date() 
              };
              
              // Auto-create version for update
              const newVersion = createUpdateVersion(updatedChar);
              return addVersionToItem(updatedChar, newVersion);
            }
            return char;
          });
          
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                characters: updatedCharacters,
              },
            },
          };
        });
      },

      deleteCharacter: (projectId: string, id: string) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                characters: projectObjects.characters.filter((char) => char.id !== id),
              },
            },
          };
        });
      },

      getCharacters: (projectId: string) => {
        const state = get();
        return state.storyObjectsByProject[projectId]?.characters || [];
      },

      // Organization Actions
      addOrganization: (projectId: string, organization?: Partial<Organization>) => {
        const newOrganization = {
          ...createNameDescriptionItem(organization?.name || '', organization?.description || ''),
        } as Organization;

        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                organizations: [...projectObjects.organizations, newOrganization],
              },
            },
          };
        });

        return newOrganization;
      },

      updateOrganization: (projectId: string, id: string, updates: Partial<Omit<Organization, 'id' | 'createdAt'>>) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const { createUpdateVersion, addVersionToItem } = get();
          
          const updatedOrganizations = projectObjects.organizations.map((org) => {
            if (org.id === id) {
              const updatedOrg = { 
                ...org, 
                name: updates.name !== undefined ? updates.name : org.name,
                description: updates.description !== undefined ? updates.description : org.description,
                updatedAt: new Date() 
              };
              
              // Auto-create version for update
              const newVersion = createUpdateVersion(updatedOrg);
              return addVersionToItem(updatedOrg, newVersion);
            }
            return org;
          });
          
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                organizations: updatedOrganizations,
              },
            },
          };
        });
      },

      deleteOrganization: (projectId: string, id: string) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                organizations: projectObjects.organizations.filter((org) => org.id !== id),
              },
            },
          };
        });
      },

      getOrganizations: (projectId: string) => {
        const state = get();
        return state.storyObjectsByProject[projectId]?.organizations || [];
      },

      // Location Actions
      addLocation: (projectId: string, location?: Partial<Location>) => {
        const newLocation = {
          ...createNameDescriptionItem(location?.name || '', location?.description || ''),
        } as Location;

        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                locations: [...projectObjects.locations, newLocation],
              },
            },
          };
        });

        return newLocation;
      },

      updateLocation: (projectId: string, id: string, updates: Partial<Omit<Location, 'id' | 'createdAt'>>) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const { createUpdateVersion, addVersionToItem } = get();
          
          const updatedLocations = projectObjects.locations.map((loc) => {
            if (loc.id === id) {
              const updatedLoc = { 
                ...loc, 
                name: updates.name !== undefined ? updates.name : loc.name,
                description: updates.description !== undefined ? updates.description : loc.description,
                updatedAt: new Date() 
              };
              
              // Auto-create version for update
              const newVersion = createUpdateVersion(updatedLoc);
              return addVersionToItem(updatedLoc, newVersion);
            }
            return loc;
          });
          
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                locations: updatedLocations,
              },
            },
          };
        });
      },

      deleteLocation: (projectId: string, id: string) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                locations: projectObjects.locations.filter((loc) => loc.id !== id),
              },
            },
          };
        });
      },

      getLocations: (projectId: string) => {
        const state = get();
        return state.storyObjectsByProject[projectId]?.locations || [];
      },

      // Lorebook Actions
      addLorebookEntry: (projectId: string, entry?: Partial<LorebookEntry>) => {
        const newEntry = {
          ...createNameDescriptionItem(entry?.name || '', entry?.description || ''),
        } as LorebookEntry;

        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                lorebook: [...projectObjects.lorebook, newEntry],
              },
            },
          };
        });

        return newEntry;
      },

      updateLorebookEntry: (projectId: string, id: string, updates: Partial<Omit<LorebookEntry, 'id' | 'createdAt'>>) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const { createUpdateVersion, addVersionToItem } = get();
          
          const updatedLorebook = projectObjects.lorebook.map((entry) => {
            if (entry.id === id) {
              const updatedEntry = { 
                ...entry, 
                name: updates.name !== undefined ? updates.name : entry.name,
                description: updates.description !== undefined ? updates.description : entry.description,
                updatedAt: new Date() 
              };
              
              // Auto-create version for update
              const newVersion = createUpdateVersion(updatedEntry);
              return addVersionToItem(updatedEntry, newVersion);
            }
            return entry;
          });
          
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                lorebook: updatedLorebook,
              },
            },
          };
        });
      },

      deleteLorebookEntry: (projectId: string, id: string) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                lorebook: projectObjects.lorebook.filter((entry) => entry.id !== id),
              },
            },
          };
        });
      },

      getLorebookEntries: (projectId: string) => {
        const state = get();
        return state.storyObjectsByProject[projectId]?.lorebook || [];
      },

      // Outline Actions
      setOutline: (projectId: string, outline: Outline) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                outline: { ...outline, updatedAt: new Date() },
              },
            },
          };
        });
      },

      getOutline: (projectId: string) => {
        const state = get();
        return state.storyObjectsByProject[projectId]?.outline || null;
      },

      // Act Actions
      addAct: (projectId: string, act?: Partial<Act>) => {
        const newAct = {
          ...createEmptyAct(),
          name: act?.name || '',
          description: act?.description || '',
        } as Act;

        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const currentOutline = projectObjects.outline || createEmptyOutline();
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                outline: {
                  ...currentOutline,
                  acts: [...currentOutline.acts, newAct],
                  updatedAt: new Date(),
                },
              },
            },
          };
        });

        return newAct;
      },

      updateAct: (projectId: string, actId: string, updates: Partial<Omit<Act, 'id' | 'createdAt' | 'chapters'>>) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const currentOutline = projectObjects.outline;
          if (!currentOutline) return state;
          
          const { createUpdateVersion, addVersionToItem } = get();

          const updatedActs = currentOutline.acts.map((act) => {
            if (act.id === actId) {
              const updatedAct = { 
                ...act, 
                name: updates.name !== undefined ? updates.name : act.name,
                description: updates.description !== undefined ? updates.description : act.description,
                updatedAt: new Date() 
              };
              
              // Auto-create version for update
              const newVersion = createUpdateVersion(updatedAct);
              return addVersionToItem(updatedAct, newVersion);
            }
            return act;
          });

          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                outline: {
                  ...currentOutline,
                  acts: updatedActs,
                  updatedAt: new Date(),
                },
              },
            },
          };
        });
      },

      deleteAct: (projectId: string, actId: string) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const currentOutline = projectObjects.outline;
          if (!currentOutline) return state;

          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                outline: {
                  ...currentOutline,
                  acts: currentOutline.acts.filter((act) => act.id !== actId),
                  updatedAt: new Date(),
                },
              },
            },
          };
        });
      },

      // Chapter Actions
      addChapter: (projectId: string, actId: string, chapter?: Partial<Chapter>) => {
        const newChapter = {
          ...createEmptyChapter(actId),
          name: chapter?.name || '',
          description: chapter?.description || '',
          actId,
        } as Chapter;

        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const currentOutline = projectObjects.outline;
          if (!currentOutline) return state;

          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                outline: {
                  ...currentOutline,
                  acts: currentOutline.acts.map((act) =>
                    act.id === actId
                      ? { ...act, chapters: [...act.chapters, newChapter], updatedAt: new Date() }
                      : act
                  ),
                  updatedAt: new Date(),
                },
              },
            },
          };
        });

        return newChapter;
      },

      updateChapter: (projectId: string, chapterId: string, updates: Partial<Omit<Chapter, 'id' | 'createdAt' | 'actId'>>) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const currentOutline = projectObjects.outline;
          if (!currentOutline) return state;
          
          const { createUpdateVersion, addVersionToItem } = get();

          const updatedActs = currentOutline.acts.map((act) => ({
            ...act,
            chapters: act.chapters.map((chapter) => {
              if (chapter.id === chapterId) {
                const updatedChapter = { 
                  ...chapter, 
                  name: updates.name !== undefined ? updates.name : chapter.name,
                  description: updates.description !== undefined ? updates.description : chapter.description,
                  updatedAt: new Date() 
                };
                
                // Auto-create version for update
                const newVersion = createUpdateVersion(updatedChapter);
                return addVersionToItem(updatedChapter, newVersion);
              }
              return chapter;
            }),
            updatedAt: new Date(),
          }));

          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                outline: {
                  ...currentOutline,
                  acts: updatedActs,
                  updatedAt: new Date(),
                },
              },
            },
          };
        });
      },

      deleteChapter: (projectId: string, chapterId: string) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const currentOutline = projectObjects.outline;
          if (!currentOutline) return state;

          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                outline: {
                  ...currentOutline,
                  acts: currentOutline.acts.map((act) => ({
                    ...act,
                    chapters: act.chapters.filter((chapter) => chapter.id !== chapterId),
                    updatedAt: new Date(),
                  })),
                  updatedAt: new Date(),
                },
              },
            },
          };
        });
      },

      // Utility Actions
      getStoryObjects: (projectId: string) => {
        const state = get();
        return state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
      },

      clearStoryObjects: (projectId: string) => {
        set((state) => ({
          storyObjectsByProject: {
            ...state.storyObjectsByProject,
            [projectId]: createEmptyStoryObjects(),
          },
        }));
      },

      // Helper function to get item by category and id
      getItemByCategoryAndId: (projectId: string, category: StoryObjectCategory, itemId: string) => {
        const state = get();
        const projectObjects = state.storyObjectsByProject[projectId];
        if (!projectObjects) return null;

        switch (category) {
          case 'basicInfo':
            return projectObjects.basicInfo?.id === itemId ? projectObjects.basicInfo : null;
          case 'character':
            return projectObjects.characters.find(c => c.id === itemId) || null;
          case 'organization':
            return projectObjects.organizations.find(o => o.id === itemId) || null;
          case 'location':
            return projectObjects.locations.find(l => l.id === itemId) || null;
          case 'lorebook':
            return projectObjects.lorebook.find(e => e.id === itemId) || null;
          case 'outline':
            return projectObjects.outline?.id === itemId ? projectObjects.outline : null;
          default:
            return null;
        }
      },

      // Version Management Actions
      addVersion: <T>(projectId: string, category: StoryObjectCategory, itemId: string, userRequest: string, data: T) => {
        const versionId = crypto.randomUUID();
        const now = new Date();

        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          
          const updateItemVersions = (item: any) => {
            if (!item || item.id !== itemId) return item;
            
            // Mark all existing versions as inactive
            const updatedVersions = item.versions.map((v: ObjectVersion) => ({
              ...v,
              isActive: false,
            }));

            // Add new version as active
            updatedVersions.push({
              versionId,
              timestamp: now,
              userRequest,
              data,
              isActive: true,
            });

            return {
              ...item,
              versions: updatedVersions,
              activeVersionId: versionId,
              updatedAt: now,
            };
          };

          let updatedProjectObjects = { ...projectObjects };

          switch (category) {
            case 'basicInfo':
              if (updatedProjectObjects.basicInfo) {
                updatedProjectObjects.basicInfo = updateItemVersions(updatedProjectObjects.basicInfo);
              }
              break;
            case 'character':
              updatedProjectObjects.characters = updatedProjectObjects.characters.map(updateItemVersions);
              break;
            case 'organization':
              updatedProjectObjects.organizations = updatedProjectObjects.organizations.map(updateItemVersions);
              break;
            case 'location':
              updatedProjectObjects.locations = updatedProjectObjects.locations.map(updateItemVersions);
              break;
            case 'lorebook':
              updatedProjectObjects.lorebook = updatedProjectObjects.lorebook.map(updateItemVersions);
              break;
            case 'outline':
              if (updatedProjectObjects.outline) {
                updatedProjectObjects.outline = updateItemVersions(updatedProjectObjects.outline);
              }
              break;
          }

          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: updatedProjectObjects,
            },
          };
        });

        return versionId;
      },

      setActiveVersion: (projectId: string, category: StoryObjectCategory, itemId: string, versionId: string) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          
          const updateItemActiveVersion = (item: any) => {
            if (!item || item.id !== itemId) return item;
            
            const targetVersion = item.versions.find((v: ObjectVersion) => v.versionId === versionId);
            if (!targetVersion) return item;

            // Update active version
            const updatedVersions = item.versions.map((v: ObjectVersion) => ({
              ...v,
              isActive: v.versionId === versionId,
            }));

            return {
              ...item,
              versions: updatedVersions,
              activeVersionId: versionId,
              updatedAt: new Date(),
            };
          };

          let updatedProjectObjects = { ...projectObjects };

          switch (category) {
            case 'basicInfo':
              if (updatedProjectObjects.basicInfo) {
                updatedProjectObjects.basicInfo = updateItemActiveVersion(updatedProjectObjects.basicInfo);
              }
              break;
            case 'character':
              updatedProjectObjects.characters = updatedProjectObjects.characters.map(updateItemActiveVersion);
              break;
            case 'organization':
              updatedProjectObjects.organizations = updatedProjectObjects.organizations.map(updateItemActiveVersion);
              break;
            case 'location':
              updatedProjectObjects.locations = updatedProjectObjects.locations.map(updateItemActiveVersion);
              break;
            case 'lorebook':
              updatedProjectObjects.lorebook = updatedProjectObjects.lorebook.map(updateItemActiveVersion);
              break;
            case 'outline':
              if (updatedProjectObjects.outline) {
                updatedProjectObjects.outline = updateItemActiveVersion(updatedProjectObjects.outline);
              }
              break;
          }

          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: updatedProjectObjects,
            },
          };
        });
      },

      getVersions: (projectId: string, category: StoryObjectCategory, itemId: string) => {
        const state = get();
        const item = get().getItemByCategoryAndId(projectId, category, itemId);
        return item?.versions || [];
      },

      deleteVersion: (projectId: string, category: StoryObjectCategory, itemId: string, versionId: string) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          
          const updateItemVersions = (item: any) => {
            if (!item || item.id !== itemId) return item;
            
            const filteredVersions = item.versions.filter((v: ObjectVersion) => v.versionId !== versionId);
            
            // If we deleted the active version, make the most recent remaining version active
            let newActiveVersionId = item.activeVersionId;
            if (item.activeVersionId === versionId && filteredVersions.length > 0) {
              const mostRecent = filteredVersions.reduce((latest: ObjectVersion, current: ObjectVersion) =>
                new Date(current.timestamp) > new Date(latest.timestamp) ? current : latest
              );
              newActiveVersionId = mostRecent.versionId;
              
              // Update the active flag
              filteredVersions.forEach((v: ObjectVersion) => {
                v.isActive = v.versionId === newActiveVersionId;
              });
            }

            return {
              ...item,
              versions: filteredVersions,
              activeVersionId: newActiveVersionId,
              updatedAt: new Date(),
            };
          };

          let updatedProjectObjects = { ...projectObjects };

          switch (category) {
            case 'basicInfo':
              if (updatedProjectObjects.basicInfo) {
                updatedProjectObjects.basicInfo = updateItemVersions(updatedProjectObjects.basicInfo);
              }
              break;
            case 'character':
              updatedProjectObjects.characters = updatedProjectObjects.characters.map(updateItemVersions);
              break;
            case 'organization':
              updatedProjectObjects.organizations = updatedProjectObjects.organizations.map(updateItemVersions);
              break;
            case 'location':
              updatedProjectObjects.locations = updatedProjectObjects.locations.map(updateItemVersions);
              break;
            case 'lorebook':
              updatedProjectObjects.lorebook = updatedProjectObjects.lorebook.map(updateItemVersions);
              break;
            case 'outline':
              if (updatedProjectObjects.outline) {
                updatedProjectObjects.outline = updateItemVersions(updatedProjectObjects.outline);
              }
              break;
          }

          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: updatedProjectObjects,
            },
          };
        });
      },
    }),
    {
      name: 'story-object-storage',
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          try {
            const parsed = JSON.parse(str);
            // Convert date strings back to Date objects for all story objects
            if (parsed.state?.storyObjectsByProject) {
              Object.keys(parsed.state.storyObjectsByProject).forEach((projectId) => {
                const projectObjects = parsed.state.storyObjectsByProject[projectId];
                
                // Convert BasicInfo dates and ensure version fields
                if (projectObjects.basicInfo) {
                  projectObjects.basicInfo.createdAt = new Date(projectObjects.basicInfo.createdAt);
                  projectObjects.basicInfo.updatedAt = new Date(projectObjects.basicInfo.updatedAt);
                  if (projectObjects.basicInfo.versions) {
                    projectObjects.basicInfo.versions = projectObjects.basicInfo.versions.map((v: any) => ({
                      ...v,
                      timestamp: new Date(v.timestamp),
                    }));
                  }
                  projectObjects.basicInfo = ensureVersionFields(projectObjects.basicInfo);
                }
                
                // Convert array items dates and ensure version fields
                ['characters', 'organizations', 'locations', 'lorebook'].forEach((category) => {
                  if (projectObjects[category]) {
                    projectObjects[category] = projectObjects[category].map((item: any) => {
                      const processedItem = {
                        ...item,
                        createdAt: new Date(item.createdAt),
                        updatedAt: new Date(item.updatedAt),
                        versions: item.versions ? item.versions.map((v: any) => ({
                          ...v,
                          timestamp: new Date(v.timestamp),
                        })) : [],
                      };
                      return ensureVersionFields(processedItem);
                    });
                  }
                });
                
                // Convert Outline dates (acts and chapters) and ensure version fields
                if (projectObjects.outline) {
                  projectObjects.outline.createdAt = new Date(projectObjects.outline.createdAt);
                  projectObjects.outline.updatedAt = new Date(projectObjects.outline.updatedAt);
                  if (projectObjects.outline.versions) {
                    projectObjects.outline.versions = projectObjects.outline.versions.map((v: any) => ({
                      ...v,
                      timestamp: new Date(v.timestamp),
                    }));
                  }
                  
                  if (projectObjects.outline.acts) {
                    projectObjects.outline.acts = projectObjects.outline.acts.map((act: any) => {
                      const processedAct = {
                        ...act,
                        createdAt: new Date(act.createdAt),
                        updatedAt: new Date(act.updatedAt),
                        versions: act.versions ? act.versions.map((v: any) => ({
                          ...v,
                          timestamp: new Date(v.timestamp),
                        })) : [],
                        chapters: act.chapters?.map((chapter: any) => {
                          const processedChapter = {
                            ...chapter,
                            createdAt: new Date(chapter.createdAt),
                            updatedAt: new Date(chapter.updatedAt),
                            versions: chapter.versions ? chapter.versions.map((v: any) => ({
                              ...v,
                              timestamp: new Date(v.timestamp),
                            })) : [],
                          };
                          return ensureVersionFields(processedChapter);
                        }) || [],
                      };
                      return ensureVersionFields(processedAct);
                    });
                  }
                  
                  projectObjects.outline = ensureVersionFields(projectObjects.outline);
                }
              });
            }
            return parsed;
          } catch {
            return null;
          }
        },
        setItem: (name, value) => {
          localStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => {
          localStorage.removeItem(name);
        },
      },
    }
  )
);