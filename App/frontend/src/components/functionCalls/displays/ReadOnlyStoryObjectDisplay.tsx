import React, { useMemo } from 'react';
import { StoryObjectCard } from '../../StoryObjectManager/StoryObjectCards/StoryObjectCard';
import { mapObjectData } from './mapToCardProps';

export interface ReadOnlyStoryObjectDisplayProps {
  title: string;
  values: Record<string, unknown>;
  mode: 'read' | 'create' | 'replace' | 'delete';
  changedFields?: string[];
  imageUrl?: string | null;
  objectType?: string;
}

export const ReadOnlyStoryObjectDisplay: React.FC<ReadOnlyStoryObjectDisplayProps> = ({
  title,
  values,
  mode,
  changedFields,
  imageUrl,
  objectType = 'story_object',
}) => {
  const mapped = useMemo(() => mapObjectData(objectType, values), [objectType, values]);

  // For replace mode: only show fields that actually changed
  const showDescription =
    mode !== 'replace' || !changedFields || changedFields.includes('description');
  const showContent =
    mode !== 'replace' || !changedFields || changedFields.includes('content');

  const hasImage = Boolean(imageUrl);

  return (
    <StoryObjectCard
      name={title}
      description={showDescription ? mapped.description : undefined}
      content={showContent ? mapped.content : undefined}
      imageUrl={imageUrl}
      expanded
      spanType={hasImage ? 'vertical' : 'text-only'}
      className="function-call-readonly-item"
    />
  );
};

export default ReadOnlyStoryObjectDisplay;
