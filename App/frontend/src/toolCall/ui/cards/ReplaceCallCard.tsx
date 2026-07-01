import React, { useMemo } from 'react';
import { useMainLanguage } from '../../../data/settings';
import { useProjectObjectsMap } from '../../../data/objects/useProjectObjectsMap';
import { computeChangedFields, pickChangedValues, pickProvidedValues } from './fieldDiff';
import { FunctionCallCardShell } from '../FunctionCallCardShell';
import { ReadOnlyObjectDisplay } from '../displays/ReadOnlyObjectDisplay';
import { OutlineItemCard, toOutlineItemVariant } from '../../../components/OutlineItemCard';
import { ReadOnlyManuscriptDisplay } from '../displays/ReadOnlyManuscriptDisplay';
import { ReadOnlyBasicInfoDisplay } from '../displays/ReadOnlyBasicInfoDisplay';
import type { ObjectCardProps } from './types';
import { getObjectSnapshot, resolveObjectTitle } from './helpers';
import { useTargetObjectData } from './useTargetObjectData';
import { useTimelineLookup } from './timelineCardData';
import { isTimelineObjectType, renderTimelineBody } from './timelineCardRender';

function replaceKeysForObjectType(objectType: ObjectCardProps['operation']['objectType']): string[] {
  switch (objectType) {
    case 'basic_info':
      return ['title', 'logline', 'genres', 'tags'];
    case 'guidelines':
      return ['authorNote'];
    case 'story_entity_folder':
      return ['name', 'description', 'parentId', 'position'];
    case 'story_entity':
      return ['name', 'description', 'content'];
    case 'outline':
      return ['name', 'description', 'content', 'parentId', 'position'];
    case 'manuscript':
      return ['content'];
    case 'timeline_track':
      return ['name', 'description', 'content', 'parentId', 'position', 'color'];
    case 'timeline_event':
      return ['trackId', 'name', 'description', 'content', 'startDate', 'endDate', 'tags', 'links'];
    default:
      return [];
  }
}

function metadataMapForObjectType(objectType: ObjectCardProps['operation']['objectType']): Record<string, string> {
  switch (objectType) {
    case 'story_entity_folder':
      return {
        parentId: 'parent_id',
        position: 'display_order',
      };
    case 'outline':
      return {
        parentId: 'parent_id',
        position: 'position',
      };
    default:
      return {};
  }
}

export const ReplaceCallCard: React.FC<ObjectCardProps> = ({
  scopeKey,
  projectId,
  operation,
  showDecisionButtons,
  decisionDisabled,
  onAccept,
  onReject,
}) => {
  const language = useMainLanguage();
  // Summary map: titles/labels/metadata only. The field diff compares args
  // against the target's CURRENT body, which needs full content — fetched as a
  // single object below (not the whole project).
  const objects = useProjectObjectsMap(projectId, language);
  const targetData = useTargetObjectData(operation, language);

  const snapshot = useMemo(
    () => getObjectSnapshot({ operation, objects, projectId, language }),
    [operation, objects, projectId, language]
  );

  const replaceKeys = useMemo(() => replaceKeysForObjectType(operation.objectType), [operation.objectType]);

  const isFinalized = operation.status === 'applied' || operation.status === 'rejected';

  const changedFields = useMemo(
    () =>
      isFinalized
        ? replaceKeys.filter((key) => key in operation.args)
        : computeChangedFields({
            args: operation.args,
            currentData: targetData ?? snapshot.data,
            currentMetadata: snapshot.metadata,
            keys: replaceKeys,
            metadataKeys: metadataMapForObjectType(operation.objectType),
          }),
    [isFinalized, operation.args, operation.objectType, targetData, snapshot.data, snapshot.metadata, replaceKeys]
  );

  const changedValues = useMemo(
    () =>
      isFinalized
        ? pickProvidedValues(operation.args, replaceKeys)
        : pickChangedValues(operation.args, changedFields),
    [isFinalized, operation.args, changedFields, replaceKeys]
  );

  const timelineLookup = useTimelineLookup(projectId);

  const { name: resolvedName, type: resolvedType } = useMemo(
    () => resolveObjectTitle({ operation, objects, projectId, language }),
    [operation, objects, projectId, language]
  );
  const targetLabel = resolvedName || resolvedType;
  const title = `${resolvedType}${changedFields.length > 0 ? ` (${changedFields.length})` : ''}`;

  const renderBody = () => {
    if (isTimelineObjectType(operation.objectType)) {
      return renderTimelineBody({
        operation,
        mode: 'replace',
        lookup: timelineLookup,
        language,
        values: changedValues,
        changedFields,
        fallbackName: targetLabel || undefined,
      });
    }

    if (operation.objectType === 'outline') {
      const newName = typeof changedValues.name === 'string' && changedValues.name.trim()
        ? changedValues.name
        : undefined;
      const desc = typeof changedValues.description === 'string' && changedValues.description.trim() ? changedValues.description : undefined;
      const body = typeof changedValues.content === 'string' && changedValues.content.trim() ? changedValues.content : undefined;

      const metaParts: string[] = [];
      if (changedFields.includes('position') && changedValues.position != null) {
        metaParts.push(`Position: ${changedValues.position}`);
      }
      if (changedFields.includes('parentId')) {
        metaParts.push(typeof changedValues.parentId === 'string' ? 'Parent reassigned' : 'Moved to root');
      }
      const meta = metaParts.length > 0 ? metaParts.join(' | ') : undefined;

      return (
        <OutlineItemCard
          variant={toOutlineItemVariant(operation.objectType, operation.outlineKind)}
          name={newName || targetLabel || 'Outline'}
          description={desc}
          contentMarkdown={body}
          meta={meta}
          readOnly
        />
      );
    }

    if (operation.objectType === 'manuscript') {
      return (
        <ReadOnlyManuscriptDisplay
          title={targetLabel || 'Manuscript'}
          contentMarkdown={typeof changedValues.content === 'string' ? changedValues.content : ''}
        />
      );
    }

    if (operation.objectType === 'basic_info') {
      return (
        <ReadOnlyBasicInfoDisplay
          title={typeof changedValues.title === 'string' ? changedValues.title : undefined}
          logline={typeof changedValues.logline === 'string' ? changedValues.logline : undefined}
          genres={Array.isArray(changedValues.genres) ? changedValues.genres as string[] : undefined}
          tags={Array.isArray(changedValues.tags) ? changedValues.tags as string[] : undefined}
          mode="replace"
          changedFields={changedFields}
        />
      );
    }

    const displayTitle =
      (typeof changedValues.name === 'string' && changedValues.name.trim())
        ? changedValues.name
        : (targetLabel || 'Item');

    return (
      <ReadOnlyObjectDisplay
        title={displayTitle}
        values={changedValues}
        mode="replace"
        changedFields={changedFields}
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
      title={title}
      subtitle={
        operation.status === 'failed' && operation.reason
          ? operation.reason
          : changedFields.length === 0
            ? 'No effective field changes'
            : undefined
      }
      showDecisionButtons={showDecisionButtons}
      decisionDisabled={decisionDisabled}
      onAccept={onAccept}
      onReject={onReject}
      defaultExpanded={operation.status === 'pending' || operation.status === 'processing' || operation.status === 'streaming'}
      islands={[renderBody()]}
    />
  );
};

export default ReplaceCallCard;
