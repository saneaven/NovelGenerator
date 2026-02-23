import { create } from 'zustand';
import { presetService } from '../api/presetService';
import { useSettingsStore } from './settingsStore';
import { useVariableStore } from './variableStore';
import { useSubAgentStore } from './subAgentStore';

import type {
  PresetListItem,
  PresetCreate,
  PresetUpdate,
  PresetDuplicateRequest,
  PresetResponse,
  PresetExportData,
  PresetImportRequest,
} from '../types/presets';

interface PresetStore {
  // State
  presets: PresetListItem[];
  activePresetId: string | null;
  isLoading: boolean;
  error: string | null;
  isInitialized: boolean;

  // Actions
  loadPresets: () => Promise<void>;
  setActivePreset: (presetId: string) => Promise<void>;
  createPreset: (data: PresetCreate) => Promise<PresetResponse>;
  duplicatePreset: (presetId: string, data: PresetDuplicateRequest) => Promise<PresetResponse>;
  updatePreset: (presetId: string, data: PresetUpdate) => Promise<void>;
  deletePreset: (presetId: string) => Promise<void>;
  exportPreset: (presetId: string) => Promise<PresetExportData>;
  importPreset: (data: PresetImportRequest) => Promise<PresetResponse>;

  // Getters
  getActivePreset: () => PresetListItem | undefined;
  getPresetById: (id: string) => PresetListItem | undefined;

  // Helpers
  clearError: () => void;
  reset: () => void;
}

export const usePresetStore = create<PresetStore>()((set, get) => ({
  presets: [],
  activePresetId: null,
  isLoading: false,
  error: null,
  isInitialized: false,

  loadPresets: async () => {
    // Prevent redundant loads
    if (get().isLoading) return;

    set({ isLoading: true, error: null });
    try {
      const presets = await presetService.getAllPresets();

      // Find the active preset
      const activePreset = presets.find(p => p.is_active);

      set({
        presets,
        activePresetId: activePreset?.id || null,
        isLoading: false,
        isInitialized: true,
      });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load presets',
      });
    }
  },

  setActivePreset: async (presetId: string) => {
    const currentActiveId = get().activePresetId;

    // Skip if already active
    if (currentActiveId === presetId) return;

    set({ isLoading: true, error: null });
    try {
      // 1. Call backend to change active preset
      await presetService.setActivePreset(presetId);

      // 2. Update local state - mark old preset as inactive, new as active
      set((state) => ({
        presets: state.presets.map((p) => ({
          ...p,
          is_active: p.id === presetId,
        })),
        activePresetId: presetId,
        isLoading: false,
      }));

      // 3. Invalidate all caches (CRITICAL for preset switching!)
      useSettingsStore.getState().invalidateScenarioCache();
      useVariableStore.getState().reset();

      // 5. Reload variables for new preset
      await useVariableStore.getState().loadVariables();

      // 6. Reload sub agents for new preset
      await useSubAgentStore.getState().loadSubAgents();

    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to set active preset',
      });
      throw error;
    }
  },

  createPreset: async (data: PresetCreate) => {
    set({ isLoading: true, error: null });
    try {
      const newPreset = await presetService.createPreset(data);

      // Add to list (not active yet)
      const listItem: PresetListItem = {
        id: newPreset.id,
        name: newPreset.name,
        description: newPreset.description,
        is_active: false,
        created_at: newPreset.created_at,
        updated_at: newPreset.updated_at,
      };

      set((state) => ({
        presets: [...state.presets, listItem],
        isLoading: false,
      }));

      return newPreset;
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to create preset',
      });
      throw error;
    }
  },

  duplicatePreset: async (presetId: string, data: PresetDuplicateRequest) => {
    set({ isLoading: true, error: null });
    try {
      const duplicatedPreset = await presetService.duplicatePreset(presetId, data);

      // Add to list (not active yet)
      const listItem: PresetListItem = {
        id: duplicatedPreset.id,
        name: duplicatedPreset.name,
        description: duplicatedPreset.description,
        is_active: false,
        created_at: duplicatedPreset.created_at,
        updated_at: duplicatedPreset.updated_at,
      };

      set((state) => ({
        presets: [...state.presets, listItem],
        isLoading: false,
      }));

      return duplicatedPreset;
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to duplicate preset',
      });
      throw error;
    }
  },

  updatePreset: async (presetId: string, data: PresetUpdate) => {
    set({ isLoading: true, error: null });
    try {
      const updatedPreset = await presetService.updatePreset(presetId, data);

      set((state) => ({
        presets: state.presets.map((p) =>
          p.id === presetId
            ? {
                ...p,
                name: updatedPreset.name,
                description: updatedPreset.description,
                updated_at: updatedPreset.updated_at,
              }
            : p
        ),
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to update preset',
      });
      throw error;
    }
  },

  deletePreset: async (presetId: string) => {
    // Cannot delete active preset
    if (get().activePresetId === presetId) {
      set({ error: 'Cannot delete the active preset' });
      throw new Error('Cannot delete the active preset');
    }

    set({ isLoading: true, error: null });
    try {
      await presetService.deletePreset(presetId);

      set((state) => ({
        presets: state.presets.filter((p) => p.id !== presetId),
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to delete preset',
      });
      throw error;
    }
  },

  exportPreset: async (presetId: string) => {
    return await presetService.exportPreset(presetId);
  },

  importPreset: async (data: PresetImportRequest) => {
    set({ isLoading: true, error: null });
    try {
      const imported = await presetService.importPreset(data);

      // Add to preset list
      const listItem: PresetListItem = {
        id: imported.id,
        name: imported.name,
        description: imported.description,
        is_active: false,
        created_at: imported.created_at,
        updated_at: imported.updated_at,
      };

      set((state) => ({
        presets: [...state.presets, listItem],
        isLoading: false,
      }));

      return imported;
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to import preset',
      });
      throw error;
    }
  },

  getActivePreset: () => {
    const { presets, activePresetId } = get();
    return presets.find((p) => p.id === activePresetId);
  },

  getPresetById: (id: string) => {
    return get().presets.find((p) => p.id === id);
  },

  clearError: () => set({ error: null }),

  reset: () => set({
    presets: [],
    activePresetId: null,
    isLoading: false,
    error: null,
    isInitialized: false,
  }),
}));
