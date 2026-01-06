import type { EditCard } from '../functionCall';

export type StoredEditCard = Omit<EditCard, 'onApply' | 'onReject'>;

