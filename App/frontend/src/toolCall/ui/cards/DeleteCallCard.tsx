import React, { useEffect, useMemo } from 'react';
import { useSettingsStore } from '../../../store/settingsStore';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useAssetStore } from '../../../store/assetStore';
import { getAssetUrl } from '../../../utils/assetUrl';
import { FunctionCallCardShell } from '../FunctionCallCardShell';
import { ReadOnlyObjectDisplay } from '../displays/ReadOnlyObjectDisplay';
import { OutlineItemCard, toOutlineItemVariant } from '../../../components/OutlineItemCard';
import { ReadOnlyManuscriptDisplay } from '../displays/ReadOnlyManuscriptDisplay';
import type { ObjectCardProps } from './types';
import { getObjectSnapshot, resolveObjectTitle } from './helpers';

export const DeleteCallCard: React.FC<ObjectCardProps> = ({
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
  const getRichTextMarkdown = useUnifiedObjectStore((state) => state.getRichTextMarkdown);

  const fetchObjectAssetLinks = useAssetStore((state) => state.fetchObjectAssetLinks);
  const getMainAsset = useAssetStore((state) => state.getMainAsset);

  const snapshot = useMemo(
    () => getObjectSnapshot({ operation, objects, projectId, language }),
    [operation, objects, projectId, language]
  );

  useEffect(() => {
    if (operation.objectType !== 'story_entity' || !snapshot.id) return;
    void fetchObjectAssetLinks(projectId, 'story_entity', snapshot.id);
  }, [operation.objectType, snapshot.id, fetchObjectAssetLinks, projectId]);

  const mainAsset = operation.objectType === 'story_entity' && snapshot.id
    ? getMainAsset(projectId, 'story_entity', snapshot.id)
    : null;
  const imageUrl = getAssetUrl(mainAsset);

  const { name, type } = useMemo(
    () => resolveObjectTitle({ operation, objects, projectId, language }),
    [operation, objects, projectId, language]
  );
  const title = name || type;

  const renderBody = () => {
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
