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
          const hasValidationError = !!card.validationError;
          const hasApplyError = !!card.applyError;
          const hasError = hasValidationError || hasApplyError;

          if (isConfirmed) {
            const status = card.isRejected ? 'rejected' : card.applyError ? 'failed' : 'applied';

            return (
              <ConfirmedOperationItem
                key={card.id}
                title={card.title}
                previews={previews}
                status={status}
                errorMessage={card.applyError}
              />
            );
          }

          const isSelected = hasValidationError
            ? false
            : selections[card.id] ?? true;

          return (
            <PendingOperationItem
              key={card.id}
              id={card.id}
              title={card.title}
              previews={previews}
              isSelected={isSelected}
              onToggle={() => onToggle(card.id)}
              hasError={hasError}
              errorMessage={card.validationError || card.applyError}
              isDisabled={isConfirming}
            />
          );
        })}
    </div>
  );
};
