import { useState, useCallback, useEffect } from 'react';

export function useCardExpansion(initialExpanded: boolean = true) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);

  useEffect(() => {
    setIsExpanded(initialExpanded);
  }, [initialExpanded]);

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const expand = useCallback(() => {
    setIsExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    setIsExpanded(false);
  }, []);

  return {
    isExpanded,
    toggleExpand,
    expand,
    collapse,
  };
}
