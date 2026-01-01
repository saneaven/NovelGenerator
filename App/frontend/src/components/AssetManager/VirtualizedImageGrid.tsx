import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useMasonry, usePositioner, useResizeObserver, type RenderComponentProps } from 'masonic';
import { ImageGridItem, calculateItemHeight } from './ImageGridItem';
import type { DisplayAsset, ImageContentMode } from './ImageGridItem';
import type { Asset, SceneAsset } from '../../api/assetService';

type VirtualizedImageGridContextValue = {
    mode: ImageContentMode;
    activeAssetId: string | null;
    selectedAssetId: string | null;
    excludeAssetIds: string[];
    editingAssetId: string | null;
    editingName: string;
    moreDropdownAssetId: string | null;
    moreDropdownRef: RefObject<HTMLDivElement | null>;
    onItemClick: (item: DisplayAsset) => void;
    onSetActiveAssetId: (id: string | null) => void;
    onSetMain: (assetId: string) => void;
    onStartRename: (asset: Asset | SceneAsset) => void;
    onEditingNameChange: (name: string) => void;
    onSaveRename: (assetId: string) => void;
    onCancelRename: () => void;
    onOpenDetail: (asset: Asset | SceneAsset) => void;
    onDeleteAsset: (asset: Asset | SceneAsset) => void;
    onToggleMoreDropdown: (assetId: string | null) => void;
};

const VirtualizedImageGridContext = createContext<VirtualizedImageGridContextValue | null>(null);

function useVirtualizedImageGridContext() {
    const ctx = useContext(VirtualizedImageGridContext);
    if (!ctx) {
        throw new Error('VirtualizedImageGridContext is missing. Did you forget to wrap the grid with its provider?');
    }
    return ctx;
}

const MasonryCard: React.FC<RenderComponentProps<DisplayAsset>> = ({ data, width }: RenderComponentProps<DisplayAsset>) => {
    const ctx = useVirtualizedImageGridContext();
    const isActive = ctx.activeAssetId === data.id;
    const isSelected = ctx.selectedAssetId === data.id;
    const isExcluded = ctx.excludeAssetIds.includes(data.asset.id);
    const itemHeight = calculateItemHeight(data.asset, width);

    const handleItemClick = () => {
        if (isExcluded) return;
        if (ctx.mode === 'object') {
            ctx.onSetActiveAssetId(data.id);
        } else {
            ctx.onItemClick(data);
        }
    };

    return (
        <ImageGridItem
            item={data}
            mode={ctx.mode}
            isActive={isActive}
            isSelected={isSelected}
            isExcluded={isExcluded}
            editingAssetId={ctx.editingAssetId}
            editingName={ctx.editingName}
            moreDropdownAssetId={ctx.moreDropdownAssetId}
            moreDropdownRef={ctx.moreDropdownRef}
            onItemClick={handleItemClick}
            onSetMain={ctx.onSetMain}
            onStartRename={ctx.onStartRename}
            onEditingNameChange={ctx.onEditingNameChange}
            onSaveRename={ctx.onSaveRename}
            onCancelRename={ctx.onCancelRename}
            onOpenDetail={ctx.onOpenDetail}
            onDeleteAsset={ctx.onDeleteAsset}
            onToggleMoreDropdown={ctx.onToggleMoreDropdown}
            height={itemHeight}
        />
    );
};

interface VirtualizedImageGridProps {
    items: DisplayAsset[];
    mode: ImageContentMode;
    /**
     * When this key changes, the grid will reset its scroll position (and internal scrollTop state).
     * Useful when switching between different datasets (e.g., Current Chapter vs All Chapters).
     */
    scrollResetKey?: string | number;
    activeAssetId: string | null;
    selectedAssetId: string | null;
    excludeAssetIds: string[];
    editingAssetId: string | null;
    editingName: string;
    moreDropdownAssetId: string | null;
    moreDropdownRef: RefObject<HTMLDivElement | null>;
    /**
     * Ref to the scroll container element. Useful for robust "click outside grid" detection
     * without relying on class selectors.
     */
    scrollContainerRef?: React.Ref<HTMLDivElement>;
    onItemClick: (item: DisplayAsset) => void;
    onSetActiveAssetId: (id: string | null) => void;
    onSetMain: (assetId: string) => void;
    onStartRename: (asset: Asset | SceneAsset) => void;
    onEditingNameChange: (name: string) => void;
    onSaveRename: (assetId: string) => void;
    onCancelRename: () => void;
    onOpenDetail: (asset: Asset | SceneAsset) => void;
    onDeleteAsset: (asset: Asset | SceneAsset) => void;
    onToggleMoreDropdown: (assetId: string | null) => void;
}

function setRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
    if (!ref) return;
    if (typeof ref === 'function') {
        ref(value);
        return;
    }
    (ref as React.MutableRefObject<T | null>).current = value;
}

function useElementSize<T extends HTMLElement>(element: T | null) {
    const [size, setSize] = useState({ width: 0, height: 0 });

    useLayoutEffect(() => {
        if (!element) return;

        const update = () => {
            const next = { width: element.clientWidth, height: element.clientHeight };
            setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
        };

        update();

        const ro = new ResizeObserver(update);
        ro.observe(element);
        return () => ro.disconnect();
    }, [element]);

    return size;
}

function useElementScroller<T extends HTMLElement>(element: T | null, fps = 12) {
    const [scrollTop, setScrollTop] = useState(0);
    const [isScrolling, setIsScrolling] = useState(false);

    const syncScrollTop = useCallback(() => {
        if (!element) return;
        setScrollTop(element.scrollTop);
    }, [element]);

    const scrollToTop = useCallback(() => {
        if (!element) return;
        element.scrollTop = 0;
        setScrollTop(0);
        setIsScrolling(false);
    }, [element]);

    useEffect(() => {
        if (!element) return;

        let last = 0;
        const minDelta = 1000 / fps;
        let rafId: number | null = null;
        let timeoutId: number | null = null;

        const onScroll = () => {
            const now = performance.now();
            if (now - last < minDelta) return;
            last = now;

            if (rafId != null) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => setScrollTop(element.scrollTop));

            setIsScrolling(true);
            if (timeoutId != null) window.clearTimeout(timeoutId);
            timeoutId = window.setTimeout(() => setIsScrolling(false), 150);
        };

        setScrollTop(element.scrollTop);
        element.addEventListener('scroll', onScroll, { passive: true });

        return () => {
            element.removeEventListener('scroll', onScroll);
            if (rafId != null) cancelAnimationFrame(rafId);
            if (timeoutId != null) window.clearTimeout(timeoutId);
        };
    }, [fps, element]);

    return { scrollTop, isScrolling, syncScrollTop, scrollToTop };
}

export const VirtualizedImageGrid: React.FC<VirtualizedImageGridProps> = ({
    items,
    mode,
    scrollResetKey,
    activeAssetId,
    selectedAssetId,
    excludeAssetIds,
    editingAssetId,
    editingName,
    moreDropdownAssetId,
    moreDropdownRef,
    scrollContainerRef,
    onItemClick,
    onSetActiveAssetId,
    onSetMain,
    onStartRename,
    onEditingNameChange,
    onSaveRename,
    onCancelRename,
    onOpenDetail,
    onDeleteAsset,
    onToggleMoreDropdown,
}) => {
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const setScrollElementRef = useCallback((el: HTMLDivElement | null) => {
        setScrollElement(el);
        setRef(scrollContainerRef, el);
    }, [scrollContainerRef]);

    const { width, height } = useElementSize(scrollElement);
    const { scrollTop, isScrolling, syncScrollTop, scrollToTop } = useElementScroller(scrollElement, 12);

    useEffect(() => {
        if (scrollResetKey === undefined) return;
        scrollToTop();
    }, [scrollResetKey, scrollToTop]);

    // Keep our internal scrollTop in sync when the rendered content changes and the browser clamps scrollTop.
    useEffect(() => {
        syncScrollTop();
    }, [items.length, syncScrollTop]);

    const positioner = usePositioner(
        { width, columnWidth: 200, columnGutter: 8 },
        [width, items.length, scrollResetKey],
    );
    const resizeObserver = useResizeObserver(positioner);

    const contextValue = useMemo<VirtualizedImageGridContextValue>(() => ({
        mode,
        activeAssetId,
        selectedAssetId,
        excludeAssetIds,
        editingAssetId,
        editingName,
        moreDropdownAssetId,
        moreDropdownRef,
        onItemClick,
        onSetActiveAssetId,
        onSetMain,
        onStartRename,
        onEditingNameChange,
        onSaveRename,
        onCancelRename,
        onOpenDetail,
        onDeleteAsset,
        onToggleMoreDropdown,
    }), [
        mode,
        activeAssetId,
        selectedAssetId,
        excludeAssetIds,
        editingAssetId,
        editingName,
        moreDropdownAssetId,
        moreDropdownRef,
        onItemClick,
        onSetActiveAssetId,
        onSetMain,
        onStartRename,
        onEditingNameChange,
        onSaveRename,
        onCancelRename,
        onOpenDetail,
        onDeleteAsset,
        onToggleMoreDropdown,
    ]);

    const masonry = useMasonry({
        items,
        itemKey: (data) => data.id,
        itemHeightEstimate: 220,
        positioner,
        resizeObserver,
        containerRef,
        height,
        scrollTop,
        isScrolling,
        render: MasonryCard,
    });

    if (items.length === 0) {
        return null;
    }

    return (
        <VirtualizedImageGridContext.Provider value={contextValue}>
            <div ref={setScrollElementRef} className="virtualized-grid-container">
                {masonry}
            </div>
        </VirtualizedImageGridContext.Provider>
    );
};
