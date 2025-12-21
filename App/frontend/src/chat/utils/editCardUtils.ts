import type { EditCard } from '../types';

type EditCardMap = Record<string, EditCard[]>;

const normalizeTimestamp = (value: Date | string | undefined): number | null => {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

const areEditCardsEquivalent = (prev: EditCard[] = [], next: EditCard[] = []): boolean => {
  if (prev.length !== next.length) return false;

  for (let index = 0; index < prev.length; index += 1) {
    const prevCard = prev[index];
    const nextCard = next[index];

    if (!nextCard) return false;

    if (
      prevCard.id !== nextCard.id ||
      prevCard.type !== nextCard.type ||
      prevCard.title !== nextCard.title ||
      prevCard.description !== nextCard.description ||
      prevCard.isApplied !== nextCard.isApplied
    ) {
      return false;
    }

    const prevAppliedAt = normalizeTimestamp(prevCard.appliedAt);
    const nextAppliedAt = normalizeTimestamp(nextCard.appliedAt);
    if (prevAppliedAt !== nextAppliedAt) {
      return false;
    }

    const prevData = JSON.stringify(prevCard.data ?? null);
    const nextData = JSON.stringify(nextCard.data ?? null);
    if (prevData !== nextData) {
      return false;
    }
  }

  return true;
};

export const areEditCardMapsEqual = (prev: EditCardMap, next: EditCardMap): boolean => {
  const prevKeys = Object.keys(prev ?? {});
  const nextKeys = Object.keys(next ?? {});

  if (prevKeys.length !== nextKeys.length) {
    return false;
  }

  for (const key of prevKeys) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      return false;
    }

    const prevCards = prev[key] ?? [];
    const nextCards = next[key] ?? [];

    if (!areEditCardsEquivalent(prevCards, nextCards)) {
      return false;
    }
  }

  return true;
};
