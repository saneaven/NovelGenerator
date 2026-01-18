import { create } from 'zustand';
import { assetService } from '../api/assetService';
import type { Asset, StoryObjectAsset, SceneAsset } from '../api/assetService';

interface AssetStore {
    // State
    assets: Asset[];
    storyObjectAssets: Map<string, StoryObjectAsset[]>;
    sceneAssets: SceneAsset[];
    isLoading: boolean;
    error: string | null;

    // Actions
    fetchAssets: (projectId: string) => Promise<void>;
    uploadAsset: (
        projectId: string,
        file: File,
        name?: string,
        assetType?: 'scene' | 'object',
        binding?: { manuscriptId?: string; objectType?: string; objectId?: string }
    ) => Promise<Asset>;
    deleteAsset: (projectId: string, assetId: string) => Promise<void>;
    updateAsset: (projectId: string, assetId: string, name: string) => Promise<void>;

    // Story object assets
    fetchStoryObjectAssets: (projectId: string, objectType: string, objectId: string, force?: boolean) => Promise<void>;
    setMainAsset: (
        projectId: string,
        objectType: string,
        objectId: string,
        assetId: string
    ) => Promise<void>;

    // Scene assets
    fetchSceneAssets: (projectId: string, manuscriptId?: string) => Promise<void>;

    // Helpers
    getStoryObjectAssets: (objectType: string, objectId: string) => StoryObjectAsset[];
    getMainAsset: (objectType: string, objectId: string) => Asset | null;
    clearError: () => void;
    clearAssets: () => void;
}

const getObjectKey = (objectType: string, objectId: string) => `${objectType}:${objectId}`;

export const useAssetStore = create<AssetStore>()((set, get) => ({
    assets: [],
    storyObjectAssets: new Map(),
    sceneAssets: [],
    isLoading: false,
    error: null,

    fetchAssets: async (projectId: string) => {
        set({ isLoading: true, error: null });
        try {
            const assets = await assetService.listAssets(projectId);
            set({ assets, isLoading: false });
        } catch (error) {
            set({
                isLoading: false,
                error: error instanceof Error ? error.message : 'Failed to fetch assets',
            });
        }
    },

    uploadAsset: async (
        projectId: string,
        file: File,
        name?: string,
        assetType?: 'scene' | 'object',
        binding?: { manuscriptId?: string; objectType?: string; objectId?: string }
    ) => {
        set({ isLoading: true, error: null });
        try {
            const newAsset = await assetService.uploadAsset(projectId, file, name, assetType, binding);
            set((state) => ({
                assets: [newAsset, ...state.assets],
                isLoading: false,
            }));
            return newAsset;
        } catch (error) {
            set({
                isLoading: false,
                error: error instanceof Error ? error.message : 'Failed to upload asset',
            });
            throw error;
        }
    },

    deleteAsset: async (projectId: string, assetId: string) => {
        set({ isLoading: true, error: null });
        try {
            await assetService.deleteAsset(projectId, assetId);
            set((state) => ({
                assets: state.assets.filter((a) => a.id !== assetId),
                isLoading: false,
            }));
        } catch (error) {
            set({
                isLoading: false,
                error: error instanceof Error ? error.message : 'Failed to delete asset',
            });
            throw error;
        }
    },

    updateAsset: async (projectId: string, assetId: string, name: string) => {
        set({ isLoading: true, error: null });
        try {
            const updatedAsset = await assetService.updateAsset(projectId, assetId, name);
            set((state) => ({
                assets: state.assets.map((a) => (a.id === assetId ? updatedAsset : a)),
                isLoading: false,
            }));
        } catch (error) {
            set({
                isLoading: false,
                error: error instanceof Error ? error.message : 'Failed to update asset',
            });
            throw error;
        }
    },

    fetchStoryObjectAssets: async (projectId: string, objectType: string, objectId: string, force = false) => {
        // Skip if already cached to avoid redundant network requests (unless forced)
        const key = getObjectKey(objectType, objectId);
        if (!force && get().storyObjectAssets.has(key)) {
            return;
        }

        try {
            const response = await assetService.getStoryObjectAssets(projectId, objectType, objectId);
            set((state) => {
                const newMap = new Map(state.storyObjectAssets);
                newMap.set(key, response.assets);
                return { storyObjectAssets: newMap };
            });
        } catch (error) {
            console.error('Failed to fetch story object assets:', error);
        }
    },

    setMainAsset: async (
        projectId: string,
        objectType: string,
        objectId: string,
        assetId: string
    ) => {
        try {
            await assetService.setMainAsset(projectId, objectType, objectId, assetId);
            const key = getObjectKey(objectType, objectId);
            set((state) => {
                const newMap = new Map(state.storyObjectAssets);
                const existing = newMap.get(key) || [];
                const updated = existing.map((item) => ({
                    ...item,
                    is_main: item.asset_id === assetId,
                }));
                newMap.set(key, updated);
                return { storyObjectAssets: newMap };
            });
        } catch (error) {
            set({
                error: error instanceof Error ? error.message : 'Failed to set main asset',
            });
            throw error;
        }
    },

    getStoryObjectAssets: (objectType: string, objectId: string) => {
        const key = getObjectKey(objectType, objectId);
        return get().storyObjectAssets.get(key) || [];
    },

    getMainAsset: (objectType: string, objectId: string) => {
        const key = getObjectKey(objectType, objectId);
        const assets = get().storyObjectAssets.get(key) || [];
        const mainLink = assets.find((a) => a.is_main);
        return mainLink?.asset || null;
    },

    // Scene assets
    fetchSceneAssets: async (projectId: string, manuscriptId?: string) => {
        set({ isLoading: true, error: null });
        try {
            const response = await assetService.listSceneAssets(projectId, manuscriptId);
            set({ sceneAssets: response.assets, isLoading: false });
        } catch (error) {
            set({
                isLoading: false,
                error: error instanceof Error ? error.message : 'Failed to fetch scene assets',
            });
        }
    },

    clearError: () => set({ error: null }),

    clearAssets: () => set({
        assets: [],
        storyObjectAssets: new Map(),
        sceneAssets: [],
    }),
}));

export default useAssetStore;
