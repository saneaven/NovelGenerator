import { useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

export type SubPageType = 'story-entity' | 'outline-manager' | 'novel-editor' | 'config';

const STORAGE_KEY_PREFIX = 'workspace_last_subpage_';
const DEFAULT_SUBPAGE: SubPageType = 'story-entity';
const VALID_SUBPAGES: SubPageType[] = ['story-entity', 'outline-manager', 'novel-editor', 'config'];

function isValidSubPage(value: string | undefined): value is SubPageType {
  return value !== undefined && VALID_SUBPAGES.includes(value as SubPageType);
}

function getStoredSubPage(projectId: string): SubPageType | null {
  try {
    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${projectId}`);
    if (stored && isValidSubPage(stored)) {
      return stored;
    }
  } catch {
    // localStorage not available
  }
  return null;
}

function setStoredSubPage(projectId: string, subPage: SubPageType): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${projectId}`, subPage);
  } catch {
    // localStorage not available
  }
}

export interface UseWorkspaceSubPageResult {
  currentSubPage: SubPageType;
  navigateToSubPage: (subPage: SubPageType) => void;
}

export function useWorkspaceSubPage(
  projectId: string | undefined,
  urlSubPage: string | undefined
): UseWorkspaceSubPageResult {
  const navigate = useNavigate();

  // Determine current sub-page
  const currentSubPage = useMemo((): SubPageType => {
    // 1. If URL has valid sub-page, use it
    if (isValidSubPage(urlSubPage)) {
      return urlSubPage;
    }

    // 2. Otherwise, check localStorage for last visited
    if (projectId) {
      const stored = getStoredSubPage(projectId);
      if (stored) {
        return stored;
      }
    }

    // 3. Default
    return DEFAULT_SUBPAGE;
  }, [urlSubPage, projectId]);

  // Save to localStorage when sub-page changes
  useEffect(() => {
    if (projectId && currentSubPage) {
      setStoredSubPage(projectId, currentSubPage);
    }
  }, [projectId, currentSubPage]);

  // Redirect if URL doesn't match current sub-page
  useEffect(() => {
    if (projectId && (!urlSubPage || urlSubPage !== currentSubPage)) {
      navigate(`/project/${projectId}/${currentSubPage}`, { replace: true });
    }
  }, [projectId, urlSubPage, currentSubPage, navigate]);

  // Navigation function
  const navigateToSubPage = useCallback(
    (subPage: SubPageType) => {
      if (projectId) {
        navigate(`/project/${projectId}/${subPage}`);
      }
    },
    [projectId, navigate]
  );

  return {
    currentSubPage,
    navigateToSubPage,
  };
}

export default useWorkspaceSubPage;
