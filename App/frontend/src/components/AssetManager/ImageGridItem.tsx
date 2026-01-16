import { memo, type RefObject } from 'react';
import { IconButton } from '../IconButton';
import { Star, Edit, MoreHorizontal, Trash, Info, Close, Refresh } from '../icons';
import { API_BASE_URL } from '../../api/client';
import type { Asset, SceneAsset } from '../../api/assetService';
import type { GenerationRecipe, ImageProgressStage, ImageTaskBinding, ImageTaskStatus } from '../../imageTask';

export type ImageContentMode = 'object' | 'scene' | 'picker';

export type DisplayAsset =
    | {
        kind: 'asset';
        id: string;
        asset: Asset | SceneAsset;
        is_main?: boolean;
        usage_count?: number;
        used_in_manuscripts?: Array<{ id: string; name: string; act_name?: string | null }>;
        linkId?: string;
    }
    | {
        kind: 'placeholder';
        id: string;
        taskId: string;
        status: Exclude<ImageTaskStatus, 'idle' | 'success'>;
        stage?: ImageProgressStage;
        message: string;
        error?: string;
        binding: ImageTaskBinding;
        recipe: GenerationRecipe;
    };

export interface ImageGridItemProps {
    item: DisplayAsset;
    mode: ImageContentMode;
    isActive: boolean;
    isSelected: boolean;
    isExcluded: boolean;
    editingAssetId: string | null;
    editingName: string;
    moreDropdownAssetId: string | null;
    moreDropdownRef: RefObject<HTMLDivElement | null>;
    onItemClick: () => void;
    onSetMain: (assetId: string) => void;
    onStartRename: (asset: Asset | SceneAsset) => void;
    onEditingNameChange: (name: string) => void;
    onSaveRename: (assetId: string) => void;
    onCancelRename: () => void;
    onOpenDetail: (asset: Asset | SceneAsset) => void;
    onDeleteAsset: (asset: Asset | SceneAsset) => void;
    onToggleMoreDropdown: (assetId: string | null) => void;
    onCancelTask?: (taskId: string) => void;
    onRetryTask?: (taskId: string, recipe: GenerationRecipe) => void;
    onDismissTask?: (taskId: string) => void;
    onRegenerateAsset?: (assetId: string) => void;
    height: number;
}

export const ImageGridItem = memo<ImageGridItemProps>(({
    item,
    mode,
    isActive,
    isSelected,
    isExcluded,
    editingAssetId,
    editingName,
    moreDropdownAssetId,
    moreDropdownRef,
    onItemClick,
    onSetMain,
    onStartRename,
    onEditingNameChange,
    onSaveRename,
    onCancelRename,
    onOpenDetail,
    onDeleteAsset,
    onToggleMoreDropdown,
    onCancelTask,
    onRetryTask,
    onDismissTask,
    onRegenerateAsset,
    height,
}) => {
    if (item.kind === 'placeholder') {
        const canCancel = item.status === 'running';
        const canRetry = item.status === 'error' || item.status === 'cancelled';

        return (
            <div
                className={`asset-item placeholder placeholder--${item.status} ${isActive ? 'active' : ''}`}
                style={{ height }}
                onClick={onItemClick}
            >
                <div className="asset-thumbnail">
                    <div className="placeholder-skeleton" />
                </div>

                <div className="asset-info">
                    <span className="asset-name" title={item.message}>
                        {item.status === 'running'
                            ? item.message
                            : item.status === 'error'
                                ? (item.error ?? 'An error occurred')
                                : 'Cancelled'}
                    </span>
                </div>

                <div className="asset-actions" onClick={(e) => e.stopPropagation()}>
                    {canRetry && (
                        <IconButton
                            size="xs"
                            icon={<Refresh size="xs" />}
                            onClick={() => onRetryTask?.(item.taskId, item.recipe)}
                            title="Retry"
                            variant="primary"
                        />
                    )}
                    {canCancel && (
                        <IconButton
                            size="xs"
                            icon={<Close size="xs" />}
                            onClick={() => onCancelTask?.(item.taskId)}
                            title="Cancel"
                            variant="danger"
                        />
                    )}
                    {(item.status === 'error' || item.status === 'cancelled') && (
                        <IconButton
                            size="xs"
                            icon={<Trash size="xs" />}
                            onClick={() => onDismissTask?.(item.taskId)}
                            title="Dismiss"
                            variant="danger"
                        />
                    )}
                </div>
            </div>
        );
    }

    const canRegenerate =
        !!onRegenerateAsset
        && mode !== 'picker'
        && !!item.asset.generation_provider
        && !!item.asset.generation_model
        && (!!item.asset.generation_prompt || !!item.asset.generation_positive_prompt);

    return (
        <div
            className={`asset-item ${item.is_main ? 'main' : ''} ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${isExcluded ? 'excluded' : ''}`}
            style={{ height }}
            onClick={onItemClick}
        >
            {/* Star button - only in object mode */}
            {mode === 'object' && (
                <div className={`star-button-wrapper ${item.is_main ? 'is-main' : ''}`} onClick={(e) => e.stopPropagation()}>
                    <IconButton
                        size="xs"
                        icon={<Star size="xs" />}
                        onClick={() => !item.is_main && onSetMain(item.asset.id)}
                        title={item.is_main ? 'Main Image' : 'Set as Main'}
                        isActive={item.is_main}
                    />
                </div>
            )}

            {/* Usage badge - only in scene mode */}
            {mode === 'scene' && item.usage_count && item.usage_count > 0 && (
                <div
                    className="usage-badge"
                    title={`Used in: ${item.used_in_manuscripts?.map(m => m.name).join(', ')}`}
                >
                    {item.usage_count}
                </div>
            )}

            {/* Excluded overlay - only in picker mode */}
            {isExcluded && (
                <div className="excluded-overlay">
                    <span>Selected</span>
                </div>
            )}

            <div className="asset-thumbnail">
                <img
                    src={`${API_BASE_URL}${item.asset.thumbnail_url || item.asset.file_url}`}
                    alt={item.asset.name}
                    loading="lazy"
                />
            </div>

            <div className="asset-info">
                {editingAssetId === item.asset.id ? (
                    <input
                        className="rename-input"
                        value={editingName}
                        onChange={(e) => onEditingNameChange(e.target.value)}
                        onBlur={() => onSaveRename(item.asset.id)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') onSaveRename(item.asset.id);
                            if (e.key === 'Escape') onCancelRename();
                        }}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <>
                        <span className="asset-name" title={item.asset.name}>
                            {item.asset.name}
                        </span>
                        <button
                            className="rename-button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onStartRename(item.asset);
                            }}
                            title="Rename"
                        >
                            <Edit size="xs" />
                        </button>
                    </>
                )}
            </div>

            {/* Action buttons */}
            <div className="asset-actions" onClick={(e) => e.stopPropagation()}>
                {/* More dropdown button */}
                <div className="more-dropdown-wrapper" ref={moreDropdownAssetId === item.id ? moreDropdownRef : undefined}>
                    <IconButton
                        size="xs"
                        icon={<MoreHorizontal size="xs" />}
                        onClick={() => onToggleMoreDropdown(moreDropdownAssetId === item.id ? null : item.id)}
                        title="More"
                    />
                    {moreDropdownAssetId === item.id && (
                        <div className="more-dropdown">
                            {canRegenerate && (
                                <button
                                    className="more-dropdown-item"
                                    onClick={() => onRegenerateAsset?.(item.asset.id)}
                                >
                                    <Refresh size="xs" />
                                    <span>Regenerate</span>
                                </button>
                            )}
                            <button
                                className="more-dropdown-item"
                                onClick={() => onOpenDetail(item.asset)}
                            >
                                <Info size="xs" />
                                <span>Detail</span>
                            </button>
                            <button
                                className="more-dropdown-item danger"
                                onClick={() => onDeleteAsset(item.asset)}
                            >
                                <Trash size="xs" />
                                <span>Delete</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

ImageGridItem.displayName = 'ImageGridItem';

// Calculate item height based on aspect ratio
export function calculateItemHeight(asset: { width?: number | null; height?: number | null }, columnWidth: number): number {
    if (!asset.width || !asset.height) {
        return 180; // Default height for unknown aspect ratio
    }
    const aspectRatio = asset.width / asset.height;
    const height = Math.round(columnWidth / aspectRatio);
    // Clamp between reasonable min/max
    return Math.max(100, Math.min(height, 400));
}

function parseSize(size?: string): { width: number; height: number } | null {
    if (!size) return null;
    const match = size.trim().match(/^(\d+)\s*x\s*(\d+)$/i);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
}

function parseAspectRatio(aspectRatio?: unknown): number | null {
    if (typeof aspectRatio !== 'string') return null;
    const match = aspectRatio.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
    if (!match) return null;
    const w = Number(match[1]);
    const h = Number(match[2]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    return w / h;
}

export function calculatePlaceholderHeight(recipe: GenerationRecipe, columnWidth: number): number {
    const fromSize = parseSize(recipe.size);
    const aspect =
        (fromSize ? fromSize.width / fromSize.height : null)
        ?? parseAspectRatio(recipe.providerSettings?.aspect_ratio)
        ?? 1; // default to 1:1 if we cannot infer

    const height = Math.round(columnWidth / aspect);
    return Math.max(100, Math.min(height, 400));
}
