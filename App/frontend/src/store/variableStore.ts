import { create } from 'zustand';
import { variableService } from '../api/variableService';
import type {
  PromptVariable,
  VariableCreate,
  VariableDefinitionUpdate,
} from '../types/variables';

interface VariableStore {
  // State
  variables: PromptVariable[];
  isLoading: boolean;
  error: string | null;
  isInitialized: boolean;

  // Actions
  loadVariables: () => Promise<void>;
  createVariable: (data: VariableCreate) => Promise<PromptVariable>;
  updateValue: (id: string, value: string | number | boolean | null) => Promise<void>;
  updateDefinition: (id: string, data: VariableDefinitionUpdate) => Promise<void>;
  deleteVariable: (id: string) => Promise<void>;
  reorderVariables: (orderedIds: string[]) => Promise<void>;

  // Getters
  getVariablesForTemplate: () => Record<string, string | number | boolean | null>;
  getVariableById: (id: string) => PromptVariable | undefined;
  getVariableByName: (name: string) => PromptVariable | undefined;

  // Helpers
  clearError: () => void;
  reset: () => void;
}

export const useVariableStore = create<VariableStore>()((set, get) => ({
  variables: [],
  isLoading: false,
  error: null,
  isInitialized: false,

  loadVariables: async () => {
    // Prevent redundant loads
    if (get().isLoading) return;

    set({ isLoading: true, error: null });
    try {
      const variables = await variableService.getAllVariables();
      set({ variables, isLoading: false, isInitialized: true });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load variables',
      });
    }
  },

  createVariable: async (data: VariableCreate) => {
    set({ isLoading: true, error: null });
    try {
      const newVariable = await variableService.createVariable(data);
      set((state) => ({
        variables: [...state.variables, newVariable],
        isLoading: false,
      }));
      return newVariable;
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to create variable',
      });
      throw error;
    }
  },

  updateValue: async (id: string, value: string | number | boolean | null) => {
    // Optimistic update
    set((state) => ({
      variables: state.variables.map((v) =>
        v.id === id ? { ...v, value } : v
      ),
    }));

    try {
      const updatedVariable = await variableService.updateVariableValueById(id, value);
      set((state) => ({
        variables: state.variables.map((v) =>
          v.id === id ? updatedVariable : v
        ),
      }));
    } catch (error) {
      // Revert on error
      await get().loadVariables();
      set({
        error: error instanceof Error ? error.message : 'Failed to update variable value',
      });
      throw error;
    }
  },

  updateDefinition: async (id: string, data: VariableDefinitionUpdate) => {
    set({ isLoading: true, error: null });
    try {
      const updatedVariable = await variableService.updateVariableDefinitionById(id, data);
      set((state) => ({
        variables: state.variables.map((v) =>
          v.id === id ? updatedVariable : v
        ),
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to update variable',
      });
      throw error;
    }
  },

  deleteVariable: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await variableService.deleteVariableById(id);
      set((state) => ({
        variables: state.variables.filter((v) => v.id !== id),
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to delete variable',
      });
      throw error;
    }
  },

  reorderVariables: async (orderedIds: string[]) => {
    // Optimistic update
    const currentVariables = get().variables;
    const reorderedVariables = orderedIds
      .map((id, index) => {
        const variable = currentVariables.find((v) => v.id === id);
        return variable ? { ...variable, display_order: index } : null;
      })
      .filter((v): v is PromptVariable => v !== null);

    set({ variables: reorderedVariables });

    try {
      await variableService.reorderVariables(orderedIds);
    } catch (error) {
      // Revert on error
      set({ variables: currentVariables });
      set({
        error: error instanceof Error ? error.message : 'Failed to reorder variables',
      });
      throw error;
    }
  },

  getVariablesForTemplate: () => {
    const variables = get().variables;
    const result: Record<string, string | number | boolean | null> = {};
    for (const variable of variables) {
      result[variable.name] = variable.value;
    }
    return result;
  },

  getVariableById: (id: string) => {
    return get().variables.find((v) => v.id === id);
  },

  getVariableByName: (name: string) => {
    return get().variables.find((v) => v.name === name);
  },

  clearError: () => set({ error: null }),

  reset: () => set({
    variables: [],
    isLoading: false,
    error: null,
    isInitialized: false,
  }),
}));
