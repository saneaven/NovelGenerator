import React, { useEffect, useMemo } from 'react';
import { useSettingsStore } from '../../../store/settingsStore';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useAssetStore } from '../../../store/assetStore';
import { getAssetUrl } from '../../../utils/assetUrl';
import { FunctionCallCardShell } from '../FunctionCallCardShell';
import { ReadOnlyItemDisplay } from '../displays/ReadOnlyItemDisplay';
import { ReadOnlyOutlineItemDisplay } from '../displays/ReadOnlyOutlineItemDisplay';
import { ReadOnlyManuscriptDisplay } from '../displays/ReadOnlyManuscriptDisplay';
import type { ObjectCardProps } from './types';
import { getObjectSnapshot } from './helpers';

export const DeleteCallCard: React.FC<ObjectCardProps> = ({
  threadId,
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
    ? getMainAsset(operation.storySubtype, snapshot.id)
    : null;
  const imageUrl = getAssetUrl(mainAsset);

  const title = snapshot.displayName ? `Delete ${snapshot.displayName}` : operation.title;
  const targetLabel = snapshot.displayName || operation.targetLabel || snapshot.id;

  const renderBody = () => {
    if (operation.objectType === 'outline' || operation.objectType === 'outline_act' || operation.objectType === 'outline_chapter') {
      return (
        <ReadOnlyOutlineItemDisplay
          variant={operation.objectType}
          title={targetLabel || 'Outline'}
          values={snapshot.data}
          mode="delete"
        />
      );
    }

    if (operation.objectType === 'manuscript') {
      return <ReadOnlyManuscriptDisplay title={targetLabel || 'Manuscript'} doc={snapshot.data.doc} />;
    }

    return (
      <ReadOnlyItemDisplay
        title={targetLabel || 'Item'}
        values={snapshot.data}
        mode="delete"
        imageUrl={imageUrl}
      />
    );
  };

  const isDeleted = operation.status === 'accepted';

  return (
    <FunctionCallCardShell
      threadId={threadId}
      cardId={operation.id}
      category="delete"
      status={operation.status}
      title={title}
      targetLabel={targetLabel}
      showDecisionButtons={showDecisionButtons}
      decisionDisabled={decisionDisabled}
      onAccept={onAccept}
      onReject={onReject}
      canToggle={!isDeleted}
      defaultExpanded={!isDeleted && (operation.status === 'pending' || operation.status === 'running')}
    >
      {!isDeleted && renderBody()}
    </FunctionCallCardShell>
  );
};

export default DeleteCallCard;
