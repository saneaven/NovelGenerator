import { create } from 'zustand';
import { storyObjectService } from '../api';
import type {
  BasicInfoResponse,
  NameDescriptionResponse,
  OutlineResponse,
  ActResponse,
  ChapterResponse,
} from '../api/types';
import { useSettingsStore } from './settingsStore';

// Simplified types that match backend responses
export interface BasicInfo {
  id: string;
  project_id: string;
  title: string;
  logline: string;
  genre: string;
  active_version_id?: string;
  created_at: string;
  updated_at: string;
}

export interface NameDescriptionItem {
  id: string;
  project_id: string;
  name: string;
  description: string;
  active_version_id?: string;
  created_at: string;
  updated_at: string;
}

export type Character = NameDescriptionItem;
export type Organization = NameDescriptionItem;
export type Location = NameDescriptionItem;
export type LorebookEntry = NameDescriptionItem;

export interface Chapter {
  id: string;
  act_id: string;
  name: string;
  description: string;
  order: number;
  active_version_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Act {
  id: string;
  outline_id: string;
  name: string;
  description: string;
  order: number;
  active_version_id?: string;
  created_at: string;
  updated_at: string;
  chapters: Chapter[];
}

export interface Outline {
  id: string;
  project_id: string;
  active_version_id?: string;
  created_at: string;
  updated_at: string;
  acts: Act[];
}

export interface StoryObjects {
  basicInfo: BasicInfo | null;
  characters: Character[];
  organizations: Organization[];
  locations: Location[];
  lorebook: LorebookEntry[];
  outline: Outline | null;
}

interface StoryObjectStore {
  // Data storage by project
  storyObjectsByProject: Record<string, StoryObjects>;
  isLoading: boolean;
  error: string | null;

  // Fetch all story objects for a project
  fetchStoryObjects: (projectId: string) => Promise<void>;

  // Basic Info Actions
  fetchBasicInfo: (projectId: string) => Promise<void>;
  createBasicInfo: (
    projectId: string,
    title: string,
    logline: string,
    genre: string
  ) => Promise<void>;
  updateBasicInfo: (
    projectId: string,
    updates: { title?: string; logline?: string; genre?: string },
    language?: string
  ) => Promise<void>;
  getBasicInfo: (projectId: string) => BasicInfo | null;

  // Character Actions
  fetchCharacters: (projectId: string) => Promise<void>;
  addCharacter: (projectId: string, name: string, description: string) => Promise<Character>;
  updateCharacter: (
    projectId: string,
    id: string,
    updates: { name?: string; description?: string }
  ) => Promise<void>;
  deleteCharacter: (projectId: string, id: string) => Promise<void>;
  getCharacters: (projectId: string) => Character[];

  // Organization Actions
  fetchOrganizations: (projectId: string) => Promise<void>;
  addOrganization: (
    projectId: string,
    name: string,
    description: string
  ) => Promise<Organization>;
  updateOrganization: (
    projectId: string,
    id: string,
    updates: { name?: string; description?: string }
  ) => Promise<void>;
  deleteOrganization: (projectId: string, id: string) => Promise<void>;
  getOrganizations: (projectId: string) => Organization[];

  // Location Actions
  fetchLocations: (projectId: string) => Promise<void>;
  addLocation: (projectId: string, name: string, description: string) => Promise<Location>;
  updateLocation: (
    projectId: string,
    id: string,
    updates: { name?: string; description?: string }
  ) => Promise<void>;
  deleteLocation: (projectId: string, id: string) => Promise<void>;
  getLocations: (projectId: string) => Location[];

  // Lorebook Actions
  fetchLorebook: (projectId: string) => Promise<void>;
  addLorebookEntry: (
    projectId: string,
    name: string,
    description: string
  ) => Promise<LorebookEntry>;
  updateLorebookEntry: (
    projectId: string,
    id: string,
    updates: { name?: string; description?: string }
  ) => Promise<void>;
  deleteLorebookEntry: (projectId: string, id: string) => Promise<void>;
  getLorebookEntries: (projectId: string) => LorebookEntry[];

  // Outline Actions
  fetchOutline: (projectId: string) => Promise<void>;
  createOutline: (projectId: string) => Promise<void>;
  getOutline: (projectId: string) => Outline | null;

  // Act Actions
  addAct: (projectId: string, name: string, description: string, order: number) => Promise<Act>;
  updateAct: (
    projectId: string,
    actId: string,
    updates: { name?: string; description?: string; order?: number }
  ) => Promise<void>;
  deleteAct: (projectId: string, actId: string) => Promise<void>;
  getActById: (projectId: string, actId: string) => Act | null;

  // Chapter Actions
  addChapter: (
    projectId: string,
    actId: string,
    name: string,
    description: string,
    order: number
  ) => Promise<Chapter>;
  updateChapter: (
    projectId: string,
    chapterId: string,
    updates: { name?: string; description?: string; order?: number }
  ) => Promise<void>;
  deleteChapter: (projectId: string, chapterId: string) => Promise<void>;
  getChapterById: (projectId: string, chapterId: string) => Chapter | null;

  // Utility Actions
  getStoryObjects: (projectId: string) => StoryObjects;
  clearStoryObjects: (projectId: string) => void;
  clearError: () => void;

  // Translation support (stub methods for now)
  getItemDataInLanguage: (projectId: string, category: string, itemId: string, language: string) => any;
  hasItemDataInLanguage: (projectId: string, category: string, itemId: string, language: string) => boolean;
  getAvailableLanguagesForItem: (projectId: string, category: string, itemId: string) => string[];
  addTranslatedDataToItem: (projectId: string, category: string, itemId: string, language: string, data: any) => void;
  getPreviousVersionDataInLanguage: (projectId: string, category: string, itemId: string, language: string) => any;
  syncFlatFieldsWithLanguage: (projectId: string, category: string, itemId: string, language: string) => void;
}

const createEmptyStoryObjects = (): StoryObjects => ({
  basicInfo: null,
  characters: [],
  organizations: [],
  locations: [],
  lorebook: [],
  outline: null,
});

// Helper to convert backend response to frontend type
const convertBasicInfo = (response: BasicInfoResponse): BasicInfo => response as BasicInfo;
const convertNameDescription = (response: NameDescriptionResponse): NameDescriptionItem =>
  response as NameDescriptionItem;
const convertChapter = (response: ChapterResponse): Chapter => response as Chapter;
const convertAct = (response: ActResponse): Act => ({
  ...response,
  chapters: response.chapters || [],
});
const convertOutline = (response: OutlineResponse): Outline => ({
  ...response,
  acts: response.acts?.map(convertAct) || [],
});

export const useStoryObjectStore = create<StoryObjectStore>()((set, get) => ({
  storyObjectsByProject: {},
  isLoading: false,
  error: null,

  // Fetch all story objects for a project
  fetchStoryObjects: async (projectId: string) => {
    set({ isLoading: true, error: null });
    try {
      // Fetch all story objects in parallel
      // Note: 404 errors for outline and basicInfo are expected and handled silently
      await Promise.all([
        get().fetchBasicInfo(projectId),
        get().fetchCharacters(projectId),
        get().fetchOrganizations(projectId),
        get().fetchLocations(projectId),
        get().fetchLorebook(projectId),
        get().fetchOutline(projectId),
      ]);
      set({ isLoading: false });
    } catch (error) {
      // Only set error for non-404 errors (404s are handled in individual fetch methods)
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch story objects',
      });
    }
  },

  // Basic Info Actions
  fetchBasicInfo: async (projectId: string) => {
    try {
      const response = await storyObjectService.basicInfo.get(projectId);
      const basicInfo = convertBasicInfo(response);

      set((state) => ({
        storyObjectsByProject: {
          ...state.storyObjectsByProject,
          [projectId]: {
            ...(state.storyObjectsByProject[projectId] || createEmptyStoryObjects()),
            basicInfo,
          },
        },
      }));
    } catch (error: any) {
      // 404 is expected if basic info doesn't exist yet
      if (error?.status !== 404) {
        throw error;
      }
    }
  },

  createBasicInfo: async (projectId: string, title: string, logline: string, genre: string) => {
    set({ isLoading: true, error: null });
    try {
      const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
      const response = await storyObjectService.basicInfo.create(projectId, {
        title,
        logline,
        genre,
        language: primaryLanguage,
      });
      const basicInfo = convertBasicInfo(response);

      set((state) => ({
        storyObjectsByProject: {
          ...state.storyObjectsByProject,
          [projectId]: {
            ...(state.storyObjectsByProject[projectId] || createEmptyStoryObjects()),
            basicInfo,
          },
        },
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to create basic info',
      });
      throw error;
    }
  },

  updateBasicInfo: async (
    projectId: string,
    updates: { title?: string; logline?: string; genre?: string },
    language?: string
  ) => {
    set({ isLoading: true, error: null });
    try {
      const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
      const response = await storyObjectService.basicInfo.update(projectId, {
        ...updates,
        language: language || primaryLanguage,
      });
      const basicInfo = convertBasicInfo(response);

      set((state) => ({
        storyObjectsByProject: {
          ...state.storyObjectsByProject,
          [projectId]: {
            ...(state.storyObjectsByProject[projectId] || createEmptyStoryObjects()),
            basicInfo,
          },
        },
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to update basic info',
      });
      throw error;
    }
  },

  getBasicInfo: (projectId: string) => {
    return get().storyObjectsByProject[projectId]?.basicInfo || null;
  },

  // Character Actions
  fetchCharacters: async (projectId: string) => {
    try {
      const response = await storyObjectService.characters.list(projectId);
      const characters = Array.isArray(response) ? response.map(convertNameDescription) : [];

      set((state) => ({
        storyObjectsByProject: {
          ...state.storyObjectsByProject,
          [projectId]: {
            ...(state.storyObjectsByProject[projectId] || createEmptyStoryObjects()),
            characters,
          },
        },
      }));
    } catch (error) {
      console.error('Failed to fetch characters:', error);
    }
  },

  addCharacter: async (projectId: string, name: string, description: string) => {
    set({ isLoading: true, error: null });
    try {
      const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
      const response = await storyObjectService.characters.create(projectId, {
        name,
        description,
        language: primaryLanguage,
      });
      const character = convertNameDescription(response);

      set((state) => ({
        storyObjectsByProject: {
          ...state.storyObjectsByProject,
          [projectId]: {
            ...(state.storyObjectsByProject[projectId] || createEmptyStoryObjects()),
            characters: [
              ...(state.storyObjectsByProject[projectId]?.characters || []),
              character,
            ],
          },
        },
        isLoading: false,
      }));

      return character;
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to add character',
      });
      throw error;
    }
  },

  updateCharacter: async (
    projectId: string,
    id: string,
    updates: { name?: string; description?: string }
  ) => {
    set({ isLoading: true, error: null });
    try {
      const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
      const response = await storyObjectService.characters.update(projectId, id, {
        ...updates,
        language: primaryLanguage,
      });
      const character = convertNameDescription(response);

      set((state) => ({
        storyObjectsByProject: {
          ...state.storyObjectsByProject,
          [projectId]: {
            ...(state.storyObjectsByProject[projectId] || createEmptyStoryObjects()),
            characters:
              state.storyObjectsByProject[projectId]?.characters.map((c) =>
                c.id === id ? character : c
              ) || [],
          },
        },
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to update character',
      });
      throw error;
    }
  },

  deleteCharacter: async (projectId: string, id: string) => {
    set({ isLoading: true, error: null });
    try {
      await storyObjectService.characters.delete(projectId, id);

      set((state) => ({
        storyObjectsByProject: {
          ...state.storyObjectsByProject,
          [projectId]: {
            ...(state.storyObjectsByProject[projectId] || createEmptyStoryObjects()),
            characters:
              state.storyObjectsByProject[projectId]?.characters.filter((c) => c.id !== id) ||
              [],
          },
        },
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to delete character',
      });
      throw error;
    }
  },

  getCharacters: (projectId: string) => {
    return get().storyObjectsByProject[projectId]?.characters || [];
  },

  // Organization Actions
  fetchOrganizations: async (projectId: string) => {
    try {
      const response = await storyObjectService.organizations.list(projectId);
      const organizations = Array.isArray(response) ? response.map(convertNameDescription) : [];

      set((state) => ({
        storyObjectsByProject: {
          ...state.storyObjectsByProject,
          [projectId]: {
            ...(state.storyObjectsByProject[projectId] || createEmptyStoryObjects()),
            organizations,
          },
        },
      }));
    } catch (error) {
      console.error('Failed to fetch organizations:', error);
    }
  },

  addOrganization: async (projectId: string, name: string, description: string) => {
    set({ isLoading: true, error: null });
    try {
      const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
      const response = await storyObjectService.organizations.create(projectId, {
        name,
        description,
        language: primaryLanguage,
      });
      const organization = convertNameDescription(response);

      set((state) => ({
        storyObjectsByProject: {
          ...state.storyObjectsByProject,
          [projectId]: {
            ...(state.storyObjectsByProject[projectId] || createEmptyStoryObjects()),
            organizations: [
              ...(state.storyObjectsByProject[projectId]?.organizations || []),
              organization,
            ],
          },
        },
        isLoading: false,
      }));

      return organization;
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to add organization',
      });
      throw error;
    }
  },

  updateOrganization: async (
    projectId: string,
    id: string,
    updates: { name?: string; description?: string }
  ) => {
    set({ isLoading: true, error: null });
    try {
      const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
      // Note: Backend doesn't have update for organizations yet, would need to add
      // For now, throw error
      throw new Error('Update organization not implemented in backend');
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to update organization',
      });
      throw error;
    }
  },

  deleteOrganization: async (projectId: string, id: string) => {
    set({ isLoading: true, error: null });
    try {
      // Note: Backend doesn't have delete for organizations yet
      throw new Error('Delete organization not implemented in backend');
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to delete organization',
      });
      throw error;
    }
  },

  getOrganizations: (projectId: string) => {
    return get().storyObjectsByProject[projectId]?.organizations || [];
  },

  // Location Actions
  fetchLocations: async (projectId: string) => {
    try {
      const response = await storyObjectService.locations.list(projectId);
      const locations = Array.isArray(response) ? response.map(convertNameDescription) : [];

      set((state) => ({
        storyObjectsByProject: {
          ...state.storyObjectsByProject,
          [projectId]: {
            ...(state.storyObjectsByProject[projectId] || createEmptyStoryObjects()),
            locations,
          },
        },
      }));
    } catch (error) {
      console.error('Failed to fetch locations:', error);
    }
  },

  addLocation: async (projectId: string, name: string, description: string) => {
    set({ isLoading: true, error: null });
    try {
      const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
      const response = await storyObjectService.locations.create(projectId, {
        name,
        description,
        language: primaryLanguage,
      });
      const location = convertNameDescription(response);

      set((state) => ({
        storyObjectsByProject: {
          ...state.storyObjectsByProject,
          [projectId]: {
            ...(state.storyObjectsByProject[projectId] || createEmptyStoryObjects()),
            locations: [
              ...(state.storyObjectsByProject[projectId]?.locations || []),
              location,
            ],
          },
        },
        isLoading: false,
      }));

      return location;
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to add location',
      });
      throw error;
    }
  },

  updateLocation: async (
    projectId: string,
    id: string,
    updates: { name?: string; description?: string }
  ) => {
    set({ isLoading: true, error: null });
    try {
      // Note: Backend doesn't have update for locations yet
      throw new Error('Update location not implemented in backend');
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to update location',
      });
      throw error;
    }
  },

  deleteLocation: async (projectId: string, id: string) => {
    set({ isLoading: true, error: null });
    try {
      // Note: Backend doesn't have delete for locations yet
      throw new Error('Delete location not implemented in backend');
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to delete location',
      });
      throw error;
    }
  },

  getLocations: (projectId: string) => {
    return get().storyObjectsByProject[projectId]?.locations || [];
  },

  // Lorebook Actions
  fetchLorebook: async (projectId: string) => {
    try {
      const response = await storyObjectService.lorebook.list(projectId);
      const lorebook = Array.isArray(response) ? response.map(convertNameDescription) : [];

      set((state) => ({
        storyObjectsByProject: {
          ...state.storyObjectsByProject,
          [projectId]: {
            ...(state.storyObjectsByProject[projectId] || createEmptyStoryObjects()),
            lorebook,
          },
        },
      }));
    } catch (error) {
      console.error('Failed to fetch lorebook:', error);
    }
  },

  addLorebookEntry: async (projectId: string, name: string, description: string) => {
    set({ isLoading: true, error: null });
    try {
      const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
      const response = await storyObjectService.lorebook.create(projectId, {
        name,
        description,
        language: primaryLanguage,
      });
      const entry = convertNameDescription(response);

      set((state) => ({
        storyObjectsByProject: {
          ...state.storyObjectsByProject,
          [projectId]: {
            ...(state.storyObjectsByProject[projectId] || createEmptyStoryObjects()),
            lorebook: [...(state.storyObjectsByProject[projectId]?.lorebook || []), entry],
          },
        },
        isLoading: false,
      }));

      return entry;
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to add lorebook entry',
      });
      throw error;
    }
  },

  updateLorebookEntry: async (
    projectId: string,
    id: string,
    updates: { name?: string; description?: string }
  ) => {
    set({ isLoading: true, error: null });
    try {
      // Note: Backend doesn't have update for lorebook yet
      throw new Error('Update lorebook entry not implemented in backend');
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to update lorebook entry',
      });
      throw error;
    }
  },

  deleteLorebookEntry: async (projectId: string, id: string) => {
    set({ isLoading: true, error: null });
    try {
      // Note: Backend doesn't have delete for lorebook yet
      throw new Error('Delete lorebook entry not implemented in backend');
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to delete lorebook entry',
      });
      throw error;
    }
  },

  getLorebookEntries: (projectId: string) => {
    return get().storyObjectsByProject[projectId]?.lorebook || [];
  },

  // Outline Actions
  fetchOutline: async (projectId: string) => {
    try {
      const response = await storyObjectService.outline.get(projectId);
      const outline = convertOutline(response);

      set((state) => ({
        storyObjectsByProject: {
          ...state.storyObjectsByProject,
          [projectId]: {
            ...(state.storyObjectsByProject[projectId] || createEmptyStoryObjects()),
            outline,
          },
        },
      }));
    } catch (error: any) {
      // 404 is expected if outline doesn't exist yet
      if (error?.status !== 404) {
        console.error('Failed to fetch outline:', error);
      }
    }
  },

  createOutline: async (projectId: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await storyObjectService.outline.create(projectId);
      const outline = convertOutline(response);

      set((state) => ({
        storyObjectsByProject: {
          ...state.storyObjectsByProject,
          [projectId]: {
            ...(state.storyObjectsByProject[projectId] || createEmptyStoryObjects()),
            outline,
          },
        },
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to create outline',
      });
      throw error;
    }
  },

  getOutline: (projectId: string) => {
    return get().storyObjectsByProject[projectId]?.outline || null;
  },

  // Act Actions
  addAct: async (projectId: string, name: string, description: string, order: number) => {
    set({ isLoading: true, error: null });
    try {
      const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
      const response = await storyObjectService.acts.create(projectId, {
        name,
        description,
        order,
        language: primaryLanguage,
      });
      const act = convertAct(response);

      // Refetch outline to get updated acts
      await get().fetchOutline(projectId);

      set({ isLoading: false });
      return act;
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to add act',
      });
      throw error;
    }
  },

  updateAct: async (
    projectId: string,
    actId: string,
    updates: { name?: string; description?: string; order?: number }
  ) => {
    set({ isLoading: true, error: null });
    try {
      const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
      await storyObjectService.acts.update(projectId, actId, {
        ...updates,
        language: primaryLanguage,
      });

      // Refetch outline to get updated acts
      await get().fetchOutline(projectId);

      set({ isLoading: false });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to update act',
      });
      throw error;
    }
  },

  deleteAct: async (projectId: string, actId: string) => {
    set({ isLoading: true, error: null });
    try {
      await storyObjectService.acts.delete(projectId, actId);

      // Refetch outline to get updated acts
      await get().fetchOutline(projectId);

      set({ isLoading: false });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to delete act',
      });
      throw error;
    }
  },

  getActById: (projectId: string, actId: string) => {
    const outline = get().storyObjectsByProject[projectId]?.outline;
    return outline?.acts.find((act) => act.id === actId) || null;
  },

  // Chapter Actions
  addChapter: async (
    projectId: string,
    actId: string,
    name: string,
    description: string,
    order: number
  ) => {
    set({ isLoading: true, error: null });
    try {
      const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
      const response = await storyObjectService.chapters.create(projectId, actId, {
        name,
        description,
        order,
        language: primaryLanguage,
      });
      const chapter = convertChapter(response);

      // Refetch outline to get updated chapters
      await get().fetchOutline(projectId);

      set({ isLoading: false });
      return chapter;
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to add chapter',
      });
      throw error;
    }
  },

  updateChapter: async (
    projectId: string,
    chapterId: string,
    updates: { name?: string; description?: string; order?: number }
  ) => {
    set({ isLoading: true, error: null });
    try {
      const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
      await storyObjectService.chapters.update(projectId, chapterId, {
        ...updates,
        language: primaryLanguage,
      });

      // Refetch outline to get updated chapters
      await get().fetchOutline(projectId);

      set({ isLoading: false });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to update chapter',
      });
      throw error;
    }
  },

  deleteChapter: async (projectId: string, chapterId: string) => {
    set({ isLoading: true, error: null });
    try {
      await storyObjectService.chapters.delete(projectId, chapterId);

      // Refetch outline to get updated chapters
      await get().fetchOutline(projectId);

      set({ isLoading: false });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to delete chapter',
      });
      throw error;
    }
  },

  getChapterById: (projectId: string, chapterId: string) => {
    const outline = get().storyObjectsByProject[projectId]?.outline;
    if (!outline) return null;

    for (const act of outline.acts) {
      const chapter = act.chapters.find((ch) => ch.id === chapterId);
      if (chapter) return chapter;
    }
    return null;
  },

  // Utility Actions
  getStoryObjects: (projectId: string) => {
    return get().storyObjectsByProject[projectId] || createEmptyStoryObjects();
  },

  clearStoryObjects: (projectId: string) => {
    set((state) => ({
      storyObjectsByProject: {
        ...state.storyObjectsByProject,
        [projectId]: createEmptyStoryObjects(),
      },
    }));
  },

  clearError: () => {
    set({ error: null });
  },

  // Translation support (stub implementations - currently story objects use flat structure)
  getItemDataInLanguage: (projectId: string, category: string, itemId: string, language: string) => {
    const storyObjects = get().storyObjectsByProject[projectId];
    if (!storyObjects) return null;

    // Get the item based on category
    let item: any = null;
    if (category === 'basicInfo') {
      item = storyObjects.basicInfo;
    } else if (category === 'character') {
      item = storyObjects.characters.find((c) => c.id === itemId);
    } else if (category === 'organization') {
      item = storyObjects.organizations.find((o) => o.id === itemId);
    } else if (category === 'location') {
      item = storyObjects.locations.find((l) => l.id === itemId);
    } else if (category === 'lorebook') {
      item = storyObjects.lorebook.find((l) => l.id === itemId);
    }

    if (!item) return null;

    // Return flat structure as language data (stub)
    if (category === 'basicInfo') {
      return { title: item.title, logline: item.logline, genre: item.genre };
    } else {
      return { name: item.name, description: item.description };
    }
  },

  hasItemDataInLanguage: (projectId: string, category: string, itemId: string, language: string) => {
    const data = get().getItemDataInLanguage(projectId, category, itemId, language);
    return data !== null;
  },

  getAvailableLanguagesForItem: (projectId: string, category: string, itemId: string) => {
    const { settings } = useSettingsStore.getState();
    // For now, return primary language as the only available language
    // In future, this should query version data for actual available languages
    return [settings.primaryLanguage];
  },

  addTranslatedDataToItem: (projectId: string, category: string, itemId: string, language: string, data: any) => {
    // Stub: In current flat structure, we don't store translations separately
    // This would need full version support to work properly
    console.warn('Translation storage not yet implemented for story objects');
  },

  getPreviousVersionDataInLanguage: (projectId: string, category: string, itemId: string, language: string) => {
    // Stub: No version history in current implementation
    return null;
  },

  syncFlatFieldsWithLanguage: (projectId: string, category: string, itemId: string, language: string) => {
    // Stub: In the current flat structure, fields are already in sync
    // This would be used to sync flat fields (e.g., title, logline) with version data
    // when full multilingual version support is implemented
    // For now, this is a no-op since we store directly in flat fields
  },
}));
