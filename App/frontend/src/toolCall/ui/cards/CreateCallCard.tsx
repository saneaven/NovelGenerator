import React, { useMemo } from 'react';
import { useSettingsStore } from '../../../store/settingsStore';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { FunctionCallCardShell } from '../FunctionCallCardShell';
import { ReadOnlyStoryObjectDisplay } from '../displays/ReadOnlyStoryObjectDisplay';
import { OutlineItemCard, toOutlineItemVariant } from '../../../components/OutlineItemCard';
import { ReadOnlyManuscriptDisplay } from '../displays/ReadOnlyManuscriptDisplay';
import { ReadOnlyBasicInfoDisplay } from '../displays/ReadOnlyBasicInfoDisplay';
import type { ObjectCardProps } from './types';
import { pickExistingKeys, pickValues, resolveObjectTitle } from './helpers';

function createFieldKeysForObjectType(objectType: ObjectCardProps['operation']['objectType']): string[] {
  switch (objectType) {
    case 'basic_info':
      return ['title', 'logline', 'genres', 'tags'];
    case 'story_entity_folder':
      return ['name', 'description', 'parentId'];
    case 'story_entity':
      return ['name', 'description', 'content'];
    case 'outline':
      return ['kind', 'parentId', 'position', 'name', 'description', 'content'];
    case 'manuscript':
      return ['content'];
    default:
      return pickExistingKeys({} as Record<string, unknown>);
  }
}

export const CreateCallCard: React.FC<ObjectCardProps> = ({
  scopeKey,
  projectId,
  operation,
  showDecisionButtons,
  decisionDisabled,
  onAccept,
  onReject,
}) => {
  const language = useSettingsStore((state) => state.getSettings().mainLanguage);
  const objects = useUnifiedObjectStore((state) => state.objects);

  const fields = useMemo(() => {
    const keys = createFieldKeysForObjectType(operation.objectType).filter((key) => key in operation.args);
    return pickValues(operation.args, keys);
  }, [operation]);

  const { name, type } = useMemo(
    () => resolveObjectTitle({ operation, objects, projectId, language }),
    [operation, objects, projectId, language]
  );
  const titleValue = name || type;

  const renderBody = () => {
    if (operation.objectType === 'outline') {
      const desc = typeof fields.description === 'string' && fields.description.trim() ? fields.description : undefined;
      const body = typeof fields.content === 'string' && fields.content.trim() ? fields.content : undefined;
      return (
        <OutlineItemCard
          variant={toOutlineItemVariant(operation.objectType, operation.outlineKind)}
          name={titleValue}
          description={desc}
          content={body}
          readOnly
        />
      );
    }

    if (operation.objectType === 'manuscript') {
      return <ReadOnlyManuscriptDisplay title={titleValue} content={typeof fields.content === 'string' ? fields.content : ''} />;
    }

    if (operation.objectType === 'basic_info') {
      return (
        <ReadOnlyBasicInfoDisplay
          title={typeof fields.title === 'string' ? fields.title : undefined}
          logline={typeof fields.logline === 'string' ? fields.logline : undefined}
          genres={Array.isArray(fields.genres) ? fields.genres as string[] : undefined}
          tags={Array.isArray(fields.tags) ? fields.tags as string[] : undefined}
          mode="create"
        />
      );
    }

    return (
      <ReadOnlyStoryObjectDisplay
        title={titleValue}
        values={fields}
        mode="create"
        objectType={operation.objectType}
      />
    );
  };

  return (
    <FunctionCallCardShell
      scopeKey={scopeKey}
      cardId={operation.id}
      category={operation.category}
      status={operation.status}
      title={titleValue}
      subtitle={operation.status === 'failed' && operation.reason ? operation.reason : undefined}
      showDecisionButtons={showDecisionButtons}
      decisionDisabled={decisionDisabled}
      onAccept={onAccept}
      onReject={onReject}
      defaultExpanded={operation.status === 'pending' || operation.status === 'processing' || operation.status === 'streaming'}
      islands={[renderBody()]}
    />
  );
};

export default CreateCallCard;
