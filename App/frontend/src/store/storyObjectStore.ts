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
import { useSettingsStore } from './settingsStore';

interface StoryObjectStore {
  // Data storage by project
  storyObjectsByProject: Record<string, StoryObjects>;
  
  // Basic Info Actions
  setBasicInfo: (projectId: string, basicInfo: BasicInfo) => void;
  updateBasicInfo: (projectId: string, updates: Partial<Omit<BasicInfo, 'id' | 'createdAt'>>, editLanguage?: string) => void;
  updateBasicInfoAI: (projectId: string, updates: Partial<Omit<BasicInfo, 'id' | 'createdAt'>>) => void;
  getBasicInfo: (projectId: string) => BasicInfo | null;
  
  // Character Actions
  addCharacter: (projectId: string, character?: Partial<Character>) => Character;
  updateCharacter: (projectId: string, id: string, updates: Partial<Omit<Character, 'id' | 'createdAt'>>, editLanguage?: string) => void;
  updateCharacterAI: (projectId: string, id: string, updates: Partial<Omit<Character, 'id' | 'createdAt'>>) => void;
  deleteCharacter: (projectId: string, id: string) => void;
  getCharacters: (projectId: string) => Character[];

  // Organization Actions
  addOrganization: (projectId: string, organization?: Partial<Organization>) => Organization;
  updateOrganization: (projectId: string, id: string, updates: Partial<Omit<Organization, 'id' | 'createdAt'>>, editLanguage?: string) => void;
  deleteOrganization: (projectId: string, id: string) => void;
  getOrganizations: (projectId: string) => Organization[];

  // Location Actions
  addLocation: (projectId: string, location?: Partial<Location>) => Location;
  updateLocation: (projectId: string, id: string, updates: Partial<Omit<Location, 'id' | 'createdAt'>>, editLanguage?: string) => void;
  deleteLocation: (projectId: string, id: string) => void;
  getLocations: (projectId: string) => Location[];

  // Lorebook Actions
  addLorebookEntry: (projectId: string, entry?: Partial<LorebookEntry>) => LorebookEntry;
  updateLorebookEntry: (projectId: string, id: string, updates: Partial<Omit<LorebookEntry, 'id' | 'createdAt'>>, editLanguage?: string) => void;
  deleteLorebookEntry: (projectId: string, id: string) => void;
  getLorebookEntries: (projectId: string) => LorebookEntry[];
  
  // Outline Actions
  setOutline: (projectId: string, outline: Outline) => void;
  updateOutlineAI: (projectId: string, outline: Outline) => void;
  getOutline: (projectId: string) => Outline | null;
  
  // Act Actions
  addAct: (projectId: string, act?: Partial<Act>) => Act;
  updateAct: (projectId: string, actId: string, updates: Partial<Omit<Act, 'id' | 'createdAt' | 'chapters'>>, editLanguage?: string) => void;
  deleteAct: (projectId: string, actId: string) => void;

  // Chapter Actions
  addChapter: (projectId: string, actId: string, chapter?: Partial<Chapter>) => Chapter;
  updateChapter: (projectId: string, chapterId: string, updates: Partial<Omit<Chapter, 'id' | 'createdAt' | 'actId'>>, editLanguage?: string) => void;
  deleteChapter: (projectId: string, chapterId: string) => void;
  
  compareVersionData: (data1: unknown, data2: unknown) => boolean;
  createUpdateVersion: (currentData: any, userRequest?: string, language?: string) => ObjectVersion | null;
  addVersionToItem: (item: any, newVersion: ObjectVersion | null) => any;

  // Version Management Actions
  addVersion: <T>(projectId: string, category: StoryObjectCategory, itemId: string, userRequest: string, data: T) => string;
  setActiveVersion: (projectId: string, category: StoryObjectCategory, itemId: string, versionId: string) => void;
  getVersions: (projectId: string, category: StoryObjectCategory, itemId: string) => ObjectVersion[];
  deleteVersion: (projectId: string, category: StoryObjectCategory, itemId: string, versionId: string) => void;
  getItemByCategoryAndId: (projectId: string, category: StoryObjectCategory, itemId: string) => any;
  getActById: (projectId: string, actId: string) => Act | null;
  getChapterById: (projectId: string, chapterId: string) => Chapter | null;
  getActVersions: (projectId: string, actId: string) => ObjectVersion[];
  getChapterVersions: (projectId: string, chapterId: string) => ObjectVersion[];
  
  // Utility Actions
  getStoryObjects: (projectId: string) => StoryObjects;
  clearStoryObjects: (projectId: string) => void;

  // Language-aware data access methods
  getItemDataInLanguage: (projectId: string, category: StoryObjectCategory, itemId: string, language: string) => any;
  hasItemDataInLanguage: (projectId: string, category: StoryObjectCategory, itemId: string, language: string) => boolean;
  getAvailableLanguagesForItem: (projectId: string, category: StoryObjectCategory, itemId: string) => string[];
  addTranslatedDataToItem: (projectId: string, category: StoryObjectCategory, itemId: string, language: string, translatedData: any) => void;
  syncFlatFieldsWithLanguage: (projectId: string, category: StoryObjectCategory, itemId: string, language: string) => void;
  getPreviousVersionDataInLanguage: (projectId: string, category: StoryObjectCategory, itemId: string, language: string) => any;
}

export const useStoryObjectStore = create<StoryObjectStore>()(
  persist(
    (set, get) => ({
      storyObjectsByProject: {},

      // Helper function to deeply compare version data
      compareVersionData: (data1: any, data2: any): boolean => {
        if (data1 === data2) return true;
        if (data1 == null || data2 == null) return data1 === data2;
        if (typeof data1 !== typeof data2) return false;
        
        if (typeof data1 === 'object') {
          const keys1 = Object.keys(data1);
          const keys2 = Object.keys(data2);
          
          if (keys1.length !== keys2.length) return false;
          
          for (const key of keys1) {
            if (!keys2.includes(key)) return false;
            if (!get().compareVersionData(data1[key], data2[key])) return false;
          }
          
          return true;
        }
        
        return false;
      },

      // Helper function to create version for update
      createUpdateVersion: (currentData: any, userRequest: string = 'User Edit', language?: string) => {
        // Get the language to use for version data
        const targetLanguage = language || 'English';

        // Extract essential data from flat fields
        let extractedData: any = null;
        if (currentData && typeof currentData === 'object') {
          if ('name' in currentData && 'description' in currentData) {
            extractedData = {
              name: currentData.name,
              description: currentData.description,
            };
          } else if ('title' in currentData && 'logline' in currentData && 'genre' in currentData) {
            extractedData = {
              title: currentData.title,
              logline: currentData.logline,
              genre: currentData.genre,
            };
          } else if ('acts' in currentData) {
            extractedData = {
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

        if (!extractedData) {
          return null; // No valid data to create version
        }

        // Build LanguageData structure
        // ONLY store the language being edited (don't copy other languages from previous version)
        const versionData: Record<string, any> = {
          [targetLanguage]: extractedData
        };

        // Check if data changed compared to active version's same language
        if (currentData.versions && currentData.versions.length > 0) {
          const activeVersion = currentData.versions.find((v: ObjectVersion) => v.isActive);
          if (activeVersion?.data && activeVersion.data[targetLanguage]) {
            if (get().compareVersionData(activeVersion.data[targetLanguage], extractedData)) {
              return null; // No change in this language, don't create new version
            }
          }
        }

        const versionId = crypto.randomUUID();
        const now = new Date();

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
        // If newVersion is null, return the item unchanged
        if (!newVersion) {
          return item;
        }
        
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
          const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;

          const updatedCharacters = projectObjects.characters.map((char) => {
            if (char.id === id) {
              const updatedChar = {
                ...char,
                name: updates.name !== undefined ? updates.name : char.name,
                description: updates.description !== undefined ? updates.description : char.description,
                updatedAt: new Date()
              };

              // Auto-create version for AI edit
              const newVersion = createUpdateVersion(updatedChar, 'AI Edit', primaryLanguage);
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
          const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;

          const updatedBasicInfo = {
            ...currentBasicInfo,
            ...updates,
            updatedAt: new Date(),
          };

          // Auto-create version for AI edit
          const newVersion = createUpdateVersion(updatedBasicInfo, 'AI Edit', primaryLanguage);
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

      updateBasicInfo: (projectId: string, updates: Partial<Omit<BasicInfo, 'id' | 'createdAt'>>, editLanguage?: string) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const currentBasicInfo = projectObjects.basicInfo || createEmptyBasicInfo();
          const { createUpdateVersion, addVersionToItem } = get();
          const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
          const languageToUse = editLanguage || primaryLanguage;

          const updatedBasicInfo = {
            ...currentBasicInfo,
            ...updates,
            updatedAt: new Date(),
          };

          // Auto-create version for update with the language being edited
          const newVersion = createUpdateVersion(updatedBasicInfo, 'User Edit', languageToUse);
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
        const storeState = get();
        return storeState.storyObjectsByProject[projectId]?.basicInfo || null;
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

      updateCharacter: (projectId: string, id: string, updates: Partial<Omit<Character, 'id' | 'createdAt'>>, editLanguage?: string) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const { createUpdateVersion, addVersionToItem } = get();
          const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
          const languageToUse = editLanguage || primaryLanguage;

          const updatedCharacters = projectObjects.characters.map((char) => {
            if (char.id === id) {
              const updatedChar = {
                ...char,
                name: updates.name !== undefined ? updates.name : char.name,
                description: updates.description !== undefined ? updates.description : char.description,
                updatedAt: new Date()
              };

              // Auto-create version for update with the language being edited
              const newVersion = createUpdateVersion(updatedChar, 'User Edit', languageToUse);
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
        const storeState = get();
        return storeState.storyObjectsByProject[projectId]?.characters || [];
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

      updateOrganization: (projectId: string, id: string, updates: Partial<Omit<Organization, 'id' | 'createdAt'>>, editLanguage?: string) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const { createUpdateVersion, addVersionToItem } = get();
          const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
          const languageToUse = editLanguage || primaryLanguage;

          const updatedOrganizations = projectObjects.organizations.map((org) => {
            if (org.id === id) {
              const updatedOrg = {
                ...org,
                name: updates.name !== undefined ? updates.name : org.name,
                description: updates.description !== undefined ? updates.description : org.description,
                updatedAt: new Date()
              };

              // Auto-create version for update with the language being edited
              const newVersion = createUpdateVersion(updatedOrg, 'User Edit', languageToUse);
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
        const storeState = get();
        return storeState.storyObjectsByProject[projectId]?.organizations || [];
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

      updateLocation: (projectId: string, id: string, updates: Partial<Omit<Location, 'id' | 'createdAt'>>, editLanguage?: string) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const { createUpdateVersion, addVersionToItem } = get();
          const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
          const languageToUse = editLanguage || primaryLanguage;

          const updatedLocations = projectObjects.locations.map((loc) => {
            if (loc.id === id) {
              const updatedLoc = {
                ...loc,
                name: updates.name !== undefined ? updates.name : loc.name,
                description: updates.description !== undefined ? updates.description : loc.description,
                updatedAt: new Date()
              };

              // Auto-create version for update with the language being edited
              const newVersion = createUpdateVersion(updatedLoc, 'User Edit', languageToUse);
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
        const storeState = get();
        return storeState.storyObjectsByProject[projectId]?.locations || [];
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

      updateLorebookEntry: (projectId: string, id: string, updates: Partial<Omit<LorebookEntry, 'id' | 'createdAt'>>, editLanguage?: string) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const { createUpdateVersion, addVersionToItem } = get();
          const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
          const languageToUse = editLanguage || primaryLanguage;

          const updatedLorebook = projectObjects.lorebook.map((entry) => {
            if (entry.id === id) {
              const updatedEntry = {
                ...entry,
                name: updates.name !== undefined ? updates.name : entry.name,
                description: updates.description !== undefined ? updates.description : entry.description,
                updatedAt: new Date()
              };

              // Auto-create version for update with the language being edited
              const newVersion = createUpdateVersion(updatedEntry, 'User Edit', languageToUse);
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
        const storeState = get();
        return storeState.storyObjectsByProject[projectId]?.lorebook || [];
      },

      // Outline Actions
      setOutline: (projectId: string, outline: Outline) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const { createUpdateVersion, addVersionToItem } = get();
          
          const updatedOutline = { 
            ...outline, 
            updatedAt: new Date() 
          };
          
          // Auto-create version for outline updates
          const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
          const newVersion = createUpdateVersion(updatedOutline, 'User Edit', primaryLanguage);
          const outlineWithVersion = addVersionToItem(updatedOutline, newVersion);
          
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                outline: outlineWithVersion,
              },
            },
          };
        });
      },

      // AI Edit for outline
      updateOutlineAI: (projectId: string, outline: Outline) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const { createUpdateVersion, addVersionToItem } = get();
          
          const updatedOutline = { 
            ...outline, 
            updatedAt: new Date() 
          };
          
          // Auto-create version for AI edit
          const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
          const newVersion = createUpdateVersion(updatedOutline, 'AI Edit', primaryLanguage);
          const outlineWithVersion = addVersionToItem(updatedOutline, newVersion);
          
          return {
            storyObjectsByProject: {
              ...state.storyObjectsByProject,
              [projectId]: {
                ...projectObjects,
                outline: outlineWithVersion,
              },
            },
          };
        });
      },

      getOutline: (projectId: string) => {
        const storeState = get();
        return storeState.storyObjectsByProject[projectId]?.outline || null;
      },

      // Act Actions
      addAct: (projectId: string, act?: Partial<Act>) => {
        const newAct = {
          ...createEmptyAct(),
          name: act?.name || '',
          description: act?.description || '',
        } as Act;

        // Update the initial version data with actual values
        newAct.versions[0].data = {
          name: newAct.name,
          description: newAct.description,
        };

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

      updateAct: (projectId: string, actId: string, updates: Partial<Omit<Act, 'id' | 'createdAt' | 'chapters'>>, editLanguage?: string) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const currentOutline = projectObjects.outline;
          if (!currentOutline) return state;

          const { createUpdateVersion, addVersionToItem } = get();
          const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
          const languageToUse = editLanguage || primaryLanguage;

          const updatedActs = currentOutline.acts.map((act) => {
            if (act.id === actId) {
              const updatedAct = {
                ...act,
                name: updates.name !== undefined ? updates.name : act.name,
                description: updates.description !== undefined ? updates.description : act.description,
                updatedAt: new Date()
              };

              // Auto-create version for the individual act with the language being edited
              const newVersion = createUpdateVersion(updatedAct, 'User Edit', languageToUse);
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

        // Update the initial version data with actual values
        newChapter.versions[0].data = {
          name: newChapter.name,
          description: newChapter.description,
        };

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

      updateChapter: (projectId: string, chapterId: string, updates: Partial<Omit<Chapter, 'id' | 'createdAt' | 'actId'>>, editLanguage?: string) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();
          const currentOutline = projectObjects.outline;
          if (!currentOutline) return state;

          const { createUpdateVersion, addVersionToItem } = get();
          const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
          const languageToUse = editLanguage || primaryLanguage;

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

                // Auto-create version for individual chapter with the language being edited
                const newVersion = createUpdateVersion(updatedChapter, 'User Edit', languageToUse);
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
        const storeState = get();

        if (!projectId) {
          return createEmptyStoryObjects();
        }

        const existing = storeState.storyObjectsByProject[projectId];
        if (existing) {
          return existing;
        }

        const emptyObjects = createEmptyStoryObjects();
        set((state) => ({
          storyObjectsByProject: {
            ...state.storyObjectsByProject,
            [projectId]: emptyObjects,
          },
        }));

        return emptyObjects;
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
        const projectObjects = get().storyObjectsByProject[projectId];
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

      // Helper functions for acts and chapters
      getActById: (projectId: string, actId: string) => {
        const projectObjects = get().storyObjectsByProject[projectId];
        if (!projectObjects?.outline) return null;
        
        return projectObjects.outline.acts.find(act => act.id === actId) || null;
      },

      getChapterById: (projectId: string, chapterId: string) => {
        const projectObjects = get().storyObjectsByProject[projectId];
        if (!projectObjects?.outline) return null;
        
        for (const act of projectObjects.outline.acts) {
          const chapter = act.chapters.find(ch => ch.id === chapterId);
          if (chapter) return chapter;
        }
        return null;
      },

      getActVersions: (projectId: string, actId: string) => {
        const act = get().getActById(projectId, actId);
        return act?.versions || [];
      },

      getChapterVersions: (projectId: string, chapterId: string) => {
        const chapter = get().getChapterById(projectId, chapterId);
        return chapter?.versions || [];
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

      // Language-aware data access methods
      getItemDataInLanguage: (projectId: string, category: StoryObjectCategory, itemId: string, language: string) => {
        const item = get().getItemByCategoryAndId(projectId, category, itemId);
        if (!item?.versions || !item.activeVersionId) return null;

        const activeVersion = item.versions.find((v: ObjectVersion) => v.versionId === item.activeVersionId);
        if (!activeVersion?.data) return null;

        return activeVersion.data[language] || null;
      },

      hasItemDataInLanguage: (projectId: string, category: StoryObjectCategory, itemId: string, language: string) => {
        const item = get().getItemByCategoryAndId(projectId, category, itemId);
        if (!item?.versions || !item.activeVersionId) return false;

        const activeVersion = item.versions.find((v: ObjectVersion) => v.versionId === item.activeVersionId);
        if (!activeVersion?.data) return false;

        return language in activeVersion.data;
      },

      getAvailableLanguagesForItem: (projectId: string, category: StoryObjectCategory, itemId: string) => {
        const item = get().getItemByCategoryAndId(projectId, category, itemId);
        if (!item?.versions || !item.activeVersionId) return [];

        const activeVersion = item.versions.find((v: ObjectVersion) => v.versionId === item.activeVersionId);
        if (!activeVersion?.data || typeof activeVersion.data !== 'object') return [];

        return Object.keys(activeVersion.data);
      },

      addTranslatedDataToItem: (projectId: string, category: StoryObjectCategory, itemId: string, language: string, translatedData: any) => {
        set((state) => {
          const projectObjects = state.storyObjectsByProject[projectId] || createEmptyStoryObjects();

          const updateItemTranslation = (item: any) => {
            if (!item || item.id !== itemId) return item;

            const activeVersion = item.versions.find((v: ObjectVersion) => v.versionId === item.activeVersionId);
            if (!activeVersion) return item;

            // Add translated data to active version
            const updatedVersions = item.versions.map((v: ObjectVersion) =>
              v.versionId === item.activeVersionId
                ? {
                    ...v,
                    data: {
                      ...v.data,
                      [language]: translatedData,
                    },
                  }
                : v
            );

            return {
              ...item,
              versions: updatedVersions,
              updatedAt: new Date(),
            };
          };

          let updatedProjectObjects = { ...projectObjects };

          switch (category) {
            case 'basicInfo':
              if (updatedProjectObjects.basicInfo) {
                updatedProjectObjects.basicInfo = updateItemTranslation(updatedProjectObjects.basicInfo);
              }
              break;
            case 'character':
              updatedProjectObjects.characters = updatedProjectObjects.characters.map(updateItemTranslation);
              break;
            case 'organization':
              updatedProjectObjects.organizations = updatedProjectObjects.organizations.map(updateItemTranslation);
              break;
            case 'location':
              updatedProjectObjects.locations = updatedProjectObjects.locations.map(updateItemTranslation);
              break;
            case 'lorebook':
              updatedProjectObjects.lorebook = updatedProjectObjects.lorebook.map(updateItemTranslation);
              break;
            case 'outline':
              if (updatedProjectObjects.outline) {
                updatedProjectObjects.outline = updateItemTranslation(updatedProjectObjects.outline);
              }
              break;
            case 'act':
              if (updatedProjectObjects.outline) {
                updatedProjectObjects.outline = {
                  ...updatedProjectObjects.outline,
                  acts: updatedProjectObjects.outline.acts.map(updateItemTranslation),
                };
              }
              break;
            case 'chapter':
              if (updatedProjectObjects.outline) {
                updatedProjectObjects.outline = {
                  ...updatedProjectObjects.outline,
                  acts: updatedProjectObjects.outline.acts.map((act) => ({
                    ...act,
                    chapters: act.chapters.map(updateItemTranslation),
                  })),
                };
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

      syncFlatFieldsWithLanguage: (projectId: string, category: StoryObjectCategory, itemId: string, language: string) => {
        const languageData = get().getItemDataInLanguage(projectId, category, itemId, language);
        if (!languageData) return;

        // Update the flat fields based on category
        switch (category) {
          case 'basicInfo':
            if (languageData.title !== undefined && languageData.logline !== undefined && languageData.genre !== undefined) {
              const item = get().getItemByCategoryAndId(projectId, category, itemId);
              if (item) {
                set((state) => ({
                  storyObjectsByProject: {
                    ...state.storyObjectsByProject,
                    [projectId]: {
                      ...state.storyObjectsByProject[projectId],
                      basicInfo: {
                        ...item,
                        title: languageData.title,
                        logline: languageData.logline,
                        genre: languageData.genre,
                      },
                    },
                  },
                }));
              }
            }
            break;
          case 'character':
          case 'organization':
          case 'location':
          case 'lorebook':
            if (languageData.name !== undefined && languageData.description !== undefined) {
              const item = get().getItemByCategoryAndId(projectId, category, itemId);
              if (item) {
                const categoryKey = category === 'character' ? 'characters' :
                                   category === 'organization' ? 'organizations' :
                                   category === 'location' ? 'locations' : 'lorebook';

                set((state) => ({
                  storyObjectsByProject: {
                    ...state.storyObjectsByProject,
                    [projectId]: {
                      ...state.storyObjectsByProject[projectId],
                      [categoryKey]: state.storyObjectsByProject[projectId][categoryKey].map((i: any) =>
                        i.id === itemId ? { ...i, name: languageData.name, description: languageData.description } : i
                      ),
                    },
                  },
                }));
              }
            }
            break;
        }
      },

      getPreviousVersionDataInLanguage: (projectId: string, category: StoryObjectCategory, itemId: string, language: string) => {
        const item = get().getItemByCategoryAndId(projectId, category, itemId);
        if (!item?.versions || !item.activeVersionId) return null;

        // Find all versions that have data in the target language, excluding the current active version
        const versionsWithLanguage = item.versions
          .filter((v: ObjectVersion) =>
            v.versionId !== item.activeVersionId &&
            v.data &&
            typeof v.data === 'object' &&
            language in v.data
          )
          .sort((a: ObjectVersion, b: ObjectVersion) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );

        // Return the most recent version's data in the target language
        if (versionsWithLanguage.length > 0) {
          return versionsWithLanguage[0].data[language];
        }

        return null;
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