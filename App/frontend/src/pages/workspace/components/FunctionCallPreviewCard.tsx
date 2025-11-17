import React, { useMemo } from 'react';
import type { FunctionCallOperationPreview, FunctionCallProgress } from '../../../llm_request/types';
import FunctionCallReviewCard from '../../../components/functionCall/FunctionCallReviewCard';
import type { StoryObjects, Act, Chapter } from '../../../types/storyObject';

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

const resolveStoryObjectName = (
  storyObjects: StoryObjects,
  type?: string,
  id?: string
): string | undefined => {
  if (!type || !id) return undefined;

  switch (type) {
    case 'basic_info':
      return storyObjects.basicInfo?.title || storyObjects.basicInfo?.logline;
    case 'character':
      return storyObjects.characters.find((item) => item.id === id)?.name;
    case 'organization':
      return storyObjects.organizations.find((item) => item.id === id)?.name;
    case 'location':
      return storyObjects.locations.find((item) => item.id === id)?.name;
    case 'lorebook':
      return storyObjects.lorebook.find((item) => item.id === id)?.name;
    case 'act':
      return findAct(storyObjects.outline?.acts, id)?.name;
    case 'chapter': {
      const chapter = findChapter(storyObjects.outline?.acts, id);
      return chapter?.name;
    }
    default:
      return undefined;
  }
};

const findAct = (acts: Act[] | undefined, id: string) =>
  acts?.find((act) => act.id === id);

const findChapter = (acts: Act[] | undefined, id: string): Chapter | undefined => {
  if (!acts) return undefined;
  for (const act of acts) {
    const chapter = act.chapters?.find((entry) => entry.id === id);
    if (chapter) {
      return chapter;
    }
  }
  return undefined;
};

export default FunctionCallPreviewCard;
