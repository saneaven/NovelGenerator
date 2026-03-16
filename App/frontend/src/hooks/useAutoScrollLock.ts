import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

interface UseAutoScrollLockOptions {
  scrollContainerRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  active: boolean;
  bottomThreshold?: number;
}

interface ScrollToBottomOptions {
  behavior?: ScrollBehavior;
}

interface UseAutoScrollLockResult {
  showScrollButton: boolean;
  scrollToBottom: (options?: ScrollToBottomOptions) => void;
  resetToBottom: () => void;
}

export function useAutoScrollLock({
  scrollContainerRef,
  contentRef,
  active,
  bottomThreshold = 100,
}: UseAutoScrollLockOptions): UseAutoScrollLockResult {
  const isNearBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const measureNearBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight < bottomThreshold;
  }, [bottomThreshold, scrollContainerRef]);

  const syncScrollState = useCallback(() => {
    const isNearBottom = measureNearBottom();
    isNearBottomRef.current = isNearBottom;
    setShowScrollButton(active && !isNearBottom);
  }, [active, measureNearBottom]);

  const scrollToBottom = useCallback((options?: ScrollToBottomOptions) => {
    const container = scrollContainerRef.current;
    if (!container) {
      isNearBottomRef.current = true;
      setShowScrollButton(false);
      return;
    }

    isNearBottomRef.current = true;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: options?.behavior ?? 'smooth',
    });
    setShowScrollButton(false);
  }, [scrollContainerRef]);

  const resetToBottom = useCallback(() => {
    isNearBottomRef.current = true;
    setShowScrollButton(false);

    requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
    });
  }, [scrollContainerRef]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      syncScrollState();
    };

    container.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => container.removeEventListener('scroll', handleScroll);
  });

  useEffect(() => {
    if (!active) {
      setShowScrollButton(false);
      return;
    }
    syncScrollState();
  }, [active, syncScrollState]);

  useEffect(() => {
    const content = contentRef.current;
    const container = scrollContainerRef.current;
    if (!content || !container) return;

    let frameId = 0;
    const handleResize = () => {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        const currentContainer = scrollContainerRef.current;
        if (!currentContainer) return;

        if (isNearBottomRef.current) {
          currentContainer.scrollTo({ top: currentContainer.scrollHeight, behavior: 'auto' });
        }
        syncScrollState();
      });
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(content);
    resizeObserver.observe(container);
    handleResize();

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  });

  return {
    showScrollButton,
    scrollToBottom,
    resetToBottom,
  };
}

export default useAutoScrollLock;
