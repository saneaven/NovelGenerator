/**
 * Project list as a TanStack Query. Replaces the `projectStore` server half
 * (`projects` + `fetchProjects`/`isLoading`/`error`). The current-project
 * SELECTION stays in the slim `projectStore` (client state).
 */

import { useQuery } from '@tanstack/react-query';
import { projectService } from '../../api';
import { queryClient } from '../queryClient';
import { projectKeys } from '../keys/projectKeys';
import { useSelectionStore, type Project } from '../../store/selectionStore';

const EMPTY: Project[] = [];

export const projectsQueryOptions = {
  queryKey: projectKeys.list(),
  queryFn: async (): Promise<Project[]> => {
    const projects = await projectService.list();
    return Array.isArray(projects) ? projects : [];
  },
} as const;

export function useProjectsQuery() {
  return useQuery(projectsQueryOptions);
}

/** The project list (empty array until loaded). */
export function useProjects(): Project[] {
  return useProjectsQuery().data ?? EMPTY;
}

/** A single project by id, reactively. */
export function useProject(projectId: string | null | undefined): Project | undefined {
  const projects = useProjects();
  return projectId ? projects.find((p) => p.id === projectId) : undefined;
}

/** The currently-selected project (selection from the store + list from the query). */
export function useCurrentProject(): Project | null {
  const currentProjectId = useSelectionStore((s) => s.currentProjectId);
  const projects = useProjects();
  return currentProjectId ? projects.find((p) => p.id === currentProjectId) ?? null : null;
}

/** Non-React read of the project list from cache. */
export function readProjectsFromCache(): Project[] {
  return queryClient.getQueryData<Project[]>(projectKeys.list()) ?? [];
}
