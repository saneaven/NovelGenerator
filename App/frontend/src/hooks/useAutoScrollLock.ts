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
  const programmaticScrollRef = useRef(false);
  const pendingResetRef = useRef(false);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const measureNearBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight < bottomThreshold;
  }, [bottomThreshold, scrollContainerRef]);

  const syncScrollState = useCallback(() => {
    const isNearBottom = measureNearBottom();
    isNearBottomRef.current = isNearBottom;
    setShowScrollButton(!isNearBottom);
  }, [active, measureNearBottom]);

  const scrollToBottom = useCallback((options?: ScrollToBottomOptions) => {
    const container = scrollContainerRef.current;
    if (!container) {
      isNearBottomRef.current = true;
      setShowScrollButton(false);
      return;
    }

    isNearBottomRef.current = true;
    programmaticScrollRef.current = true;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: options?.behavior ?? 'smooth',
    });
    setShowScrollButton(false);
  }, [scrollContainerRef]);

  const resetToBottom = useCallback(() => {
    isNearBottomRef.current = true;
    pendingResetRef.current = true;
    setShowScrollButton(false);

    requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      programmaticScrollRef.current = true;
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
    });
  }, [scrollContainerRef]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        return;
      }
      pendingResetRef.current = false;
      syncScrollState();
    };

    container.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => container.removeEventListener('scroll', handleScroll);
  }, [scrollContainerRef, syncScrollState]);

  useEffect(() => {
    syncScrollState();
  }, [active, syncScrollState]);

  useEffect(() => {
    const content = contentRef.current;
    const container = scrollContainerRef.current;
    if (!content || !container) return;

    const handleResize = () => {
      const currentContainer = scrollContainerRef.current;
      if (!currentContainer) return;

      if ((active || pendingResetRef.current) && isNearBottomRef.current) {
        programmaticScrollRef.current = true;
        currentContainer.scrollTo({ top: currentContainer.scrollHeight, behavior: 'auto' });
      }
      syncScrollState();
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(content);
    resizeObserver.observe(container);
    handleResize();

    return () => {
      resizeObserver.disconnect();
    };
  }, [contentRef, scrollContainerRef, active, syncScrollState]);

  return {
    showScrollButton,
    scrollToBottom,
    resetToBottom,
  };
}

export default useAutoScrollLock;
