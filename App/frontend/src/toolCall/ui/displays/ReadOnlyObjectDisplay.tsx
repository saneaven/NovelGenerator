import React, { useMemo } from 'react';
import { ObjectCard } from '../../../components/ObjectManager/ObjectCards/ObjectCard';
import { mapObjectData } from './mapToCardProps';

export interface ReadOnlyObjectDisplayProps {
  title: string;
  values: Record<string, unknown>;
  mode: 'read' | 'create' | 'replace' | 'delete';
  changedFields?: string[];
  imageUrl?: string | null;
  objectType?: string;
  contentMarkdown?: string;
}

export const ReadOnlyObjectDisplay: React.FC<ReadOnlyObjectDisplayProps> = ({
  title,
  values,
  mode,
  changedFields,
  imageUrl,
  objectType = 'story_entity',
  contentMarkdown,
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
    <ObjectCard
      name={title}
      description={showDescription ? mapped.description : undefined}
      contentMarkdown={showContent ? (contentMarkdown ?? mapped.contentMarkdown) : undefined}
      imageUrl={imageUrl}
      expanded
      spanType={hasImage ? 'vertical' : 'text-only'}
      className="function-call-readonly-item"
    />
  );
};

export default ReadOnlyObjectDisplay;
