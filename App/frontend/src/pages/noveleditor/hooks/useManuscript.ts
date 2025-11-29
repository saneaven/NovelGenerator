import { useCallback, useMemo } from 'react';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useSettingsStore } from '../../../store/settingsStore';
import type { ManuscriptObject } from '../../../types/unifiedObject';

/**
 * Custom hook for manuscript operations in the novel editor.
 * Provides a clean interface to manuscript data stored in unifiedObjectStore.
 */
export function useManuscript(projectId: string | undefined, chapterId: string | undefined) {
  const store = useUnifiedObjectStore();
  const { settings } = useSettingsStore();

  // Get the manuscript for the current chapter
  const manuscript = useMemo<ManuscriptObject | null>(() => {
    if (!chapterId) return null;
    return store.getManuscriptByChapterId(chapterId) as ManuscriptObject | null;
  }, [chapterId, store]);

  // Get manuscript content
  const content = useMemo(() => {
    return manuscript?.data?.content || '';
  }, [manuscript]);

  // Get word count
  const wordCount = useMemo(() => {
    return manuscript?.data?.wordCount || 0;
  }, [manuscript]);

  // Update manuscript content
  const updateContent = useCallback(async (
    newContent: string,
    options?: {
      createNewVersion?: boolean;
      userRequest?: string;
    }
  ) => {
    if (!manuscript || !projectId) return { success: false, error: 'No manuscript or project' };

    const calculatedWordCount = newContent.trim().split(/\s+/).filter(Boolean).length;

    try {
      await store.updateObject('manuscript', manuscript.id, {
        data: {
          content: newContent,
          wordCount: calculatedWordCount,
        },
        language: settings.mainLanguage,
        create_new_version: options?.createNewVersion ?? false,
        user_request: options?.userRequest,
      });
      return { success: true };
    } catch (error) {
      console.error('Failed to update manuscript:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }, [manuscript, projectId, store, settings.mainLanguage]);

  // Create a new manuscript for a chapter
  const createManuscript = useCallback(async (targetChapterId: string) => {
    if (!projectId) return { success: false, error: 'No project ID' };

    try {
      await store.createObject(
        'manuscript',
        projectId,
        {
          content: '',
          wordCount: 0,
        },
        settings.mainLanguage,
        { chapter_id: targetChapterId }
      );
      return { success: true };
    } catch (error) {
      console.error('Failed to create manuscript:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }, [projectId, store, settings.mainLanguage]);

  // Get all manuscripts for the project
  const getAllManuscripts = useCallback(() => {
    if (!projectId) return {};

    const allContent: Record<string, ManuscriptObject> = {};
    Object.values(store.objects).forEach(obj => {
      if (obj.type === 'manuscript' && obj.metadata?.project_id === projectId) {
        const objChapterId = obj.metadata?.chapter_id as string;
        if (objChapterId) {
          allContent[objChapterId] = obj as ManuscriptObject;
        }
      }
    });
    return allContent;
  }, [projectId, store.objects]);

  return {
    // Data
    manuscript,
    content,
    wordCount,

    // Actions
    updateContent,
    createManuscript,
    getAllManuscripts,

    // Helpers
    hasManuscript: !!manuscript,
  };
}
