import React, { useMemo, useState, useCallback } from 'react';
import type { FunctionCallOperationPreview } from '../../llm/requestTypes';
import { buildOperationPreviewsFromArgs } from '../../chat/utils/functionCallPreview';
import { resolveStoryObjectName, parseFunctionName } from '../../chat/utils/objectNameResolver';
import { useCardSelection, useCardExpansion } from './hooks';
import { FunctionCallCardHeader } from './FunctionCallCardHeader';
import { FunctionCallCardList } from './FunctionCallCardList';
import { CardFooter } from './CardFooter';
import { ConfirmedFooter } from './ConfirmedFooter';
import type { FunctionCallCardContainerProps, CardWithPreview, StreamingPreview } from './types';
import './FunctionCallCard.css';

export const FunctionCallCardContainer: React.FC<FunctionCallCardContainerProps> = ({
  mode,
  cards = [],
  streamingProgress = [],
  onConfirm,
  storyObjects,
  isApplyDisabled = false,
  applyDisabledReason,
}) => {
  const isStreaming = mode === 'streaming';
  const isConfirmed = mode === 'confirmed';
  const isPending = mode === 'pending';

  const { isExpanded, toggleExpand } = useCardExpansion(!isConfirmed);
  const {
    selections,
    selectedCount,
    rejectedCount,
    toggleSelection,
    selectAll,
    deselectAll,
  } = useCardSelection(cards, isStreaming);

  const [isConfirming, setIsConfirming] = useState(false);

  // Build previews for each card (pending/confirmed modes)
  const cardsWithPreviews: CardWithPreview[] = useMemo(() => {
    if (isStreaming) return [];
    return cards.map((card) => {
      const rawPreviews = buildOperationPreviewsFromArgs(card.data);
      const functionName = card.functionCall?.functionName;
      const parsed = functionName ? parseFunctionName(functionName) : undefined;

      const enrichedPreviews = rawPreviews.map((preview) => {
        const objectType = preview.type || parsed?.objectType;
        const action = preview.action || parsed?.action;
        const objectId = (preview.id || card.data?.id || card.data?.chapterId) as string | undefined;

        return {
          ...preview,
          type: objectType,
          action,
          id: objectId,
          targetName: resolveStoryObjectName(storyObjects, objectType, objectId),
        } as FunctionCallOperationPreview;
      });

      return { card, previews: enrichedPreviews };
    });
  }, [cards, storyObjects, isStreaming]);

  // Build streaming previews (streaming mode)
  const streamingPreviews: StreamingPreview[] = useMemo(() => {
    if (!isStreaming) return [];
    return streamingProgress.map((progress) => {
      const functionName = progress.draft.functionName;
      const parsed = functionName ? parseFunctionName(functionName) : undefined;

      const enrichedPreviews = (progress.operationPreviews ?? []).map((preview) => {
        const objectType = preview.type || parsed?.objectType;
        const action = preview.action || parsed?.action;
        const objectId = preview.id;

        return {
          ...preview,
          type: objectType,
          action,
          targetName: preview.targetName ?? resolveStoryObjectName(storyObjects, objectType, objectId),
        };
      });

      return {
        progress,
        functionName: functionName || `Function #${progress.draft.index + 1}`,
        previews: enrichedPreviews,
      };
    });
  }, [streamingProgress, storyObjects, isStreaming]);

  const handleConfirm = useCallback(async () => {
    if (isConfirming || isConfirmed || !onConfirm) return;
    setIsConfirming(true);
    try {
      await onConfirm(selections);
    } finally {
      setIsConfirming(false);
    }
  }, [selections, onConfirm, isConfirming, isConfirmed]);

  // Empty state check
  if (isStreaming && streamingProgress.length === 0) return null;
  if (!isStreaming && cards.length === 0) return null;

  const itemCount = isStreaming ? streamingProgress.length : cards.length;
  const streamingStatus = isStreaming && streamingProgress.length > 0
    ? streamingProgress[0].status
    : undefined;

  return (
    <div className={`fc-card fc-card--${mode}`}>
      <FunctionCallCardHeader
        mode={mode}
        isExpanded={isExpanded}
        onToggleExpand={toggleExpand}
        itemCount={itemCount}
        streamingStatus={streamingStatus}
      />

      {isExpanded && (
        <div className="fc-card__content">
          <FunctionCallCardList
            mode={mode}
            streamingPreviews={streamingPreviews}
            cardsWithPreviews={cardsWithPreviews}
            selections={selections}
            onToggle={toggleSelection}
            isConfirming={isConfirming}
          />

          {isPending && (
            <CardFooter
              selectedCount={selectedCount}
              rejectedCount={rejectedCount}
              totalCount={cards.length}
              isApplyDisabled={isApplyDisabled}
              applyDisabledReason={applyDisabledReason}
              isConfirming={isConfirming}
              onSelectAll={selectAll}
              onDeselectAll={deselectAll}
              onConfirm={handleConfirm}
            />
          )}

          {isConfirmed && (
            <ConfirmedFooter
              appliedCount={selectedCount}
              rejectedCount={rejectedCount}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default FunctionCallCardContainer;
