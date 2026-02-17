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
import { getObjectSnapshot } from './helpers';

function isOffset(value: unknown): value is { from?: number; to?: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return 'from' in value || 'to' in value;
}

export const ReadCallCard: React.FC<ObjectCardProps> = ({
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

  const canLoadStoryAsset = Boolean(operation.storySubtype && snapshot.id && projectId);
  useEffect(() => {
    if (!canLoadStoryAsset || !operation.storySubtype || !snapshot.id) return;
    void fetchStoryObjectAssets(projectId, operation.storySubtype, snapshot.id);
  }, [canLoadStoryAsset, operation.storySubtype, snapshot.id, projectId, fetchStoryObjectAssets]);

  const mainAsset = operation.storySubtype && snapshot.id
    ? getMainAsset(operation.storySubtype, snapshot.id)
    : null;
  const imageUrl = getAssetUrl(mainAsset);

  const title = snapshot.displayName || operation.title;

  const renderBody = () => {
    if (operation.objectType === 'outline' || operation.objectType === 'outline_act' || operation.objectType === 'outline_chapter') {
      const desc = typeof snapshot.data.description === 'string' && snapshot.data.description.trim() ? snapshot.data.description : undefined;
      const body = typeof snapshot.data.content === 'string' && snapshot.data.content.trim() ? snapshot.data.content : undefined;
      return (
        <OutlineItemCard
          variant={toOutlineItemVariant(operation.objectType)}
          name={snapshot.displayName || 'Outline'}
          description={desc}
          content={body}
          readOnly
        />
      );
    }

    if (operation.objectType === 'manuscript') {
      const offset = isOffset(operation.args.offset) ? operation.args.offset : null;
      const resultText = typeof operation.result?.message === 'string' ? operation.result.message : undefined;
      return (
        <ReadOnlyManuscriptDisplay
          title={snapshot.displayName || 'Manuscript'}
          content={resultText}
          doc={snapshot.data.doc}
          offset={offset}
        />
      );
    }

    return (
      <ReadOnlyStoryObjectDisplay
        title={snapshot.displayName || 'Item'}
        values={snapshot.data}
        mode="read"
        imageUrl={imageUrl}
        objectType={operation.objectType}
      />
    );
  };

  return (
    <FunctionCallCardShell
      threadId={threadId}
      cardId={operation.id}
      category="read"
      status={operation.status}
      title={title}
      subtitle={operation.status === 'failed' && operation.reason ? operation.reason : undefined}
      showDecisionButtons={showDecisionButtons}
      decisionDisabled={decisionDisabled}
      onAccept={onAccept}
      onReject={onReject}
      defaultExpanded={operation.status === 'streaming' || operation.status === 'processing' || operation.status === 'pending'}
      islands={[renderBody()]}
    />
  );
};

export default ReadCallCard;
