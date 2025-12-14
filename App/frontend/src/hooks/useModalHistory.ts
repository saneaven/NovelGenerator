import { useEffect, useRef } from 'react';

// Global counter for unique modal IDs
let modalIdCounter = 0;

/**
 * Hook that integrates modal state with browser history.
 * When a modal is open and the user presses the back button,
 * the modal closes instead of navigating to the previous page.
 *
 * @param isOpen - Whether the modal is currently open
 * @param onClose - Callback to close the modal
 */
export function useModalHistory(isOpen: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  const modalIdRef = useRef<number | null>(null);
  const closedByBackButton = useRef(false);

  // Keep onClose ref updated to avoid stale closures
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) {
      // Modal closed - clean up history if not closed via back button
      if (modalIdRef.current !== null && !closedByBackButton.current) {
        window.history.back();
      }
      modalIdRef.current = null;
      closedByBackButton.current = false;
      return;
    }

    // Only push state if we haven't already (handles StrictMode re-runs)
    if (modalIdRef.current === null) {
      modalIdRef.current = ++modalIdCounter;
      closedByBackButton.current = false;
      window.history.pushState({ modal: true, modalId: modalIdRef.current }, '');
    }

    const modalId = modalIdRef.current;

    const handlePopState = (event: PopStateEvent) => {
      if (modalIdRef.current !== modalId) return;

      const currentState = event.state;
      const isOurStatePoppedOff = !currentState || currentState.modalId !== modalId;

      if (isOurStatePoppedOff) {
        closedByBackButton.current = true;
        onCloseRef.current();
      }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isOpen]);
}
