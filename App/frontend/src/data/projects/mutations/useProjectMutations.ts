/**
 * Project CRUD mutations. Each writes the `projectKeys.list()` cache directly
 * (the old store mutated its `projects` array the same way). Delete also clears
 * the current-project selection when the deleted project was open.
 */

import { useMutation } from '@tanstack/react-query';
import { projectService } from '../../../api';
import { queryClient } from '../../queryClient';
import { projectKeys } from '../../keys/projectKeys';
import { useSelectionStore, type Project } from '../../../store/selectionStore';
import { useAuthStore } from '../../../store/authStore';
import { useObjectPickerSelectionStore } from '../../../store/objectPickerSelectionStore';

function appendProjectToCache(created: Project): void {
  queryClient.setQueryData<Project[]>(projectKeys.list(), (prev) =>
    prev ? [...prev, created] : [created],
  );
}

export interface CreateProjectVars {
  name: string;
  description: string;
  mainLanguage: string;
}

export function useCreateProjectMutation() {
  return useMutation({
    mutationFn: ({ name, description, mainLanguage }: CreateProjectVars) =>
      projectService.create({ name, description, main_language: mainLanguage }),
    onSuccess: appendProjectToCache,
  });
}

export function useImportProjectMutation() {
  return useMutation({
    mutationFn: (file: File) => projectService.importProject(file),
    onSuccess: appendProjectToCache,
  });
}

export interface UpdateProjectVars {
  id: string;
  updates: { name?: string; description?: string };
}

export function useUpdateProjectMutation() {
  return useMutation({
    mutationFn: ({ id, updates }: UpdateProjectVars) => projectService.update(id, updates),
    onSuccess: (updated) => {
      queryClient.setQueryData<Project[]>(projectKeys.list(), (prev) =>
        prev?.map((p) => (p.id === updated.id ? updated : p)),
      );
    },
  });
}

export function useDeleteProjectMutation() {
  return useMutation({
    mutationFn: (id: string) => projectService.delete(id),
    onSuccess: (_res, id) => {
      queryClient.setQueryData<Project[]>(projectKeys.list(), (prev) =>
        prev?.filter((p) => p.id !== id),
      );
      const userId = useAuthStore.getState().user?.id;
      if (userId) {
        useObjectPickerSelectionStore.getState().clearProject(userId, id);
      }
      if (useSelectionStore.getState().currentProjectId === id) {
        useSelectionStore.getState().setCurrentProject(null);
      }
    },
  });
}
