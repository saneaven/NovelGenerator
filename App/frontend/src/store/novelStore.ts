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
  isActive: boolean;
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
): ChapterVersion => ({
  id: version.id,
  chapter_content_id: version.chapter_content_id,
  userRequest: version.userRequest,
  isActive: version.isActive,
  data: version.data,
  timestamp: version.timestamp,
});

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
    set({ isLoading: true, error: null });
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
    } catch (error: any) {
      // 404 is expected if content doesn't exist yet
      if (error?.status !== 404) {
        set({
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to fetch chapter content',
        });
      } else {
        set({ isLoading: false });
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
    } catch (error) {
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

    const activeVersion = chapterContent.versions.find((v) => v.isActive);
    if (!activeVersion || !activeVersion.data[language]) return null;

    return activeVersion.data[language];
  },

  hasContentInLanguage: (projectId: string, chapterId: string, language: string) => {
    const chapterContent = get().getChapterContent(projectId, chapterId);
    if (!chapterContent) return false;

    const activeVersion = chapterContent.versions.find((v) => v.isActive);
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
    return get().selectedChapterByProject[projectId];
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

    return chapterContent.versions.find((v) => v.isActive) || null;
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
