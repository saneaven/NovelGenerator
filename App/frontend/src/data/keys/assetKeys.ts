/** Query-key factory for assets + image runs. */

export const assetKeys = {
  all: ['assets'] as const,
  projectAssets: (projectId: string) => [...assetKeys.all, 'project', projectId] as const,
  objectAssetLinks: (projectId: string, objectType: string, objectId: string) =>
    [...assetKeys.all, 'objectLinks', projectId, objectType, objectId] as const,
  sceneAssets: (projectId: string, manuscriptId: string = '__all__') =>
    [...assetKeys.all, 'scene', projectId, manuscriptId] as const,
  imageRuns: (projectId: string, status?: string) =>
    [...assetKeys.all, 'imageRuns', projectId, status ?? '__all__'] as const,
};
