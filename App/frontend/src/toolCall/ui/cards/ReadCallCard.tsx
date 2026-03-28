import React, { useEffect, useMemo } from 'react';
import { useSettingsStore } from '../../../store/settingsStore';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useAssetStore } from '../../../store/assetStore';
import { getAssetUrl } from '../../../utils/assetUrl';
import { FunctionCallCardShell } from '../FunctionCallCardShell';
import { ReadOnlyObjectDisplay } from '../displays/ReadOnlyObjectDisplay';
import { OutlineItemCard, toOutlineItemVariant } from '../../../components/OutlineItemCard';
import { ReadOnlyManuscriptDisplay } from '../displays/ReadOnlyManuscriptDisplay';
import { ReadOnlyBasicInfoDisplay } from '../displays/ReadOnlyBasicInfoDisplay';
import type { ObjectCardProps } from './types';
import { getObjectSnapshot } from './helpers';

function isOffset(value: unknown): value is { from?: number; to?: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return 'from' in value || 'to' in value;
}

export const ReadCallCard: React.FC<ObjectCardProps> = ({
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

  const fetchObjectAssetLinks = useAssetStore((state) => state.fetchObjectAssetLinks);
  const getMainAsset = useAssetStore((state) => state.getMainAsset);

  const snapshot = useMemo(
    () => getObjectSnapshot({ operation, objects, projectId, language }),
    [operation, objects, projectId, language]
  );

  const canLoadStoryAsset = Boolean(operation.objectType === 'story_entity' && snapshot.id && projectId);
  useEffect(() => {
    if (!canLoadStoryAsset || !snapshot.id) return;
    void fetchObjectAssetLinks(projectId, 'story_entity', snapshot.id);
  }, [canLoadStoryAsset, snapshot.id, projectId, fetchObjectAssetLinks]);

  const mainAsset = operation.objectType === 'story_entity' && snapshot.id
    ? getMainAsset(projectId, 'story_entity', snapshot.id)
    : null;
  const imageUrl = getAssetUrl(mainAsset);

  const title = snapshot.displayName || operation.title;

  const renderBody = () => {
    if (operation.objectType === 'outline') {
      const desc = typeof snapshot.data.description === 'string' && snapshot.data.description.trim() ? snapshot.data.description : undefined;
      const body = typeof snapshot.data.content === 'string' && snapshot.data.content.trim() ? snapshot.data.content : undefined;
      return (
        <OutlineItemCard
          variant={toOutlineItemVariant(operation.objectType, operation.outlineKind ?? snapshot.object?.kind)}
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
          content={typeof snapshot.data.content === 'string' ? snapshot.data.content : resultText}
          doc={snapshot.data.content}
          offset={offset}
        />
      );
    }

    if (operation.objectType === 'basic_info') {
      return (
        <ReadOnlyBasicInfoDisplay
          title={typeof snapshot.data.title === 'string' ? snapshot.data.title : undefined}
          logline={typeof snapshot.data.logline === 'string' ? snapshot.data.logline : undefined}
          genres={Array.isArray(snapshot.data.genres) ? snapshot.data.genres as string[] : undefined}
          tags={Array.isArray(snapshot.data.tags) ? snapshot.data.tags as string[] : undefined}
          mode="read"
        />
      );
    }

    return (
      <ReadOnlyObjectDisplay
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
      defaultExpanded={operation.status === 'streaming' || operation.status === 'processing' || operation.status === 'pending'}
      islands={[renderBody()]}
    />
  );
};

export default ReadCallCard;
