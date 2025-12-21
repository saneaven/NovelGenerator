import { useState, useEffect, useCallback, useMemo } from 'react';
import type { EditCard } from '../../../functionCall/types';
import type { SelectionState } from '../types';

export function useCardSelection(
  cards: EditCard[],
  isDisabled: boolean = false
): SelectionState {
  const [selections, setSelections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    cards.forEach((card) => {
      // Cards with validation errors default to unselected
      initial[card.id] = !card.validationError;
    });
    return initial;
  });

  // Sync selections when cards change
  const cardIds = useMemo(() => cards.map((c) => c.id).join(','), [cards]);

  useEffect(() => {
    if (isDisabled) return;
    setSelections((prev) => {
      const currentIds = new Set(cards.map((c) => c.id));
      const updated = { ...prev };
      let hasChanges = false;

      // Add new cards
      cards.forEach((card) => {
        if (!(card.id in updated)) {
          updated[card.id] = !card.validationError;
          hasChanges = true;
        }
      });

      // Remove stale cards
      Object.keys(updated).forEach((id) => {
        if (!currentIds.has(id)) {
          delete updated[id];
          hasChanges = true;
        }
      });

      return hasChanges ? updated : prev;
    });
  }, [cardIds, isDisabled, cards]);

  const toggleSelection = useCallback(
    (cardId: string) => {
      if (isDisabled) return;
      const card = cards.find((c) => c.id === cardId);
      if (card?.validationError) return;
      setSelections((prev) => ({
        ...prev,
        [cardId]: !prev[cardId],
      }));
    },
    [isDisabled, cards]
  );

  const selectAll = useCallback(() => {
    if (isDisabled) return;
    const newSelections: Record<string, boolean> = {};
    cards.forEach((card) => {
      newSelections[card.id] = !card.validationError;
    });
    setSelections(newSelections);
  }, [cards, isDisabled]);

  const deselectAll = useCallback(() => {
    if (isDisabled) return;
    const newSelections: Record<string, boolean> = {};
    cards.forEach((card) => {
      newSelections[card.id] = false;
    });
    setSelections(newSelections);
  }, [cards, isDisabled]);

  const { selectedCount, rejectedCount } = useMemo(() => {
    let selected = 0;
    let rejected = 0;
    cards.forEach((card) => {
      if (selections[card.id]) selected++;
      else rejected++;
    });
    return { selectedCount: selected, rejectedCount: rejected };
  }, [cards, selections]);

  return {
    selections,
    selectedCount,
    rejectedCount,
    toggleSelection,
    selectAll,
    deselectAll,
  };
}
