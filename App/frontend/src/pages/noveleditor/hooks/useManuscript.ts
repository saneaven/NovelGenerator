import { useCallback, useMemo } from 'react';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useSettings } from '../../../store/settingsStore';
import type { ManuscriptObject } from '../../../types/unifiedObject';
import type { TipTapDoc } from '../../../types/tiptap';
import { emptyDoc, normalizeDoc, docWordCount } from '../../../editor/manuscript/doc';

/**
 * Custom hook for manuscript operations in the novel editor.
 * Provides a clean interface to manuscript data stored in unifiedObjectStore.
 */
export function useManuscript(projectId: string | undefined, chapterId: string | undefined) {
  const store = useUnifiedObjectStore();
  const settings = useSettings();

  // Get the manuscript for the current chapter
  const manuscript = useMemo<ManuscriptObject | null>(() => {
    if (!chapterId) return null;
    return store.getManuscriptByChapterId(chapterId) as ManuscriptObject | null;
  }, [chapterId, store]);

  const { doc, wordCount } = useMemo(() => {
    if (!manuscript) return { doc: emptyDoc(), wordCount: 0 };
    const preferredLang = settings.mainLanguage;
    const dataForLang = manuscript.data?.[preferredLang] ?? manuscript.data?.[Object.keys(manuscript.data ?? {})[0] ?? ''];
    const nextDoc = normalizeDoc((dataForLang as any)?.content);
    const nextWordCount = typeof (dataForLang as any)?.wordCount === 'number'
      ? (dataForLang as any).wordCount
      : docWordCount(nextDoc);
    return { doc: nextDoc, wordCount: nextWordCount };
  }, [manuscript, settings.mainLanguage]);

  // Update manuscript doc
  const updateContent = useCallback(async (
    newDoc: TipTapDoc,
    options?: {
      createNewVersion?: boolean;
      userRequest?: string;
    }
  ) => {
    if (!manuscript || !projectId) return { success: false, error: 'No manuscript or project' };

    const normalized = normalizeDoc(newDoc);
    const calculatedWordCount = docWordCount(normalized);

    try {
      await store.updateObject('manuscript', manuscript.id, {
        data: {
          content: normalized,
          wordCount: calculatedWordCount,
        },
        language: settings.mainLanguage,
        rich_text_format: 'tiptap',
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
          content: emptyDoc(),
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
    doc,
    wordCount,

    // Actions
    updateContent,
    createManuscript,
    getAllManuscripts,

    // Helpers
    hasManuscript: !!manuscript,
  };
}
