import { useState, useEffect, useCallback, useMemo } from 'react';
import type { EditCard, ToolCallDecision, ToolCallDecisionMap } from '../../../toolCall/types';

function isValidationFailed(card: EditCard): boolean {
  return card.toolCall.status === 'failed' && card.toolCall.failureType === 'validation';
}

function isDecisionEligible(card: EditCard): boolean {
  return card.toolCall.status === 'pending' || card.toolCall.status === 'validating';
}

function getDefaultDecision(card: EditCard): ToolCallDecision {
  if (isValidationFailed(card)) return 'reject';
  return 'accept';
}

interface OperationDecisionState {
  decisions: ToolCallDecisionMap;
  acceptedCount: number;
  rejectedCount: number;
  setDecision: (cardId: string, decision: ToolCallDecision) => void;
  getDecision: (card: EditCard) => ToolCallDecision;
  isDecisionLocked: (card: EditCard) => boolean;
  buildDecisionMap: (cardIds: string[]) => ToolCallDecisionMap;
}

export function useOperationDecisions(
  cards: EditCard[],
  isDisabled: boolean = false
): OperationDecisionState {
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const cardIds = useMemo(() => cards.map((card) => card.id).join(','), [cards]);

  const [decisions, setDecisions] = useState<ToolCallDecisionMap>(() => {
    const initial: ToolCallDecisionMap = {};
    cards.forEach((card) => {
      initial[card.id] = getDefaultDecision(card);
    });
    return initial;
  });

  useEffect(() => {
    if (isDisabled) return;
    setDecisions((prev) => {
      const next: ToolCallDecisionMap = {};

      cards.forEach((card) => {
        if (isValidationFailed(card)) {
          next[card.id] = 'reject';
          return;
        }
        next[card.id] = prev[card.id] ?? getDefaultDecision(card);
      });

      const hasChanged =
        Object.keys(prev).length !== Object.keys(next).length ||
        Object.entries(next).some(([id, decision]) => prev[id] !== decision);

      return hasChanged ? next : prev;
    });
  }, [cardIds, cards, isDisabled]);

  const isDecisionLocked = useCallback(
    (card: EditCard) => {
      if (isDisabled) return true;
      if (isValidationFailed(card)) return true;
      return !isDecisionEligible(card);
    },
    [isDisabled]
  );

  const getDecision = useCallback(
    (card: EditCard): ToolCallDecision => decisions[card.id] ?? getDefaultDecision(card),
    [decisions]
  );

  const setDecision = useCallback(
    (cardId: string, decision: ToolCallDecision) => {
      if (isDisabled) return;
      const card = cardsById.get(cardId);
      if (!card) return;
      if (isDecisionLocked(card)) return;
      setDecisions((prev) => ({ ...prev, [cardId]: decision }));
    },
    [cardsById, isDecisionLocked, isDisabled]
  );

  const buildDecisionMap = useCallback(
    (cardIdsToCommit: string[]): ToolCallDecisionMap => {
      const out: ToolCallDecisionMap = {};
      cardIdsToCommit.forEach((cardId) => {
        const card = cardsById.get(cardId);
        if (!card) return;
        if (!isDecisionEligible(card)) return;
        if (isValidationFailed(card)) return;
        out[cardId] = decisions[cardId] ?? getDefaultDecision(card);
      });
      return out;
    },
    [cardsById, decisions]
  );

  const { acceptedCount, rejectedCount } = useMemo(() => {
    let accepted = 0;
    let rejected = 0;
    cards.forEach((card) => {
      if (!isDecisionEligible(card) && !isValidationFailed(card)) return;
      const decision = decisions[card.id] ?? getDefaultDecision(card);
      if (decision === 'accept') accepted += 1;
      else rejected += 1;
    });
    return { acceptedCount: accepted, rejectedCount: rejected };
  }, [cards, decisions]);

  return {
    decisions,
    acceptedCount,
    rejectedCount,
    setDecision,
    getDecision,
    isDecisionLocked,
    buildDecisionMap,
  };
}
