import { memo, type RefObject } from 'react';
import { IconButton } from '../IconButton';
import { Star, Edit, MoreHorizontal, Trash, Info } from '../icons';
import { API_BASE_URL } from '../../api/client';
import type { Asset, SceneAsset } from '../../api/assetService';

export type ImageContentMode = 'object' | 'scene' | 'picker';

export type DisplayAsset = {
    id: string;
    asset: Asset | SceneAsset;
    is_main?: boolean;
    usage_count?: number;
    used_in_manuscripts?: Array<{ id: string; name: string; act_name?: string | null }>;
    linkId?: string;
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
    height,
}) => {
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
