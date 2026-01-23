import type { EditCard } from '../toolCall';

export type StoredEditCard = Omit<EditCard, 'onApply' | 'onReject'>;

