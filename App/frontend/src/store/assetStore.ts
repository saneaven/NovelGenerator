import { create } from 'zustand';
import { assetService } from '../api/assetService';
import type { Asset, StoryObjectAsset, ImageProvider, ImageGenerationRequest } from '../api/assetService';

interface AssetStore {
    // State
    assets: Asset[];
    storyObjectAssets: Map<string, StoryObjectAsset[]>;
    imageProviders: ImageProvider[];
    isLoading: boolean;
    isGenerating: boolean;
    error: string | null;

    // Actions
    fetchAssets: (projectId: string) => Promise<void>;
    uploadAsset: (projectId: string, file: File, name?: string) => Promise<Asset>;
    deleteAsset: (projectId: string, assetId: string) => Promise<void>;
    updateAsset: (projectId: string, assetId: string, name: string) => Promise<void>;

    // Image generation
    fetchImageProviders: () => Promise<void>;
    generateImage: (
        projectId: string,
        request: ImageGenerationRequest,
        apiKey: string
    ) => Promise<Asset | null>;

    // Story object assets
    fetchStoryObjectAssets: (projectId: string, objectType: string, objectId: string) => Promise<void>;
    linkAssetToObject: (
        projectId: string,
        objectType: string,
        objectId: string,
        assetId: string,
        isMain?: boolean
    ) => Promise<void>;
    setMainAsset: (
        projectId: string,
        objectType: string,
        objectId: string,
        assetId: string
    ) => Promise<void>;
    unlinkAssetFromObject: (
        projectId: string,
        objectType: string,
        objectId: string,
        linkId: string
    ) => Promise<void>;

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
    imageProviders: [],
    isLoading: false,
    isGenerating: false,
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

    uploadAsset: async (projectId: string, file: File, name?: string) => {
        set({ isLoading: true, error: null });
        try {
            const newAsset = await assetService.uploadAsset(projectId, file, name);
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

    fetchImageProviders: async () => {
        try {
            const providers = await assetService.listImageProviders();
            set({ imageProviders: providers });
        } catch (error) {
            console.error('Failed to fetch image providers:', error);
        }
    },

    generateImage: async (projectId: string, request: ImageGenerationRequest, apiKey: string) => {
        set({ isGenerating: true, error: null });
        try {
            const response = await assetService.generateImage(projectId, request, apiKey);
            if (!response.success) {
                throw new Error(response.error || 'Image generation failed');
            }

            // Fetch the new asset
            if (response.asset_id) {
                const newAsset = await assetService.getAsset(projectId, response.asset_id);
                set((state) => ({
                    assets: [newAsset, ...state.assets],
                    isGenerating: false,
                }));
                return newAsset;
            }

            set({ isGenerating: false });
            return null;
        } catch (error) {
            set({
                isGenerating: false,
                error: error instanceof Error ? error.message : 'Failed to generate image',
            });
            throw error;
        }
    },

    fetchStoryObjectAssets: async (projectId: string, objectType: string, objectId: string) => {
        try {
            const response = await assetService.getStoryObjectAssets(projectId, objectType, objectId);
            const key = getObjectKey(objectType, objectId);
            set((state) => {
                const newMap = new Map(state.storyObjectAssets);
                newMap.set(key, response.assets);
                return { storyObjectAssets: newMap };
            });
        } catch (error) {
            console.error('Failed to fetch story object assets:', error);
        }
    },

    linkAssetToObject: async (
        projectId: string,
        objectType: string,
        objectId: string,
        assetId: string,
        isMain: boolean = false
    ) => {
        try {
            const link = await assetService.linkAssetToObject(projectId, objectType, objectId, assetId, isMain);
            const key = getObjectKey(objectType, objectId);
            set((state) => {
                const newMap = new Map(state.storyObjectAssets);
                const existing = newMap.get(key) || [];

                // If setting as main, update other items
                const updated = isMain
                    ? existing.map((item) => ({ ...item, is_main: false }))
                    : existing;

                newMap.set(key, [...updated, link]);
                return { storyObjectAssets: newMap };
            });
        } catch (error) {
            set({
                error: error instanceof Error ? error.message : 'Failed to link asset',
            });
            throw error;
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

    unlinkAssetFromObject: async (
        projectId: string,
        objectType: string,
        objectId: string,
        linkId: string
    ) => {
        try {
            await assetService.unlinkAssetFromObject(projectId, objectType, objectId, linkId);
            const key = getObjectKey(objectType, objectId);
            set((state) => {
                const newMap = new Map(state.storyObjectAssets);
                const existing = newMap.get(key) || [];
                newMap.set(key, existing.filter((item) => item.id !== linkId));
                return { storyObjectAssets: newMap };
            });
        } catch (error) {
            set({
                error: error instanceof Error ? error.message : 'Failed to unlink asset',
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

    clearError: () => set({ error: null }),

    clearAssets: () => set({ assets: [], storyObjectAssets: new Map() }),
}));

export default useAssetStore;
