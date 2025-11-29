import { useRef, useEffect, useCallback } from 'react';
import { useNovelEditorStore } from '../../../store/novelEditorStore';

interface UseAutoSaveOptions {
  content: string;
  onSave: (content: string) => Promise<{ success: boolean }>;
  debounceMs?: number;
  enabled?: boolean;
}

/**
 * Custom hook for auto-saving content with debouncing.
 * Tracks saving state in the novelEditorStore.
 */
export function useAutoSave(
  projectId: string | undefined,
  options: UseAutoSaveOptions
) {
  const { content, onSave, debounceMs = 1500, enabled = true } = options;

  const store = useNovelEditorStore();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedContentRef = useRef<string>(content);
  const isInitializedRef = useRef(false);

  // Initialize last saved content
  useEffect(() => {
    if (!isInitializedRef.current) {
      lastSavedContentRef.current = content;
      isInitializedRef.current = true;
    }
  }, [content]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Auto-save with debounce
  useEffect(() => {
    if (!enabled || !projectId) return;

    // Skip if content hasn't changed from last saved
    if (content === lastSavedContentRef.current) return;

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new timeout
    timeoutRef.current = setTimeout(async () => {
      store.setIsSaving(projectId, true);

      try {
        const result = await onSave(content);
        if (result.success) {
          lastSavedContentRef.current = content;
        }
      } catch (error) {
        console.error('Auto-save failed:', error);
      } finally {
        store.setIsSaving(projectId, false);
      }
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [content, enabled, projectId, debounceMs, onSave, store]);

  // Manual save function
  const saveNow = useCallback(async () => {
    if (!projectId) return { success: false };

    // Clear pending auto-save
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    store.setIsSaving(projectId, true);

    try {
      const result = await onSave(content);
      if (result.success) {
        lastSavedContentRef.current = content;
      }
      return result;
    } catch (error) {
      console.error('Manual save failed:', error);
      return { success: false };
    } finally {
      store.setIsSaving(projectId, false);
    }
  }, [projectId, content, onSave, store]);

  // Check if there are unsaved changes
  const hasUnsavedChanges = content !== lastSavedContentRef.current;

  // Get saving state from store
  const isSaving = projectId ? store.getIsSaving(projectId) : false;

  return {
    saveNow,
    isSaving,
    hasUnsavedChanges,
  };
}
