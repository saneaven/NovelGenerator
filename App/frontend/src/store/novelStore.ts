import { create } from 'zustand';
import { novelService, type ChapterContentResponse, type ChapterContentVersionResponse } from '../api';
import { useSettingsStore } from './settingsStore';

// Language-specific data for chapter content
export interface ChapterContentData {
  content: string;
  wordCount: number;
}

// Chapter content version with language support (matches backend)
export interface ChapterVersion {
  id: string;
  chapter_content_id: string;
  userRequest: string;
  is_active: boolean;  // Use snake_case to match backend
  data: Record<string, ChapterContentData>; // Language-specific content data
  timestamp: string;
}

// Chapter content with multilingual versioning (matches backend)
export interface ChapterContent {
  id: string;
  chapter_id: string;
  active_version_id?: string;
  created_at: string;
  updated_at: string;
  versions: ChapterVersion[];
}

interface NovelStore {
  // Data storage by project
  chapterContentsByProject: Record<string, Record<string, ChapterContent>>; // projectId -> chapterId -> content
  selectedChapterByProject: Record<string, string | undefined>; // projectId -> chapterId
  isLoading: boolean;
  error: string | null;

  // Core chapter management
  fetchChapterContent: (projectId: string, chapterId: string) => Promise<void>;
  getChapterContent: (projectId: string, chapterId: string) => ChapterContent | null;
  createChapterContent: (
    projectId: string,
    chapterId: string,
    initialContent?: string,
    language?: string
  ) => Promise<ChapterContent>;
  updateChapterContent: (
    projectId: string,
    chapterId: string,
    content: string,
    language?: string,
    userRequest?: string
  ) => Promise<void>;
  updateChapterContentForLanguage: (
    projectId: string,
    chapterId: string,
    content: string,
    language: string,
    userRequest?: string,
    createNewVersion?: boolean
  ) => Promise<void>;
  addTranslatedContent: (
    projectId: string,
    chapterId: string,
    versionId: string,
    content: string,
    language: string
  ) => void;
  getAllChapterContents: (projectId: string) => Record<string, ChapterContent>;

  // Language-specific content access
  getChapterContentForLanguage: (
    projectId: string,
    chapterId: string,
    language: string
  ) => ChapterContentData | null;
  hasContentInLanguage: (projectId: string, chapterId: string, language: string) => boolean;

  // Selected chapter management
  selectChapter: (projectId: string, chapterId: string) => void;
  getSelectedChapterId: (projectId: string) => string | undefined;
  getSelectedChapterContent: (projectId: string) => ChapterContent | null;

  // Version management
  getVersions: (projectId: string, chapterId: string) => ChapterVersion[];
  getActiveVersion: (projectId: string, chapterId: string) => ChapterVersion | null;
  setActiveVersion: (projectId: string, chapterId: string, versionId: string) => Promise<void>;

  // Utility functions
  clearProject: (projectId: string) => void;
  clearError: () => void;
  getWordCount: (content: string) => number;
}

// Helper function to count words
const countWords = (content: string): number => {
  if (!content || typeof content !== 'string') return 0;
  return content.trim().split(/\s+/).filter((word) => word.length > 0).length;
};

// Helper to convert backend response to frontend type
const convertChapterVersion = (
  version: ChapterContentVersionResponse
): ChapterVersion => {
  console.log('[NovelStore] Converting version:', {
    id: version.id,
    is_active: version.is_active,
    rawVersion: version
  });

  return {
    id: version.id,
    chapter_content_id: version.chapter_content_id,
    userRequest: version.userRequest,
    is_active: version.is_active,
    data: version.data,
    timestamp: version.timestamp,
  };
};

const convertChapterContent = (response: ChapterContentResponse): ChapterContent => ({
  id: response.id,
  chapter_id: response.chapter_id,
  active_version_id: response.active_version_id,
  created_at: response.created_at,
  updated_at: response.updated_at,
  versions: response.versions?.map(convertChapterVersion) || [],
});

export const useNovelStore = create<NovelStore>()((set, get) => ({
  chapterContentsByProject: {},
  selectedChapterByProject: {},
  isLoading: false,
  error: null,

  // Core chapter management
  fetchChapterContent: async (projectId: string, chapterId: string) => {
    console.log('[NovelStore] fetchChapterContent called:', { projectId, chapterId });
    set({ isLoading: true, error: null });
    try {
      const response = await novelService.getChapterContent(projectId, chapterId);
      console.log('[NovelStore] Fetch response:', response);

      const chapterContent = convertChapterContent(response);
      console.log('[NovelStore] Converted content:', {
        id: chapterContent.id,
        versionsCount: chapterContent.versions.length,
        activeVersionId: chapterContent.active_version_id,
        versions: chapterContent.versions.map(v => ({
          id: v.id,
          is_active: v.is_active,
          languages: Object.keys(v.data)
        }))
      });

      set((state) => ({
        chapterContentsByProject: {
          ...state.chapterContentsByProject,
          [projectId]: {
            ...(state.chapterContentsByProject[projectId] || {}),
            [chapterId]: chapterContent,
          },
        },
        isLoading: false,
      }));
      console.log('[NovelStore] Store updated with fetched content');
    } catch (error: any) {
      // 404 means content doesn't exist yet, create it
      if (error?.status === 404) {
        try {
          const primaryLanguage = useSettingsStore.getState().settings.primaryLanguage;
          const response = await novelService.createChapterContent(projectId, chapterId, {
            content: '',
            language: primaryLanguage,
            userRequest: 'Initial creation',
          });
          const chapterContent = convertChapterContent(response);

          set((state) => ({
            chapterContentsByProject: {
              ...state.chapterContentsByProject,
              [projectId]: {
                ...(state.chapterContentsByProject[projectId] || {}),
                [chapterId]: chapterContent,
              },
            },
            isLoading: false,
          }));
        } catch (createError: any) {
          set({
            isLoading: false,
            error: createError instanceof Error ? createError.message : 'Failed to create chapter content',
          });
        }
      } else {
        set({
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to fetch chapter content',
        });
      }
    }
  },

  getChapterContent: (projectId: string, chapterId: string) => {
    return get().chapterContentsByProject[projectId]?.[chapterId] || null;
  },

  createChapterContent: async (
    projectId: string,
    chapterId: string,
    initialContent = '',
    language?: string
  ) => {
    set({ isLoading: true, error: null });
    try {
      const primaryLanguage = language || useSettingsStore.getState().settings.primaryLanguage;
      const response = await novelService.createChapterContent(projectId, chapterId, {
        content: initialContent,
        language: primaryLanguage,
        userRequest: 'Initial creation',
      });
      const chapterContent = convertChapterContent(response);

      set((state) => ({
        chapterContentsByProject: {
          ...state.chapterContentsByProject,
          [projectId]: {
            ...(state.chapterContentsByProject[projectId] || {}),
            [chapterId]: chapterContent,
          },
        },
        isLoading: false,
      }));

      return chapterContent;
    } catch (error: any) {
      // If content already exists (400), fetch it instead
      if (error?.status === 400 && error?.message?.includes('already exists')) {
        try {
          const response = await novelService.getChapterContent(projectId, chapterId);
          const chapterContent = convertChapterContent(response);

          set((state) => ({
            chapterContentsByProject: {
              ...state.chapterContentsByProject,
              [projectId]: {
                ...(state.chapterContentsByProject[projectId] || {}),
                [chapterId]: chapterContent,
              },
            },
            isLoading: false,
          }));

          return chapterContent;
        } catch (fetchError) {
          set({
            isLoading: false,
            error: fetchError instanceof Error ? fetchError.message : 'Failed to fetch existing chapter content',
          });
          throw fetchError;
        }
      }

      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to create chapter content',
      });
      throw error;
    }
  },

  updateChapterContent: async (
    projectId: string,
    chapterId: string,
    content: string,
    language?: string,
    userRequest = 'User Edit'
  ) => {
    set({ isLoading: true, error: null });
    try {
      const primaryLanguage = language || useSettingsStore.getState().settings.primaryLanguage;
      const response = await novelService.updateChapterContent(projectId, chapterId, {
        content,
        language: primaryLanguage,
        userRequest,
      });
      const chapterContent = convertChapterContent(response);

      set((state) => ({
        chapterContentsByProject: {
          ...state.chapterContentsByProject,
          [projectId]: {
            ...(state.chapterContentsByProject[projectId] || {}),
            [chapterId]: chapterContent,
          },
        },
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to update chapter content',
      });
      throw error;
    }
  },

  updateChapterContentForLanguage: async (
    projectId: string,
    chapterId: string,
    content: string,
    language: string,
    userRequest = 'User Edit',
    createNewVersion = true
  ) => {
    console.log('[NovelStore] updateChapterContentForLanguage called:', {
      projectId,
      chapterId,
      language,
      contentLength: content.length,
      userRequest,
      createNewVersion
    });

    set({ isLoading: true, error: null });
    try {
      console.log('[NovelStore] Calling API updateChapterContent...');
      const response = await novelService.updateChapterContent(projectId, chapterId, {
        content,
        language,
        userRequest,
        create_new_version: createNewVersion,
      });
      console.log('[NovelStore] API response received:', response);

      const chapterContent = convertChapterContent(response);
      console.log('[NovelStore] Converted chapter content:', chapterContent);

      set((state) => ({
        chapterContentsByProject: {
          ...state.chapterContentsByProject,
          [projectId]: {
            ...(state.chapterContentsByProject[projectId] || {}),
            [chapterId]: chapterContent,
          },
        },
        isLoading: false,
      }));
      console.log('[NovelStore] Store updated successfully');
    } catch (error) {
      console.error('[NovelStore] Error updating chapter content:', error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to update chapter content for language',
      });
      throw error;
    }
  },

  addTranslatedContent: (
    projectId: string,
    chapterId: string,
    versionId: string,
    content: string,
    language: string
  ) => {
    set((state) => {
      const existingContent = state.chapterContentsByProject[projectId]?.[chapterId];
      if (!existingContent) return state;

      const updatedVersions = existingContent.versions.map((version) => {
        if (version.id === versionId) {
          return {
            ...version,
            data: {
              ...version.data,
              [language]: {
                content,
                wordCount: countWords(content),
              },
            },
          };
        }
        return version;
      });

      return {
        chapterContentsByProject: {
          ...state.chapterContentsByProject,
          [projectId]: {
            ...state.chapterContentsByProject[projectId],
            [chapterId]: {
              ...existingContent,
              versions: updatedVersions,
            },
          },
        },
      };
    });
  },

  getAllChapterContents: (projectId: string) => {
    return get().chapterContentsByProject[projectId] || {};
  },

  // Language-specific content access
  getChapterContentForLanguage: (
    projectId: string,
    chapterId: string,
    language: string
  ) => {
    const chapterContent = get().getChapterContent(projectId, chapterId);
    if (!chapterContent) return null;

    const activeVersion = chapterContent.versions.find((v) => v.is_active);
    if (!activeVersion || !activeVersion.data[language]) return null;

    return activeVersion.data[language];
  },

  hasContentInLanguage: (projectId: string, chapterId: string, language: string) => {
    const chapterContent = get().getChapterContent(projectId, chapterId);
    if (!chapterContent) return false;

    const activeVersion = chapterContent.versions.find((v) => v.is_active);
    return activeVersion ? language in activeVersion.data : false;
  },

  // Selected chapter management
  selectChapter: (projectId: string, chapterId: string) => {
    set((state) => ({
      selectedChapterByProject: {
        ...state.selectedChapterByProject,
        [projectId]: chapterId,
      },
    }));
    // Persist selected chapter
    localStorage.setItem(`selectedChapter_${projectId}`, chapterId);
  },

  getSelectedChapterId: (projectId: string) => {
    // Check state first
    const stateChapterId = get().selectedChapterByProject[projectId];
    if (stateChapterId) return stateChapterId;

    // Fall back to localStorage if state is empty (e.g., after refresh)
    const storedChapterId = localStorage.getItem(`selectedChapter_${projectId}`);
    if (storedChapterId) {
      // Restore to state
      set((state) => ({
        selectedChapterByProject: {
          ...state.selectedChapterByProject,
          [projectId]: storedChapterId,
        },
      }));
      return storedChapterId;
    }

    return undefined;
  },

  getSelectedChapterContent: (projectId: string) => {
    const selectedChapterId = get().getSelectedChapterId(projectId);
    if (!selectedChapterId) return null;
    return get().getChapterContent(projectId, selectedChapterId);
  },

  // Version management
  getVersions: (projectId: string, chapterId: string) => {
    const chapterContent = get().getChapterContent(projectId, chapterId);
    return chapterContent?.versions || [];
  },

  getActiveVersion: (projectId: string, chapterId: string) => {
    const chapterContent = get().getChapterContent(projectId, chapterId);
    if (!chapterContent) return null;

    return chapterContent.versions.find((v) => v.is_active) || null;
  },

  setActiveVersion: async (projectId: string, chapterId: string, versionId: string) => {
    console.log('[NovelStore] setActiveVersion called:', { projectId, chapterId, versionId });
    set({ isLoading: true, error: null });
    try {
      const response = await novelService.setActiveChapterVersion(projectId, chapterId, versionId);
      const chapterContent = convertChapterContent(response);

      set((state) => ({
        chapterContentsByProject: {
          ...state.chapterContentsByProject,
          [projectId]: {
            ...(state.chapterContentsByProject[projectId] || {}),
            [chapterId]: chapterContent,
          },
        },
        isLoading: false,
      }));
      console.log('[NovelStore] Active version set successfully');
    } catch (error) {
      console.error('[NovelStore] Error setting active version:', error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to set active version',
      });
      throw error;
    }
  },

  // Utility functions
  clearProject: (projectId: string) => {
    set((state) => ({
      chapterContentsByProject: {
        ...state.chapterContentsByProject,
        [projectId]: {},
      },
      selectedChapterByProject: {
        ...state.selectedChapterByProject,
        [projectId]: undefined,
      },
    }));
  },

  clearError: () => {
    set({ error: null });
  },

  getWordCount: countWords,
}));
