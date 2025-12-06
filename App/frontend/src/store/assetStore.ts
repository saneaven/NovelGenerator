import { create } from 'zustand';
import { assetService } from '../api/assetService';
import type { Asset, StoryObjectAsset, ImageProvider, SceneAsset, ChapterAsset } from '../api/assetService';

interface AssetStore {
    // State
    assets: Asset[];
    storyObjectAssets: Map<string, StoryObjectAsset[]>;
    sceneAssets: SceneAsset[];
    chapterAssets: Map<string, ChapterAsset[]>;  // keyed by chapter_id
    imageProviders: ImageProvider[];
    isLoading: boolean;
    error: string | null;

    // Actions
    fetchAssets: (projectId: string) => Promise<void>;
    uploadAsset: (projectId: string, file: File, name?: string, assetType?: 'scene' | 'object') => Promise<Asset>;
    deleteAsset: (projectId: string, assetId: string) => Promise<void>;
    updateAsset: (projectId: string, assetId: string, name: string) => Promise<void>;

    // Image providers (for checking capabilities)
    fetchImageProviders: () => Promise<void>;

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

    // Scene assets
    fetchSceneAssets: (projectId: string) => Promise<void>;

    // Chapter assets
    fetchChapterAssets: (projectId: string, chapterId: string) => Promise<void>;
    linkAssetToChapter: (projectId: string, chapterId: string, assetId: string) => Promise<void>;
    unlinkAssetFromChapter: (projectId: string, chapterId: string, assetId: string) => Promise<void>;

    // Helpers
    getStoryObjectAssets: (objectType: string, objectId: string) => StoryObjectAsset[];
    getMainAsset: (objectType: string, objectId: string) => Asset | null;
    getChapterAssets: (chapterId: string) => ChapterAsset[];
    clearError: () => void;
    clearAssets: () => void;
}

const getObjectKey = (objectType: string, objectId: string) => `${objectType}:${objectId}`;

export const useAssetStore = create<AssetStore>()((set, get) => ({
    assets: [],
    storyObjectAssets: new Map(),
    sceneAssets: [],
    chapterAssets: new Map(),
    imageProviders: [],
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

    uploadAsset: async (projectId: string, file: File, name?: string, assetType?: 'scene' | 'object') => {
        set({ isLoading: true, error: null });
        try {
            const newAsset = await assetService.uploadAsset(projectId, file, name, assetType);
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

    // Scene assets
    fetchSceneAssets: async (projectId: string) => {
        set({ isLoading: true, error: null });
        try {
            const response = await assetService.listSceneAssets(projectId);
            set({ sceneAssets: response.assets, isLoading: false });
        } catch (error) {
            set({
                isLoading: false,
                error: error instanceof Error ? error.message : 'Failed to fetch scene assets',
            });
        }
    },

    // Chapter assets
    fetchChapterAssets: async (projectId: string, chapterId: string) => {
        try {
            const response = await assetService.getChapterAssets(projectId, chapterId);
            set((state) => {
                const newMap = new Map(state.chapterAssets);
                newMap.set(chapterId, response.assets);
                return { chapterAssets: newMap };
            });
        } catch (error) {
            console.error('Failed to fetch chapter assets:', error);
        }
    },

    linkAssetToChapter: async (projectId: string, chapterId: string, assetId: string) => {
        try {
            const link = await assetService.linkAssetToChapter(projectId, chapterId, assetId);
            set((state) => {
                const newMap = new Map(state.chapterAssets);
                const existing = newMap.get(chapterId) || [];
                // Avoid duplicates
                if (!existing.find(l => l.asset_id === assetId)) {
                    newMap.set(chapterId, [...existing, link]);
                }
                return { chapterAssets: newMap };
            });
        } catch (error) {
            set({
                error: error instanceof Error ? error.message : 'Failed to link asset to chapter',
            });
            throw error;
        }
    },

    unlinkAssetFromChapter: async (projectId: string, chapterId: string, assetId: string) => {
        try {
            await assetService.unlinkAssetFromChapter(projectId, chapterId, assetId);
            set((state) => {
                const newMap = new Map(state.chapterAssets);
                const existing = newMap.get(chapterId) || [];
                newMap.set(chapterId, existing.filter((item) => item.asset_id !== assetId));
                return { chapterAssets: newMap };
            });
        } catch (error) {
            set({
                error: error instanceof Error ? error.message : 'Failed to unlink asset from chapter',
            });
            throw error;
        }
    },

    getChapterAssets: (chapterId: string) => {
        return get().chapterAssets.get(chapterId) || [];
    },

    clearError: () => set({ error: null }),

    clearAssets: () => set({
        assets: [],
        storyObjectAssets: new Map(),
        sceneAssets: [],
        chapterAssets: new Map()
    }),
}));

export default useAssetStore;
