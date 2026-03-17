import React, { useMemo } from 'react';
import { useSettingsStore } from '../../../store/settingsStore';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { computeChangedFields, pickChangedValues, pickProvidedValues } from './fieldDiff';
import { FunctionCallCardShell } from '../FunctionCallCardShell';
import { ReadOnlyStoryObjectDisplay } from '../displays/ReadOnlyStoryObjectDisplay';
import { OutlineItemCard, toOutlineItemVariant } from '../../../components/OutlineItemCard';
import { ReadOnlyManuscriptDisplay } from '../displays/ReadOnlyManuscriptDisplay';
import { ReadOnlyBasicInfoDisplay } from '../displays/ReadOnlyBasicInfoDisplay';
import type { ObjectCardProps } from './types';
import { getObjectSnapshot, resolveObjectTitle } from './helpers';

function replaceKeysForObjectType(objectType: ObjectCardProps['operation']['objectType']): string[] {
  switch (objectType) {
    case 'basic_info':
      return ['title', 'logline', 'genres', 'tags'];
    case 'guidelines':
      return ['authorNote'];
    case 'story_entity':
      return ['name', 'description', 'content'];
    case 'outline':
      return ['name', 'description', 'content'];
    case 'outline_act':
      return ['name', 'description', 'content', 'order'];
    case 'outline_chapter':
      return ['actId', 'name', 'description', 'content', 'order'];
    case 'manuscript':
      return ['content'];
    default:
      return [];
  }
}

function metadataMapForObjectType(objectType: ObjectCardProps['operation']['objectType']): Record<string, string> {
  switch (objectType) {
    case 'outline_act':
      return { order: 'order' };
    case 'outline_chapter':
      return {
        actId: 'act_id',
        order: 'order',
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
  const language = useSettingsStore((state) => state.getSettings().mainLanguage);
  const objects = useUnifiedObjectStore((state) => state.objects);

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
            currentData: snapshot.data,
            currentMetadata: snapshot.metadata,
            keys: replaceKeys,
            metadataKeys: metadataMapForObjectType(operation.objectType),
          }),
    [isFinalized, operation.args, operation.objectType, snapshot.data, snapshot.metadata, replaceKeys]
  );

  const changedValues = useMemo(
    () =>
      isFinalized
        ? pickProvidedValues(operation.args, replaceKeys)
        : pickChangedValues(operation.args, changedFields),
    [isFinalized, operation.args, changedFields, replaceKeys]
  );

  const { name: resolvedName, type: resolvedType } = useMemo(
    () => resolveObjectTitle({ operation, objects, projectId, language }),
    [operation, objects, projectId, language]
  );
  const targetLabel = resolvedName || resolvedType;
  const title = `${resolvedType}${changedFields.length > 0 ? ` (${changedFields.length})` : ''}`;

  const renderBody = () => {
    if (operation.objectType === 'outline' || operation.objectType === 'outline_act' || operation.objectType === 'outline_chapter') {
      const newName = typeof changedValues.name === 'string' && changedValues.name.trim()
        ? changedValues.name
        : undefined;
      const desc = typeof changedValues.description === 'string' && changedValues.description.trim() ? changedValues.description : undefined;
      const body = typeof changedValues.content === 'string' && changedValues.content.trim() ? changedValues.content : undefined;

      const metaParts: string[] = [];
      if (changedFields.includes('order') && changedValues.order != null) {
        metaParts.push(`Order: ${changedValues.order}`);
      }
      if (changedFields.includes('actId') && typeof changedValues.actId === 'string') {
        metaParts.push('Act reassigned');
      }
      const meta = metaParts.length > 0 ? metaParts.join(' | ') : undefined;

      return (
        <OutlineItemCard
          variant={toOutlineItemVariant(operation.objectType)}
          name={newName || targetLabel || 'Outline'}
          description={desc}
          content={body}
          meta={meta}
          readOnly
        />
      );
    }

    if (operation.objectType === 'manuscript') {
      return (
        <ReadOnlyManuscriptDisplay
          title={targetLabel || 'Manuscript'}
          content={typeof changedValues.content === 'string' ? changedValues.content : ''}
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
      <ReadOnlyStoryObjectDisplay
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
