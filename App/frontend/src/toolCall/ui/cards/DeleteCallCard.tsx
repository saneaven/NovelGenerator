import React, { useMemo } from 'react';
import { useMainLanguage } from '../../../data/settings';
import { useProjectObjectsMap } from '../../../data/objects/useProjectObjectsMap';
import { useMainAsset } from '../../../data/assets';
import { getAssetUrl } from '../../../utils/assetUrl';
import { FunctionCallCardShell } from '../FunctionCallCardShell';
import { ReadOnlyObjectDisplay } from '../displays/ReadOnlyObjectDisplay';
import { OutlineItemCard, toOutlineItemVariant } from '../../../components/OutlineItemCard';
import { ReadOnlyManuscriptDisplay } from '../displays/ReadOnlyManuscriptDisplay';
import type { ObjectCardProps } from './types';
import { getObjectSnapshot, resolveObjectTitle } from './helpers';
import { useTargetObjectData } from './useTargetObjectData';
import { useTimelineLookup } from './timelineCardData';
import { isTimelineObjectType, renderTimelineBody } from './timelineCardRender';

export const DeleteCallCard: React.FC<ObjectCardProps> = ({
  scopeKey,
  projectId,
  operation,
  showDecisionButtons,
  decisionDisabled,
  onAccept,
  onReject,
}) => {
  const language = useMainLanguage();
  // Summary map: titles/labels/metadata only. Body of the to-be-deleted object
  // (shown pre-deletion only) comes from a single full-content fetch.
  const objects = useProjectObjectsMap(projectId, language);
  const targetData = useTargetObjectData(operation, language);
  const getRichTextMarkdown = (_id: string, _language: string, field: 'content' | 'authorNote'): string | undefined => {
    const value = targetData?.[field];
    return typeof value === 'string' ? value : undefined;
  };
  const timelineLookup = useTimelineLookup(projectId);

  const snapshot = useMemo(
    () => getObjectSnapshot({ operation, objects, projectId, language }),
    [operation, objects, projectId, language]
  );

  const isStoryEntity = operation.objectType === 'story_entity' && Boolean(snapshot.id);
  const mainAsset = useMainAsset(
    projectId,
    isStoryEntity ? 'story_entity' : undefined,
    isStoryEntity ? snapshot.id : undefined,
  );
  const imageUrl = getAssetUrl(mainAsset);

  const { name, type } = useMemo(
    () => resolveObjectTitle({ operation, objects, projectId, language }),
    [operation, objects, projectId, language]
  );
  const title = name || type;

  const renderBody = () => {
    if (isTimelineObjectType(operation.objectType)) {
      return renderTimelineBody({ operation, mode: 'delete', lookup: timelineLookup, language });
    }

    if (operation.objectType === 'outline') {
      const desc = typeof snapshot.data.description === 'string' && snapshot.data.description.trim() ? snapshot.data.description : undefined;
      const body =
        (typeof snapshot.data.content === 'string' && snapshot.data.content.trim() ? snapshot.data.content : undefined)
        ?? (snapshot.id ? getRichTextMarkdown(snapshot.id, language, 'content') : undefined);
      return (
        <OutlineItemCard
          variant={toOutlineItemVariant(operation.objectType, operation.outlineKind ?? snapshot.object?.kind)}
          name={title || 'Outline'}
          description={desc}
          contentMarkdown={body}
          readOnly
        />
      );
    }

    if (operation.objectType === 'manuscript') {
      return (
        <ReadOnlyManuscriptDisplay
          title={title || 'Manuscript'}
          contentMarkdown={
            (typeof snapshot.data.content === 'string' ? snapshot.data.content : undefined)
            ?? (snapshot.id ? getRichTextMarkdown(snapshot.id, language, 'content') : undefined)
          }
        />
      );
    }

    return (
      <ReadOnlyObjectDisplay
        title={title || 'Item'}
        values={snapshot.data}
        mode="delete"
        imageUrl={imageUrl}
        objectType={operation.objectType}
        contentMarkdown={
          operation.objectType === 'guidelines'
            ? (snapshot.id ? getRichTextMarkdown(snapshot.id, language, 'authorNote') : undefined)
            : (snapshot.id ? getRichTextMarkdown(snapshot.id, language, 'content') : undefined)
        }
      />
    );
  };

  const isDeleted = operation.status === 'applied';

  return (
    <FunctionCallCardShell
      scopeKey={scopeKey}
      cardId={operation.id}
      category={operation.category}
      status={operation.status}
      title={title}
      subtitle={operation.status === 'failed' && operation.reason ? operation.reason : undefined}
      showDecisionButtons={showDecisionButtons}
      decisionDisabled={decisionDisabled}
      onAccept={onAccept}
      onReject={onReject}
      canToggle={!isDeleted}
      defaultExpanded={!isDeleted && (operation.status === 'pending' || operation.status === 'processing' || operation.status === 'streaming')}
      islands={isDeleted ? undefined : [renderBody()]}
    />
  );
};

export default DeleteCallCard;
