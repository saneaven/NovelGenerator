import { memo, type RefObject } from 'react';
import { IconButton } from '../IconButton';
import { Star, Edit, MoreHorizontal, Trash, Info, Close, Refresh } from '../icons';
import AuthenticatedImage from '../common/AuthenticatedImage';
import { getAssetUrl } from '../../utils/assetUrl';
import type { Asset, ImageRunStage, SceneAsset } from '../../api/assetService';
import type { ImageGenerationBinding, ImageGenerationRecipe } from '../../imageRun';

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
        runId: string;
        status: 'running' | 'error' | 'canceled';
        stage?: Exclude<ImageRunStage, null>;
        message: string;
        error?: string;
        binding: ImageGenerationBinding;
        recipe: ImageGenerationRecipe;
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
    onCancelRun?: (runId: string) => void;
    onRetryRun?: (runId: string, recipe: ImageGenerationRecipe) => void;
    onDismissRun?: (runId: string) => void;
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
    onCancelRun,
    onRetryRun,
    onDismissRun,
    onRegenerateAsset,
    height,
}) => {
    if (item.kind === 'placeholder') {
        const canCancel = item.status === 'running';
        const canRetry = item.status === 'error' || item.status === 'canceled';

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
                                : 'Canceled'}
                    </span>
                </div>

                <div className="asset-actions" onClick={(e) => e.stopPropagation()}>
                    {canRetry && (
                        <IconButton
                            size="xs"
                            icon={<Refresh size="xs" />}
                            onClick={() => onRetryRun?.(item.runId, item.recipe)}
                            title="Retry"
                            variant="primary"
                        />
                    )}
                    {canCancel && (
                        <IconButton
                            size="xs"
                            icon={<Close size="xs" />}
                            onClick={() => onCancelRun?.(item.runId)}
                            title="Cancel"
                            variant="danger"
                        />
                    )}
                    {(item.status === 'error' || item.status === 'canceled') && (
                        <IconButton
                            size="xs"
                            icon={<Trash size="xs" />}
                            onClick={() => onDismissRun?.(item.runId)}
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
                <AuthenticatedImage
                    src={getAssetUrl(item.asset) || ''}
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
