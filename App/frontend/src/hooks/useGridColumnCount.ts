/**
 * useGridColumnCount - Detects the number of columns in a CSS grid
 *
 * Used to dynamically adjust card spans when the grid can't fit multiple columns.
 * Calculates based on grid width and 30dvh minimum column width.
 */

import { useState, useEffect, RefObject } from 'react';

const DVH = window.innerHeight * 0.2; // 20dvh

export function useGridColumnCount(gridRef: RefObject<HTMLElement | null>): number {
  const [columnCount, setColumnCount] = useState(2);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const calculateColumns = () => {
      const gridWidth = grid.clientWidth;
      const computedStyle = getComputedStyle(grid);
      const gap = parseFloat(computedStyle.gap) || parseFloat(computedStyle.columnGap) || 0;
      const minColWidth = DVH;

      // Calculate how many columns fit: (width + gap) / (colWidth + gap)
      const columns = Math.max(1, Math.floor((gridWidth + gap) / (minColWidth + gap)));
      setColumnCount(columns);

      // Set CSS variable for use in grid styles
      grid.style.setProperty('--grid-columns', String(columns));
    };

    // Initial calculation
    calculateColumns();

    // Observe container resize
    const resizeObserver = new ResizeObserver(calculateColumns);
    resizeObserver.observe(grid);

    // Also listen for window resize (viewport height changes affect dvh)
    window.addEventListener('resize', calculateColumns);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', calculateColumns);
    };
  }, [gridRef]);

  return columnCount;
}
