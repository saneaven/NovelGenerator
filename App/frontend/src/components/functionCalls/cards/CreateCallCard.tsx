import React, { useMemo } from 'react';
import { FunctionCallCardShell } from '../FunctionCallCardShell';
import { ReadOnlyStoryObjectDisplay } from '../displays/ReadOnlyStoryObjectDisplay';
import { OutlineItemCard, toOutlineItemVariant } from '../../OutlineItemCard';
import { ReadOnlyManuscriptDisplay } from '../displays/ReadOnlyManuscriptDisplay';
import type { ObjectCardProps } from './types';
import { pickExistingKeys, pickValues } from './helpers';

function createFieldKeysForObjectType(objectType: ObjectCardProps['operation']['objectType']): string[] {
  switch (objectType) {
    case 'story_object':
      return ['name', 'description', 'content'];
    case 'outline':
      return ['name', 'description', 'content'];
    case 'outline_act':
      return ['outlineId', 'name', 'description', 'content', 'order'];
    case 'outline_chapter':
      return ['actId', 'name', 'description', 'content', 'order'];
    case 'manuscript':
      return ['content'];
    default:
      return pickExistingKeys({} as Record<string, unknown>);
  }
}

export const CreateCallCard: React.FC<ObjectCardProps> = ({
  threadId,
  operation,
  showDecisionButtons,
  decisionDisabled,
  onAccept,
  onReject,
}) => {
  const fields = useMemo(() => {
    const keys = createFieldKeysForObjectType(operation.objectType).filter((key) => key in operation.args);
    return pickValues(operation.args, keys);
  }, [operation]);

  const titleValue = typeof operation.args.name === 'string' && operation.args.name.trim()
    ? operation.args.name
    : operation.targetLabel || operation.title;

  const renderBody = () => {
    if (operation.objectType === 'outline' || operation.objectType === 'outline_act' || operation.objectType === 'outline_chapter') {
      const desc = typeof fields.description === 'string' && fields.description.trim() ? fields.description : undefined;
      const body = typeof fields.content === 'string' && fields.content.trim() ? fields.content : undefined;
      return (
        <OutlineItemCard
          variant={toOutlineItemVariant(operation.objectType)}
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
      threadId={threadId}
      cardId={operation.id}
      category="create"
      status={operation.status}
      title={operation.title}
      targetLabel={titleValue}
      showDecisionButtons={showDecisionButtons}
      decisionDisabled={decisionDisabled}
      onAccept={onAccept}
      onReject={onReject}
      defaultExpanded={operation.status === 'pending' || operation.status === 'running'}
    >
      {renderBody()}
    </FunctionCallCardShell>
  );
};

export default CreateCallCard;
