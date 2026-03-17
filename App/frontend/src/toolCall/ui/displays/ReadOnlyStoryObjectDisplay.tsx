import React, { useMemo } from 'react';
import { StoryObjectCard } from '../../../components/StoryObjectManager/StoryObjectCards/StoryObjectCard';
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
  objectType = 'story_entity',
}) => {
  const mapped = useMemo(() => mapObjectData(objectType, values), [objectType, values]);

  // Normalize changedFields from raw arg names to display field names
  const normalizedChangedFields = useMemo(() => {
    if (!changedFields) return undefined;
    if (objectType === 'guidelines') {
      return changedFields.map((f) => (f === 'authorNote' ? 'content' : f));
    }
    return changedFields;
  }, [changedFields, objectType]);

  // For replace mode: only show fields that actually changed
  const showDescription =
    mode !== 'replace' || !normalizedChangedFields || normalizedChangedFields.includes('description');
  const showContent =
    mode !== 'replace' || !normalizedChangedFields || normalizedChangedFields.includes('content');

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
