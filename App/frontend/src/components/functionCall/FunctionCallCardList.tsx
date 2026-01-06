import React from 'react';
import type { CardWithPreview, StreamingPreview, CardMode } from './types';
import { StreamingOperationItem } from './StreamingOperationItem';
import { PendingOperationItem } from './PendingOperationItem';
import { ConfirmedOperationItem } from './ConfirmedOperationItem';

interface FunctionCallCardListProps {
  mode: CardMode;
  streamingPreviews: StreamingPreview[];
  cardsWithPreviews: CardWithPreview[];
  selections: Record<string, boolean>;
  onToggle: (cardId: string) => void;
  isConfirming: boolean;
}

export const FunctionCallCardList: React.FC<FunctionCallCardListProps> = ({
  mode,
  streamingPreviews,
  cardsWithPreviews,
  selections,
  onToggle,
  isConfirming,
}) => {
  const isStreaming = mode === 'streaming';
  const isConfirmed = mode === 'confirmed';

  return (
    <div className="fc-list">
      {isStreaming &&
        streamingPreviews.map(({ progress, functionName, previews }) => (
          <StreamingOperationItem
            key={progress.draft.id}
            functionName={functionName}
            status={progress.status}
            previews={previews}
            updatedAt={progress.updatedAt}
            error={progress.error}
          />
        ))}

      {!isStreaming &&
        cardsWithPreviews.map(({ card, previews }) => {
          const fcStatus = card.functionCall?.status ?? 'pending';
          const hasError = fcStatus === 'failed';
          const errorMessage = card.functionCall?.reason;

          if (isConfirmed) {
            const status = fcStatus === 'rejected' ? 'rejected' : fcStatus === 'failed' ? 'failed' : 'applied';

            return (
              <ConfirmedOperationItem
                key={card.id}
                title={card.title}
                previews={previews}
                status={status}
                errorMessage={errorMessage}
              />
            );
          }

          const isSelected = fcStatus === 'failed' && card.functionCall?.failureType === 'validation'
            ? false
            : selections[card.id] ?? true;

          return (
            <PendingOperationItem
              key={card.id}
              title={card.title}
              previews={previews}
              isSelected={isSelected}
              onToggle={() => onToggle(card.id)}
              hasError={hasError}
              errorMessage={errorMessage}
              isDisabled={isConfirming}
            />
          );
        })}
    </div>
  );
};
