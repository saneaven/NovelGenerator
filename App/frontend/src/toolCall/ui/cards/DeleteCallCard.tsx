import React, { useEffect, useMemo } from 'react';
import { useSettingsStore } from '../../../store/settingsStore';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useAssetStore } from '../../../store/assetStore';
import { getAssetUrl } from '../../../utils/assetUrl';
import { FunctionCallCardShell } from '../FunctionCallCardShell';
import { ReadOnlyStoryObjectDisplay } from '../displays/ReadOnlyStoryObjectDisplay';
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

  const fetchStoryObjectAssets = useAssetStore((state) => state.fetchStoryObjectAssets);
  const getMainAsset = useAssetStore((state) => state.getMainAsset);

  const snapshot = useMemo(
    () => getObjectSnapshot({ operation, objects, projectId, language }),
    [operation, objects, projectId, language]
  );

  useEffect(() => {
    if (!operation.storySubtype || !snapshot.id) return;
    void fetchStoryObjectAssets(projectId, operation.storySubtype, snapshot.id);
  }, [operation.storySubtype, snapshot.id, fetchStoryObjectAssets, projectId]);

  const mainAsset = operation.storySubtype && snapshot.id
    ? getMainAsset(projectId, operation.storySubtype, snapshot.id)
    : null;
  const imageUrl = getAssetUrl(mainAsset);

  const { name, type } = useMemo(
    () => resolveObjectTitle({ operation, objects, projectId, language }),
    [operation, objects, projectId, language]
  );
  const title = name || type;

  const renderBody = () => {
    if (operation.objectType === 'outline' || operation.objectType === 'outline_act' || operation.objectType === 'outline_chapter') {
      const desc = typeof snapshot.data.description === 'string' && snapshot.data.description.trim() ? snapshot.data.description : undefined;
      const body = typeof snapshot.data.content === 'string' && snapshot.data.content.trim() ? snapshot.data.content : undefined;
      return (
        <OutlineItemCard
          variant={toOutlineItemVariant(operation.objectType)}
          name={title || 'Outline'}
          description={desc}
          content={body}
          readOnly
        />
      );
    }

    if (operation.objectType === 'manuscript') {
      return <ReadOnlyManuscriptDisplay title={title || 'Manuscript'} doc={snapshot.data.doc} />;
    }

    return (
      <ReadOnlyStoryObjectDisplay
        title={title || 'Item'}
        values={snapshot.data}
        mode="delete"
        imageUrl={imageUrl}
        objectType={operation.objectType}
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
