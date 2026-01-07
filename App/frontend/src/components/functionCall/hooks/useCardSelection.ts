import { useState, useEffect, useCallback, useMemo } from 'react';
import type { EditCard } from '../../../functionCall/types';

interface SelectionState {
  selections: Record<string, boolean>;
  selectedCount: number;
  rejectedCount: number;
  toggleSelection: (cardId: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
}

export function useCardSelection(
  cards: EditCard[],
  isDisabled: boolean = false
): SelectionState {
  const [selections, setSelections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    cards.forEach((card) => {
      // Cards with validation failures default to unselected
      const hasValidationFailure = card.functionCall?.status === 'failed' && card.functionCall?.failureType === 'validation';
      initial[card.id] = !hasValidationFailure;
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
          const hasValidationFailure = card.functionCall?.status === 'failed' && card.functionCall?.failureType === 'validation';
          updated[card.id] = !hasValidationFailure;
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
  }, [cardIds, isDisabled]);

  const toggleSelection = useCallback(
    (cardId: string) => {
      if (isDisabled) return;
      const card = cards.find((c) => c.id === cardId);
      const hasValidationFailure = card?.functionCall?.status === 'failed' && card?.functionCall?.failureType === 'validation';
      if (hasValidationFailure) return;
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
      const hasValidationFailure = card.functionCall?.status === 'failed' && card.functionCall?.failureType === 'validation';
      newSelections[card.id] = !hasValidationFailure;
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
