import { create } from 'zustand';
import { assetService } from '../api/assetService';
import type { Asset, SceneAsset, StoryObjectAsset } from '../api/assetService';

type AssetCollectionsByKey<T> = Record<string, T[]>;
type LoadedFlagsByKey = Record<string, boolean>;
type AssetStoreSetter = (partial: Partial<AssetStore> | ((state: AssetStore) => Partial<AssetStore>)) => void;

interface AssetStore {
    projectAssetsByProject: AssetCollectionsByKey<Asset>;
    projectAssetsLoadedByProject: LoadedFlagsByKey;
    storyObjectAssetsByKey: AssetCollectionsByKey<StoryObjectAsset>;
    storyObjectAssetsLoadedByKey: LoadedFlagsByKey;
    sceneAssetsByKey: AssetCollectionsByKey<SceneAsset>;
    sceneAssetsLoadedByKey: LoadedFlagsByKey;
    activeRequestCount: number;
    isLoading: boolean;
    error: string | null;

    fetchAssets: (projectId: string, force?: boolean) => Promise<void>;
    uploadAsset: (
        projectId: string,
        file: File,
        name?: string,
        assetType?: 'scene' | 'object',
        binding?: { manuscriptId?: string; objectType?: string; objectId?: string }
    ) => Promise<Asset>;
    deleteAsset: (projectId: string, assetId: string) => Promise<void>;
    updateAsset: (projectId: string, assetId: string, name: string) => Promise<void>;

    fetchStoryObjectAssets: (projectId: string, objectType: string, objectId: string, force?: boolean) => Promise<void>;
    setMainAsset: (
        projectId: string,
        objectType: string,
        objectId: string,
        assetId: string
    ) => Promise<void>;

    fetchSceneAssets: (projectId: string, manuscriptId?: string, force?: boolean) => Promise<void>;

    getProjectAssets: (projectId: string) => Asset[];
    getStoryObjectAssets: (projectId: string, objectType: string, objectId: string) => StoryObjectAsset[];
    getSceneAssets: (projectId: string, manuscriptId?: string) => SceneAsset[];
    getMainAsset: (projectId: string, objectType: string, objectId: string) => Asset | null;
    isProjectAssetsLoaded: (projectId: string) => boolean;
    isStoryObjectAssetsLoaded: (projectId: string, objectType: string, objectId: string) => boolean;
    isSceneAssetsLoaded: (projectId: string, manuscriptId?: string) => boolean;
    refreshLoadedCaches: (projectId: string) => Promise<void>;
    clearError: () => void;
    clearAssets: () => void;
}

const EMPTY_ASSETS: Asset[] = [];
const EMPTY_STORY_OBJECT_ASSETS: StoryObjectAsset[] = [];
const EMPTY_SCENE_ASSETS: SceneAsset[] = [];
const SCENE_ALL_KEY = '__all__';

const getStoryObjectKey = (projectId: string, objectType: string, objectId: string) =>
    `${projectId}:${objectType}:${objectId}`;

const parseStoryObjectKey = (key: string): { projectId: string; objectType: string; objectId: string } | null => {
    const parts = key.split(':');
    if (parts.length !== 3) return null;
    const [projectId, objectType, objectId] = parts;
    if (!projectId || !objectType || !objectId) return null;
    return { projectId, objectType, objectId };
};

const getSceneKey = (projectId: string, manuscriptId?: string | null) => `${projectId}:${manuscriptId ?? SCENE_ALL_KEY}`;

const parseSceneKey = (key: string): { projectId: string; manuscriptId?: string } | null => {
    const parts = key.split(':');
    if (parts.length !== 2) return null;
    const [projectId, manuscriptKey] = parts;
    if (!projectId || !manuscriptKey) return null;
    return {
        projectId,
        manuscriptId: manuscriptKey === SCENE_ALL_KEY ? undefined : manuscriptKey,
    };
};

function beginRequest(set: AssetStoreSetter) {
    set((state: AssetStore) => ({
        activeRequestCount: state.activeRequestCount + 1,
        isLoading: true,
        error: null,
    }));
}

function endRequest(set: AssetStoreSetter) {
    set((state: AssetStore) => {
        const nextCount = Math.max(0, state.activeRequestCount - 1);
        return {
            activeRequestCount: nextCount,
            isLoading: nextCount > 0,
        };
    });
}

function updateAssetInStoryObjectEntries(entries: StoryObjectAsset[], updatedAsset: Asset): StoryObjectAsset[] {
    let changed = false;
    const next = entries.map((entry) => {
        if (entry.asset.id !== updatedAsset.id) return entry;
        changed = true;
        return { ...entry, asset: updatedAsset };
    });
    return changed ? next : entries;
}

function updateAssetInSceneEntries(entries: SceneAsset[], updatedAsset: Asset): SceneAsset[] {
    let changed = false;
    const next = entries.map((entry) => {
        if (entry.id !== updatedAsset.id) return entry;
        changed = true;
        return {
            ...entry,
            ...updatedAsset,
            used_in_manuscripts: entry.used_in_manuscripts,
            usage_count: entry.usage_count,
        };
    });
    return changed ? next : entries;
}

function removeAssetFromStoryObjectEntries(entries: StoryObjectAsset[], assetId: string): StoryObjectAsset[] {
    if (!entries.some((entry) => entry.asset_id === assetId)) return entries;
    return entries.filter((entry) => entry.asset_id !== assetId);
}

function removeAssetFromSceneEntries(entries: SceneAsset[], assetId: string): SceneAsset[] {
    if (!entries.some((entry) => entry.id === assetId)) return entries;
    return entries.filter((entry) => entry.id !== assetId);
}

export const useAssetStore = create<AssetStore>()((set, get) => ({
    projectAssetsByProject: {},
    projectAssetsLoadedByProject: {},
    storyObjectAssetsByKey: {},
    storyObjectAssetsLoadedByKey: {},
    sceneAssetsByKey: {},
    sceneAssetsLoadedByKey: {},
    activeRequestCount: 0,
    isLoading: false,
    error: null,

    fetchAssets: async (projectId: string, force = false) => {
        if (!force && get().projectAssetsLoadedByProject[projectId]) {
            return;
        }

        beginRequest(set);
        try {
            const assets = await assetService.listAssets(projectId);
            set((state) => ({
                projectAssetsByProject: {
                    ...state.projectAssetsByProject,
                    [projectId]: assets,
                },
                projectAssetsLoadedByProject: {
                    ...state.projectAssetsLoadedByProject,
                    [projectId]: true,
                },
            }));
        } catch (error) {
            set({
                error: error instanceof Error ? error.message : 'Failed to fetch assets',
            });
        } finally {
            endRequest(set);
        }
    },

    uploadAsset: async (
        projectId: string,
        file: File,
        name?: string,
        assetType?: 'scene' | 'object',
        binding?: { manuscriptId?: string; objectType?: string; objectId?: string }
    ) => {
        beginRequest(set);
        try {
            const newAsset = await assetService.uploadAsset(projectId, file, name, assetType, binding);
            set((state) => {
                if (!state.projectAssetsLoadedByProject[projectId]) {
                    return {};
                }
                return {
                    projectAssetsByProject: {
                        ...state.projectAssetsByProject,
                        [projectId]: [newAsset, ...(state.projectAssetsByProject[projectId] ?? EMPTY_ASSETS)],
                    },
                };
            });
            return newAsset;
        } catch (error) {
            set({
                error: error instanceof Error ? error.message : 'Failed to upload asset',
            });
            throw error;
        } finally {
            endRequest(set);
        }
    },

    deleteAsset: async (projectId: string, assetId: string) => {
        beginRequest(set);
        try {
            await assetService.deleteAsset(projectId, assetId);
            set((state) => {
                const nextProjectAssetsByProject = { ...state.projectAssetsByProject };
                if (state.projectAssetsLoadedByProject[projectId]) {
                    nextProjectAssetsByProject[projectId] = (state.projectAssetsByProject[projectId] ?? EMPTY_ASSETS)
                        .filter((asset) => asset.id !== assetId);
                }

                const nextStoryObjectAssetsByKey = { ...state.storyObjectAssetsByKey };
                for (const [key, entries] of Object.entries(state.storyObjectAssetsByKey)) {
                    if (!key.startsWith(`${projectId}:`)) continue;
                    nextStoryObjectAssetsByKey[key] = removeAssetFromStoryObjectEntries(entries, assetId);
                }

                const nextSceneAssetsByKey = { ...state.sceneAssetsByKey };
                for (const [key, entries] of Object.entries(state.sceneAssetsByKey)) {
                    if (!key.startsWith(`${projectId}:`)) continue;
                    nextSceneAssetsByKey[key] = removeAssetFromSceneEntries(entries, assetId);
                }

                return {
                    projectAssetsByProject: nextProjectAssetsByProject,
                    storyObjectAssetsByKey: nextStoryObjectAssetsByKey,
                    sceneAssetsByKey: nextSceneAssetsByKey,
                };
            });
        } catch (error) {
            set({
                error: error instanceof Error ? error.message : 'Failed to delete asset',
            });
            throw error;
        } finally {
            endRequest(set);
        }
    },

    updateAsset: async (projectId: string, assetId: string, name: string) => {
        beginRequest(set);
        try {
            const updatedAsset = await assetService.updateAsset(projectId, assetId, name);
            set((state) => {
                const nextProjectAssetsByProject = { ...state.projectAssetsByProject };
                if (state.projectAssetsLoadedByProject[projectId]) {
                    nextProjectAssetsByProject[projectId] = (state.projectAssetsByProject[projectId] ?? EMPTY_ASSETS)
                        .map((asset) => (asset.id === assetId ? updatedAsset : asset));
                }

                const nextStoryObjectAssetsByKey = { ...state.storyObjectAssetsByKey };
                for (const [key, entries] of Object.entries(state.storyObjectAssetsByKey)) {
                    if (!key.startsWith(`${projectId}:`)) continue;
                    nextStoryObjectAssetsByKey[key] = updateAssetInStoryObjectEntries(entries, updatedAsset);
                }

                const nextSceneAssetsByKey = { ...state.sceneAssetsByKey };
                for (const [key, entries] of Object.entries(state.sceneAssetsByKey)) {
                    if (!key.startsWith(`${projectId}:`)) continue;
                    nextSceneAssetsByKey[key] = updateAssetInSceneEntries(entries, updatedAsset);
                }

                return {
                    projectAssetsByProject: nextProjectAssetsByProject,
                    storyObjectAssetsByKey: nextStoryObjectAssetsByKey,
                    sceneAssetsByKey: nextSceneAssetsByKey,
                };
            });
        } catch (error) {
            set({
                error: error instanceof Error ? error.message : 'Failed to update asset',
            });
            throw error;
        } finally {
            endRequest(set);
        }
    },

    fetchStoryObjectAssets: async (projectId: string, objectType: string, objectId: string, force = false) => {
        const key = getStoryObjectKey(projectId, objectType, objectId);
        if (!force && get().storyObjectAssetsLoadedByKey[key]) {
            return;
        }

        beginRequest(set);
        try {
            const response = await assetService.getStoryObjectAssets(projectId, objectType, objectId);
            set((state) => ({
                storyObjectAssetsByKey: {
                    ...state.storyObjectAssetsByKey,
                    [key]: response.assets,
                },
                storyObjectAssetsLoadedByKey: {
                    ...state.storyObjectAssetsLoadedByKey,
                    [key]: true,
                },
            }));
        } catch (error) {
            console.error('Failed to fetch story object assets:', error);
            set({
                error: error instanceof Error ? error.message : 'Failed to fetch story object assets',
            });
        } finally {
            endRequest(set);
        }
    },

    setMainAsset: async (
        projectId: string,
        objectType: string,
        objectId: string,
        assetId: string
    ) => {
        beginRequest(set);
        try {
            await assetService.setMainAsset(projectId, objectType, objectId, assetId);
            const key = getStoryObjectKey(projectId, objectType, objectId);
            set((state) => {
                const existing = state.storyObjectAssetsByKey[key] ?? EMPTY_STORY_OBJECT_ASSETS;
                if (existing.length === 0) {
                    return {};
                }
                return {
                    storyObjectAssetsByKey: {
                        ...state.storyObjectAssetsByKey,
                        [key]: existing.map((entry) => ({
                            ...entry,
                            is_main: entry.asset_id === assetId,
                        })),
                    },
                };
            });
        } catch (error) {
            set({
                error: error instanceof Error ? error.message : 'Failed to set main asset',
            });
            throw error;
        } finally {
            endRequest(set);
        }
    },

    fetchSceneAssets: async (projectId: string, manuscriptId?: string, force = false) => {
        const key = getSceneKey(projectId, manuscriptId);
        if (!force && get().sceneAssetsLoadedByKey[key]) {
            return;
        }

        beginRequest(set);
        try {
            const response = await assetService.listSceneAssets(projectId, manuscriptId);
            set((state) => ({
                sceneAssetsByKey: {
                    ...state.sceneAssetsByKey,
                    [key]: response.assets,
                },
                sceneAssetsLoadedByKey: {
                    ...state.sceneAssetsLoadedByKey,
                    [key]: true,
                },
            }));
        } catch (error) {
            set({
                error: error instanceof Error ? error.message : 'Failed to fetch scene assets',
            });
        } finally {
            endRequest(set);
        }
    },

    getProjectAssets: (projectId: string) => get().projectAssetsByProject[projectId] ?? EMPTY_ASSETS,

    getStoryObjectAssets: (projectId: string, objectType: string, objectId: string) => {
        const key = getStoryObjectKey(projectId, objectType, objectId);
        return get().storyObjectAssetsByKey[key] ?? EMPTY_STORY_OBJECT_ASSETS;
    },

    getSceneAssets: (projectId: string, manuscriptId?: string) => {
        const key = getSceneKey(projectId, manuscriptId);
        return get().sceneAssetsByKey[key] ?? EMPTY_SCENE_ASSETS;
    },

    getMainAsset: (projectId: string, objectType: string, objectId: string) => {
        const key = getStoryObjectKey(projectId, objectType, objectId);
        const assets = get().storyObjectAssetsByKey[key] ?? EMPTY_STORY_OBJECT_ASSETS;
        const mainLink = assets.find((entry) => entry.is_main);
        return mainLink?.asset ?? null;
    },

    isProjectAssetsLoaded: (projectId: string) => Boolean(get().projectAssetsLoadedByProject[projectId]),

    isStoryObjectAssetsLoaded: (projectId: string, objectType: string, objectId: string) => {
        const key = getStoryObjectKey(projectId, objectType, objectId);
        return Boolean(get().storyObjectAssetsLoadedByKey[key]);
    },

    isSceneAssetsLoaded: (projectId: string, manuscriptId?: string) => {
        const key = getSceneKey(projectId, manuscriptId);
        return Boolean(get().sceneAssetsLoadedByKey[key]);
    },

    refreshLoadedCaches: async (projectId: string) => {
        const state = get();
        const tasks: Promise<void>[] = [];

        if (state.projectAssetsLoadedByProject[projectId]) {
            tasks.push(state.fetchAssets(projectId, true));
        }

        for (const [key, loaded] of Object.entries(state.storyObjectAssetsLoadedByKey)) {
            if (!loaded) continue;
            const parsed = parseStoryObjectKey(key);
            if (!parsed || parsed.projectId !== projectId) continue;
            tasks.push(state.fetchStoryObjectAssets(projectId, parsed.objectType, parsed.objectId, true));
        }

        for (const [key, loaded] of Object.entries(state.sceneAssetsLoadedByKey)) {
            if (!loaded) continue;
            const parsed = parseSceneKey(key);
            if (!parsed || parsed.projectId !== projectId) continue;
            tasks.push(state.fetchSceneAssets(projectId, parsed.manuscriptId, true));
        }

        if (tasks.length > 0) {
            await Promise.all(tasks);
        }
    },

    clearError: () => set({ error: null }),

    clearAssets: () => set({
        projectAssetsByProject: {},
        projectAssetsLoadedByProject: {},
        storyObjectAssetsByKey: {},
        storyObjectAssetsLoadedByKey: {},
        sceneAssetsByKey: {},
        sceneAssetsLoadedByKey: {},
        activeRequestCount: 0,
        isLoading: false,
    }),
}));

export default useAssetStore;
