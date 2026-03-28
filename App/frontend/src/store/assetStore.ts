import { create } from 'zustand';
import { assetService } from '../api/assetService';
import type { Asset, SceneAsset, ObjectAssetLink } from '../api/assetService';

type AssetCollectionsByKey<T> = Record<string, T[]>;
type LoadedFlagsByKey = Record<string, boolean>;
type AssetStoreSetter = (partial: Partial<AssetStore> | ((state: AssetStore) => Partial<AssetStore>)) => void;

interface AssetStore {
    projectAssetsByProject: AssetCollectionsByKey<Asset>;
    projectAssetsLoadedByProject: LoadedFlagsByKey;
    objectAssetsByKey: AssetCollectionsByKey<ObjectAssetLink>;
    objectAssetsLoadedByKey: LoadedFlagsByKey;
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

    fetchObjectAssetLinks: (projectId: string, objectType: string, objectId: string, force?: boolean) => Promise<void>;
    setMainAsset: (
        projectId: string,
        objectType: string,
        objectId: string,
        assetId: string
    ) => Promise<void>;

    fetchSceneAssets: (projectId: string, manuscriptId?: string, force?: boolean) => Promise<void>;

    getProjectAssets: (projectId: string) => Asset[];
    getObjectAssetLinks: (projectId: string, objectType: string, objectId: string) => ObjectAssetLink[];
    getSceneAssets: (projectId: string, manuscriptId?: string) => SceneAsset[];
    getMainAsset: (projectId: string, objectType: string, objectId: string) => Asset | null;
    isProjectAssetsLoaded: (projectId: string) => boolean;
    isObjectAssetLinksLoaded: (projectId: string, objectType: string, objectId: string) => boolean;
    isSceneAssetsLoaded: (projectId: string, manuscriptId?: string) => boolean;
    refreshLoadedCaches: (projectId: string) => Promise<void>;
    clearError: () => void;
    clearAssets: () => void;
}

const EMPTY_ASSETS: Asset[] = [];
const EMPTY_OBJECT_ASSET_LINKS: ObjectAssetLink[] = [];
const EMPTY_SCENE_ASSETS: SceneAsset[] = [];
const SCENE_ALL_KEY = '__all__';

const getObjectAssetKey = (projectId: string, objectType: string, objectId: string) =>
    `${projectId}:${objectType}:${objectId}`;

const parseObjectAssetKey = (key: string): { projectId: string; objectType: string; objectId: string } | null => {
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

function updateAssetInObjectAssetEntries(entries: ObjectAssetLink[], updatedAsset: Asset): ObjectAssetLink[] {
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
            usages: entry.usages,
            usage_count: entry.usage_count,
        };
    });
    return changed ? next : entries;
}

function removeAssetFromObjectAssetEntries(entries: ObjectAssetLink[], assetId: string): ObjectAssetLink[] {
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
    objectAssetsByKey: {},
    objectAssetsLoadedByKey: {},
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

                const nextObjectAssetLinksByKey = { ...state.objectAssetsByKey };
                for (const [key, entries] of Object.entries(state.objectAssetsByKey)) {
                    if (!key.startsWith(`${projectId}:`)) continue;
                    nextObjectAssetLinksByKey[key] = removeAssetFromObjectAssetEntries(entries, assetId);
                }

                const nextSceneAssetsByKey = { ...state.sceneAssetsByKey };
                for (const [key, entries] of Object.entries(state.sceneAssetsByKey)) {
                    if (!key.startsWith(`${projectId}:`)) continue;
                    nextSceneAssetsByKey[key] = removeAssetFromSceneEntries(entries, assetId);
                }

                return {
                    projectAssetsByProject: nextProjectAssetsByProject,
                    objectAssetsByKey: nextObjectAssetLinksByKey,
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

                const nextObjectAssetLinksByKey = { ...state.objectAssetsByKey };
                for (const [key, entries] of Object.entries(state.objectAssetsByKey)) {
                    if (!key.startsWith(`${projectId}:`)) continue;
                    nextObjectAssetLinksByKey[key] = updateAssetInObjectAssetEntries(entries, updatedAsset);
                }

                const nextSceneAssetsByKey = { ...state.sceneAssetsByKey };
                for (const [key, entries] of Object.entries(state.sceneAssetsByKey)) {
                    if (!key.startsWith(`${projectId}:`)) continue;
                    nextSceneAssetsByKey[key] = updateAssetInSceneEntries(entries, updatedAsset);
                }

                return {
                    projectAssetsByProject: nextProjectAssetsByProject,
                    objectAssetsByKey: nextObjectAssetLinksByKey,
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

    fetchObjectAssetLinks: async (projectId: string, objectType: string, objectId: string, force = false) => {
        const key = getObjectAssetKey(projectId, objectType, objectId);
        if (!force && get().objectAssetsLoadedByKey[key]) {
            return;
        }

        beginRequest(set);
        try {
            const response = await assetService.getObjectAssetLinks(projectId, objectType, objectId);
            set((state) => ({
                objectAssetsByKey: {
                    ...state.objectAssetsByKey,
                    [key]: response.assets,
                },
                objectAssetsLoadedByKey: {
                    ...state.objectAssetsLoadedByKey,
                    [key]: true,
                },
            }));
        } catch (error) {
            console.error('Failed to fetch object asset links:', error);
            set({
                error: error instanceof Error ? error.message : 'Failed to fetch object asset links',
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
            const key = getObjectAssetKey(projectId, objectType, objectId);
            set((state) => {
                const existing = state.objectAssetsByKey[key] ?? EMPTY_OBJECT_ASSET_LINKS;
                if (existing.length === 0) {
                    return {};
                }
                return {
                    objectAssetsByKey: {
                        ...state.objectAssetsByKey,
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

    getObjectAssetLinks: (projectId: string, objectType: string, objectId: string) => {
        const key = getObjectAssetKey(projectId, objectType, objectId);
        return get().objectAssetsByKey[key] ?? EMPTY_OBJECT_ASSET_LINKS;
    },

    getSceneAssets: (projectId: string, manuscriptId?: string) => {
        const key = getSceneKey(projectId, manuscriptId);
        return get().sceneAssetsByKey[key] ?? EMPTY_SCENE_ASSETS;
    },

    getMainAsset: (projectId: string, objectType: string, objectId: string) => {
        const key = getObjectAssetKey(projectId, objectType, objectId);
        const assets = get().objectAssetsByKey[key] ?? EMPTY_OBJECT_ASSET_LINKS;
        const mainLink = assets.find((entry) => entry.is_main);
        return mainLink?.asset ?? null;
    },

    isProjectAssetsLoaded: (projectId: string) => Boolean(get().projectAssetsLoadedByProject[projectId]),

    isObjectAssetLinksLoaded: (projectId: string, objectType: string, objectId: string) => {
        const key = getObjectAssetKey(projectId, objectType, objectId);
        return Boolean(get().objectAssetsLoadedByKey[key]);
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

        for (const [key, loaded] of Object.entries(state.objectAssetsLoadedByKey)) {
            if (!loaded) continue;
            const parsed = parseObjectAssetKey(key);
            if (!parsed || parsed.projectId !== projectId) continue;
            tasks.push(state.fetchObjectAssetLinks(projectId, parsed.objectType, parsed.objectId, true));
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
        objectAssetsByKey: {},
        objectAssetsLoadedByKey: {},
        sceneAssetsByKey: {},
        sceneAssetsLoadedByKey: {},
        activeRequestCount: 0,
        isLoading: false,
    }),
}));

export default useAssetStore;
