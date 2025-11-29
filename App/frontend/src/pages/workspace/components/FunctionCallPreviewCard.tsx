import React, { useMemo } from 'react';
import type { FunctionCallOperationPreview, FunctionCallProgress } from '../../../llm_request/types';
import FunctionCallReviewCard from '../../../components/functionCall/FunctionCallReviewCard';
import type { StoryObjects } from '../../../types/storyObject';
import { resolveStoryObjectName } from '../../../chat/utils/objectNameResolver';

interface FunctionCallPreviewCardProps {
  progress: FunctionCallProgress;
  storyObjects: StoryObjects;
}

const FunctionCallPreviewCard: React.FC<FunctionCallPreviewCardProps> = ({ progress, storyObjects }) => {
  const displayName = progress.draft.functionName || `Function #${progress.draft.index + 1}`;
  const errorMessage = progress.error
    ? `Unable to parse the JSON yet. The AI may still be streaming. (${progress.error})`
    : undefined;

  const operations = useMemo<FunctionCallOperationPreview[]>(
    () =>
      (progress.operationPreviews ?? []).map((operation) => ({
        ...operation,
        targetName: operation.targetName ?? resolveStoryObjectName(storyObjects, operation.type, operation.id),
      })),
    [progress.operationPreviews, storyObjects]
  );

  return (
    <FunctionCallReviewCard
      title={displayName}
      eyebrow="Streaming Function Call"
      status={progress.status}
      updatedAt={progress.updatedAt}
      operations={operations}
      placeholder="Waiting for the AI to stream structured arguments..."
      error={errorMessage}
      variant="streaming"
    />
  );
};

export default FunctionCallPreviewCard;
