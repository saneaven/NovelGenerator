import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ChapterContent {
  chapterId: string;
  content: string;
  wordCount: number;
  createdAt: Date;
  updatedAt: Date;
  versions: ChapterVersion[];
  activeVersionId: string;
}

export interface ChapterVersion {
  versionId: string;
  timestamp: Date;
  userRequest: string;
  content: string;
  wordCount: number;
  isActive: boolean;
}

interface NovelStore {
  // Data storage by project
  chapterContentsByProject: Record<string, Record<string, ChapterContent>>; // projectId -> chapterId -> content
  selectedChapterByProject: Record<string, string | undefined>; // projectId -> chapterId

  // Private helper methods
  _ensureProject: (projectId: string) => void;

  // Chapter content management
  getChapterContent: (projectId: string, chapterId: string) => ChapterContent | null;
  updateChapterContent: (projectId: string, chapterId: string, content: string, userRequest?: string) => void;
  createChapterContent: (projectId: string, chapterId: string, initialContent?: string) => ChapterContent;
  deleteChapterContent: (projectId: string, chapterId: string) => void;
  getAllChapterContents: (projectId: string) => Record<string, ChapterContent>;

  // Selected chapter management
  selectChapter: (projectId: string, chapterId: string) => void;
  getSelectedChapterId: (projectId: string) => string | undefined;
  getSelectedChapterContent: (projectId: string) => ChapterContent | null;

  // Version management
  addVersion: (projectId: string, chapterId: string, userRequest: string, content: string) => string;
  setActiveVersion: (projectId: string, chapterId: string, versionId: string) => void;
  getVersions: (projectId: string, chapterId: string) => ChapterVersion[];
  deleteVersion: (projectId: string, chapterId: string, versionId: string) => void;

  // Utility functions
  clearProject: (projectId: string) => void;
  getWordCount: (content: string) => number;
}

// Helper function to count words
const countWords = (content: string): number => {
  if (!content || typeof content !== 'string') return 0;
  return content.trim().split(/\s+/).filter(word => word.length > 0).length;
};

// Helper function to create initial chapter content
const createInitialChapterContent = (chapterId: string, initialContent: string = ''): ChapterContent => {
  const now = new Date();
  const versionId = crypto.randomUUID();
  const wordCount = countWords(initialContent);

  return {
    chapterId,
    content: initialContent,
    wordCount,
    createdAt: now,
    updatedAt: now,
    versions: [{
      versionId,
      timestamp: now,
      userRequest: 'Initial creation',
      content: initialContent,
      wordCount,
      isActive: true,
    }],
    activeVersionId: versionId,
  };
};

export const useNovelStore = create<NovelStore>()(
  persist(
    (set, get) => ({
      chapterContentsByProject: {},
      selectedChapterByProject: {},

      // Helper function to ensure project exists
      _ensureProject: (projectId: string) => {
        const state = get();
        if (!state.chapterContentsByProject[projectId]) {
          set(state => ({
            chapterContentsByProject: {
              ...state.chapterContentsByProject,
              [projectId]: {},
            },
          }));
        }
      },

      // Chapter content management
      getChapterContent: (projectId: string, chapterId: string) => {
        const state = get();
        return state.chapterContentsByProject[projectId]?.[chapterId] || null;
      },

      updateChapterContent: (projectId: string, chapterId: string, content: string, userRequest = 'Content update') => {
        console.log('NovelStore: updateChapterContent called', { projectId, chapterId, userRequest, contentLength: content.length });

        const state = get();
        state._ensureProject(projectId);

        const existingContent = state.getChapterContent(projectId, chapterId);
        if (!existingContent) {
          // Create new if doesn't exist
          state.createChapterContent(projectId, chapterId, content);
          return;
        }

        const now = new Date();
        const wordCount = countWords(content);
        const versionId = crypto.randomUUID();

        // Create new version
        const newVersion: ChapterVersion = {
          versionId,
          timestamp: now,
          userRequest,
          content,
          wordCount,
          isActive: true,
        };

        // Update versions (mark previous as inactive)
        const updatedVersions = existingContent.versions.map(v => ({
          ...v,
          isActive: false,
        }));
        updatedVersions.push(newVersion);

        const updatedContent: ChapterContent = {
          ...existingContent,
          content,
          wordCount,
          updatedAt: now,
          versions: updatedVersions,
          activeVersionId: versionId,
        };

        set(state => ({
          chapterContentsByProject: {
            ...state.chapterContentsByProject,
            [projectId]: {
              ...state.chapterContentsByProject[projectId],
              [chapterId]: updatedContent,
            },
          },
        }));
      },

      createChapterContent: (projectId: string, chapterId: string, initialContent = '') => {
        const state = get();
        state._ensureProject(projectId);

        const chapterContent = createInitialChapterContent(chapterId, initialContent);

        set(state => ({
          chapterContentsByProject: {
            ...state.chapterContentsByProject,
            [projectId]: {
              ...state.chapterContentsByProject[projectId],
              [chapterId]: chapterContent,
            },
          },
        }));

        return chapterContent;
      },

      deleteChapterContent: (projectId: string, chapterId: string) => {
        set(state => {
          const projectChapters = { ...state.chapterContentsByProject[projectId] };
          delete projectChapters[chapterId];

          // Clear selected chapter if it was the deleted one
          const selectedChapterId = state.selectedChapterByProject[projectId];
          const updatedSelection = selectedChapterId === chapterId
            ? { [projectId]: undefined }
            : {};

          return {
            chapterContentsByProject: {
              ...state.chapterContentsByProject,
              [projectId]: projectChapters,
            },
            selectedChapterByProject: {
              ...state.selectedChapterByProject,
              ...updatedSelection,
            },
          };
        });
      },

      getAllChapterContents: (projectId: string) => {
        const state = get();
        return state.chapterContentsByProject[projectId] || {};
      },

      // Selected chapter management
      selectChapter: (projectId: string, chapterId: string) => {
        set(state => ({
          selectedChapterByProject: {
            ...state.selectedChapterByProject,
            [projectId]: chapterId,
          },
        }));
      },

      getSelectedChapterId: (projectId: string) => {
        const state = get();
        return state.selectedChapterByProject[projectId];
      },

      getSelectedChapterContent: (projectId: string) => {
        const state = get();
        const selectedChapterId = state.getSelectedChapterId(projectId);
        if (!selectedChapterId) return null;
        return state.getChapterContent(projectId, selectedChapterId);
      },

      // Version management
      addVersion: (projectId: string, chapterId: string, userRequest: string, content: string) => {
        const state = get();
        const chapterContent = state.getChapterContent(projectId, chapterId);
        if (!chapterContent) return '';

        const versionId = crypto.randomUUID();
        const now = new Date();
        const wordCount = countWords(content);

        const newVersion: ChapterVersion = {
          versionId,
          timestamp: now,
          userRequest,
          content,
          wordCount,
          isActive: true,
        };

        // Mark all existing versions as inactive
        const updatedVersions = chapterContent.versions.map(v => ({
          ...v,
          isActive: false,
        }));
        updatedVersions.push(newVersion);

        const updatedContent: ChapterContent = {
          ...chapterContent,
          content,
          wordCount,
          updatedAt: now,
          versions: updatedVersions,
          activeVersionId: versionId,
        };

        set(state => ({
          chapterContentsByProject: {
            ...state.chapterContentsByProject,
            [projectId]: {
              ...state.chapterContentsByProject[projectId],
              [chapterId]: updatedContent,
            },
          },
        }));

        return versionId;
      },

      setActiveVersion: (projectId: string, chapterId: string, versionId: string) => {
        const state = get();
        const chapterContent = state.getChapterContent(projectId, chapterId);
        if (!chapterContent) return;

        const targetVersion = chapterContent.versions.find(v => v.versionId === versionId);
        if (!targetVersion) return;

        const updatedVersions = chapterContent.versions.map(v => ({
          ...v,
          isActive: v.versionId === versionId,
        }));

        const updatedContent: ChapterContent = {
          ...chapterContent,
          content: targetVersion.content,
          wordCount: targetVersion.wordCount,
          updatedAt: new Date(),
          versions: updatedVersions,
          activeVersionId: versionId,
        };

        set(state => ({
          chapterContentsByProject: {
            ...state.chapterContentsByProject,
            [projectId]: {
              ...state.chapterContentsByProject[projectId],
              [chapterId]: updatedContent,
            },
          },
        }));
      },

      getVersions: (projectId: string, chapterId: string) => {
        const state = get();
        const chapterContent = state.getChapterContent(projectId, chapterId);
        return chapterContent?.versions || [];
      },

      deleteVersion: (projectId: string, chapterId: string, versionId: string) => {
        const state = get();
        const chapterContent = state.getChapterContent(projectId, chapterId);
        if (!chapterContent) return;

        const filteredVersions = chapterContent.versions.filter(v => v.versionId !== versionId);
        if (filteredVersions.length === 0) return; // Can't delete all versions

        let newActiveVersionId = chapterContent.activeVersionId;
        let newContent = chapterContent.content;
        let newWordCount = chapterContent.wordCount;

        // If we deleted the active version, make the most recent remaining version active
        if (chapterContent.activeVersionId === versionId) {
          const mostRecent = filteredVersions.reduce((latest, current) =>
            new Date(current.timestamp) > new Date(latest.timestamp) ? current : latest
          );
          newActiveVersionId = mostRecent.versionId;
          newContent = mostRecent.content;
          newWordCount = mostRecent.wordCount;

          // Update the active flag
          filteredVersions.forEach(v => {
            v.isActive = v.versionId === newActiveVersionId;
          });
        }

        const updatedContent: ChapterContent = {
          ...chapterContent,
          content: newContent,
          wordCount: newWordCount,
          updatedAt: new Date(),
          versions: filteredVersions,
          activeVersionId: newActiveVersionId,
        };

        set(state => ({
          chapterContentsByProject: {
            ...state.chapterContentsByProject,
            [projectId]: {
              ...state.chapterContentsByProject[projectId],
              [chapterId]: updatedContent,
            },
          },
        }));
      },

      // Utility functions
      clearProject: (projectId: string) => {
        set(state => ({
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

      getWordCount: countWords,
    }),
    {
      name: 'novel-storage',
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          try {
            const parsed = JSON.parse(str);
            // Convert date strings back to Date objects
            if (parsed.state?.chapterContentsByProject) {
              Object.keys(parsed.state.chapterContentsByProject).forEach(projectId => {
                const projectChapters = parsed.state.chapterContentsByProject[projectId];
                Object.keys(projectChapters).forEach(chapterId => {
                  const content = projectChapters[chapterId];
                  content.createdAt = new Date(content.createdAt);
                  content.updatedAt = new Date(content.updatedAt);
                  if (content.versions) {
                    content.versions = content.versions.map((v: any) => ({
                      ...v,
                      timestamp: new Date(v.timestamp),
                    }));
                  }
                });
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