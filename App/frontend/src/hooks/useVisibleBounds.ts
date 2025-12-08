/**
 * useVisibleBounds - Calculates the visible viewport bounds of a container
 *
 * Used to position the expanded card overlay within the visible grid area,
 * accounting for scroll position and viewport intersection.
 */

import { useState, useEffect, useCallback, useRef, type RefObject } from 'react';

export interface VisibleBounds {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Hook to calculate the visible portion of a container element
 * Returns CSS positioning values for an absolutely positioned overlay
 */
export function useVisibleBounds(
  containerRef: RefObject<HTMLElement | null>,
  isActive: boolean = false
): VisibleBounds {
  const [bounds, setBounds] = useState<VisibleBounds>({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  });

  // RAF throttle ref to prevent layout thrashing on scroll
  const rafRef = useRef<number | null>(null);

  const calculateBounds = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const scrollParent = getScrollParent(container);
    const scrollRect = scrollParent
      ? scrollParent.getBoundingClientRect()
      : { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };

    // Calculate the visible intersection between container and viewport/scroll parent
    const visibleTop = Math.max(rect.top, scrollRect.top, 0);
    const visibleLeft = Math.max(rect.left, scrollRect.left, 0);
    const visibleBottom = Math.min(
      rect.bottom,
      scrollRect.bottom || window.innerHeight,
      window.innerHeight
    );
    const visibleRight = Math.min(
      rect.right,
      scrollRect.right || window.innerWidth,
      window.innerWidth
    );

    // Calculate position relative to the container
    const containerScrollTop = container.scrollTop || 0;
    const containerScrollLeft = container.scrollLeft || 0;

    setBounds({
      top: visibleTop - rect.top + containerScrollTop,
      left: visibleLeft - rect.left + containerScrollLeft,
      width: Math.max(0, visibleRight - visibleLeft),
      height: Math.max(0, visibleBottom - visibleTop),
    });
  }, [containerRef]);

  // Throttled version using requestAnimationFrame to prevent layout thrashing
  const throttledCalculateBounds = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      calculateBounds();
      rafRef.current = null;
    });
  }, [calculateBounds]);

  useEffect(() => {
    if (!isActive) return;

    // Initial calculation (immediate, not throttled)
    calculateBounds();

    // Recalculate on resize and scroll (throttled)
    window.addEventListener('resize', throttledCalculateBounds);
    window.addEventListener('scroll', throttledCalculateBounds, true);

    return () => {
      window.removeEventListener('resize', throttledCalculateBounds);
      window.removeEventListener('scroll', throttledCalculateBounds, true);
      // Clean up any pending RAF
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isActive, calculateBounds, throttledCalculateBounds]);

  return bounds;
}

/**
 * Find the scrollable parent of an element
 */
function getScrollParent(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;

  while (parent) {
    const style = getComputedStyle(parent);
    const overflowY = style.overflowY;
    const overflowX = style.overflowX;

    if (
      overflowY === 'auto' ||
      overflowY === 'scroll' ||
      overflowX === 'auto' ||
      overflowX === 'scroll'
    ) {
      return parent;
    }

    parent = parent.parentElement;
  }

  return null;
}
