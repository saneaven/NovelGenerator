import React, { useMemo } from 'react';
import { useMainLanguage } from '../../../data/settings';
import { useProjectObjectsMap } from '../../../data/objects/useProjectObjectsMap';
import { FunctionCallCardShell } from '../FunctionCallCardShell';
import { ReadOnlyObjectDisplay } from '../displays/ReadOnlyObjectDisplay';
import { OutlineItemCard, toOutlineItemVariant } from '../../../components/OutlineItemCard';
import { ReadOnlyManuscriptDisplay } from '../displays/ReadOnlyManuscriptDisplay';
import { ReadOnlyBasicInfoDisplay } from '../displays/ReadOnlyBasicInfoDisplay';
import type { ObjectCardProps } from './types';
import { pickExistingKeys, pickValues, resolveObjectTitle } from './helpers';
import { useTimelineLookup } from './timelineCardData';
import { isTimelineObjectType, renderTimelineBody } from './timelineCardRender';

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
    case 'timeline_track':
      return ['name', 'description', 'content', 'parentId', 'position', 'color'];
    case 'timeline_event':
      return ['trackId', 'name', 'description', 'content', 'startDate', 'endDate', 'tags', 'links'];
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
  const language = useMainLanguage();
  const objects = useProjectObjectsMap(projectId, language);
  const timelineLookup = useTimelineLookup(projectId);

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
    if (isTimelineObjectType(operation.objectType)) {
      return renderTimelineBody({
        operation,
        mode: 'create',
        lookup: timelineLookup,
        objects,
        language,
        values: fields,
        fallbackName: name || undefined,
      });
    }

    if (operation.objectType === 'outline') {
      const desc = typeof fields.description === 'string' && fields.description.trim() ? fields.description : undefined;
      const body = typeof fields.content === 'string' && fields.content.trim() ? fields.content : undefined;
      return (
        <OutlineItemCard
          variant={toOutlineItemVariant(operation.objectType, operation.outlineKind)}
          name={titleValue}
          description={desc}
          contentMarkdown={body}
          readOnly
        />
      );
    }

    if (operation.objectType === 'manuscript') {
      return <ReadOnlyManuscriptDisplay title={titleValue} contentMarkdown={typeof fields.content === 'string' ? fields.content : ''} />;
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
      <ReadOnlyObjectDisplay
        title={titleValue}
        values={fields}
        mode="create"
        objectType={operation.objectType}
        contentMarkdown={typeof fields.content === 'string' ? fields.content : undefined}
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
