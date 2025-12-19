/**
 * useFitText - Dynamic font scaling to fit text within a container
 *
 * Measures text and adjusts font size to fit within a fixed-height container.
 * Uses binary search for efficient font size calculation.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

interface UseFitTextOptions {
  /** Minimum font size in pixels (default: 12) */
  minFontSize?: number;
  /** Maximum font size in pixels (default: 48) */
  maxFontSize?: number;
  /** Trigger recalculation when this value changes */
  text: string;
}

interface UseFitTextResult {
  /** Ref to attach to the container element */
  containerRef: React.RefObject<HTMLDivElement>;
  /** Ref to attach to the text element */
  textRef: React.RefObject<HTMLElement>;
  /** Calculated font size in pixels */
  fontSize: number;
  /** Whether the calculation is complete */
  isReady: boolean;
}

export function useFitText({
  minFontSize = 12,
  maxFontSize = 48,
  text,
}: UseFitTextOptions): UseFitTextResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLElement>(null);
  const [fontSize, setFontSize] = useState(maxFontSize);
  const [isReady, setIsReady] = useState(false);

  const calculateFontSize = useCallback(() => {
    const container = containerRef.current;
    const textElement = textRef.current;

    if (!container || !textElement) return;

    const containerHeight = container.clientHeight;
    const containerWidth = container.clientWidth;

    if (containerHeight === 0 || containerWidth === 0) return;

    // Binary search for optimal font size
    let low = minFontSize;
    let high = maxFontSize;
    let optimalSize = minFontSize;

    // Store original styles
    const originalFontSize = textElement.style.fontSize;
    const originalVisibility = textElement.style.visibility;
    textElement.style.visibility = 'hidden';

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      textElement.style.fontSize = `${mid}px`;

      const fits =
        textElement.scrollHeight <= containerHeight &&
        textElement.scrollWidth <= containerWidth;

      if (fits) {
        optimalSize = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    // Restore visibility and apply optimal size
    textElement.style.visibility = originalVisibility;
    textElement.style.fontSize = originalFontSize;

    setFontSize(optimalSize);
    setIsReady(true);
  }, [minFontSize, maxFontSize]);

  useEffect(() => {
    setIsReady(false);
    // Small delay to ensure DOM is rendered
    const timeoutId = setTimeout(calculateFontSize, 0);
    return () => clearTimeout(timeoutId);
  }, [text, calculateFontSize]);

  // Recalculate on resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      calculateFontSize();
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [calculateFontSize]);

  return {
    containerRef,
    textRef,
    fontSize,
    isReady,
  };
}
