import type { EditCard } from '../toolCall/types';
import type { OperationVM } from './types';
import { mapToolToOperationVM } from './toolToVm';

export function buildStoredOperations(cards: EditCard[]): OperationVM[] {
  return cards.map((card) =>
    mapToolToOperationVM({
      id: card.id,
      toolName: card.toolCall.toolName,
      args: card.data,
      status: card.toolCall.status,
      reason: card.toolCall.reason,
      failureType: card.toolCall.failureType,
      result: card.toolCall.result,
      source: 'stored',
    })
  );
}
