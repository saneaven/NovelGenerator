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
import { useTimelineLookup } from './timelineCardData';
import { isTimelineObjectType, renderTimelineBody } from './timelineCardRender';

function isOffset(value: unknown): value is { from?: number; to?: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return 'from' in value || 'to' in value;
}

function getResultObjectContent(result: ObjectCardProps['operation']['result']): string | undefined {
  const data = result?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const object = (data as Record<string, unknown>).object;
  if (!object || typeof object !== 'object' || Array.isArray(object)) return undefined;
  const content = (object as Record<string, unknown>).content;
  return typeof content === 'string' ? content : undefined;
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
  const getRichTextMarkdown = useUnifiedObjectStore((state) => state.getRichTextMarkdown);
  const timelineLookup = useTimelineLookup(projectId);

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
    if (isTimelineObjectType(operation.objectType)) {
      return renderTimelineBody({ operation, mode: 'read', lookup: timelineLookup, language });
    }

    if (operation.objectType === 'outline') {
      const desc = typeof snapshot.data.description === 'string' && snapshot.data.description.trim() ? snapshot.data.description : undefined;
      const body = snapshot.id ? getRichTextMarkdown(snapshot.id, language, 'content') : undefined;
      return (
        <OutlineItemCard
          variant={toOutlineItemVariant(operation.objectType, operation.outlineKind ?? snapshot.object?.kind)}
          name={snapshot.displayName || 'Outline'}
          description={desc}
          contentMarkdown={body}
          readOnly
        />
      );
    }

    if (operation.objectType === 'manuscript') {
      const offset = isOffset(operation.args.offset) ? operation.args.offset : null;
      const resultContent = getResultObjectContent(operation.result);
      const storedContent = (typeof snapshot.data.content === 'string' ? snapshot.data.content : undefined)
        ?? (snapshot.id ? getRichTextMarkdown(snapshot.id, language, 'content') : undefined);
      const resultText = typeof operation.result?.message === 'string' ? operation.result.message : undefined;
      return (
        <ReadOnlyManuscriptDisplay
          title={snapshot.displayName || 'Manuscript'}
          contentMarkdown={
            (offset ? resultContent : storedContent)
            ?? (offset ? storedContent : resultContent)
            ?? resultText
          }
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
        contentMarkdown={
          operation.objectType === 'guidelines'
            ? (snapshot.id ? getRichTextMarkdown(snapshot.id, language, 'authorNote') : undefined)
            : (snapshot.id ? getRichTextMarkdown(snapshot.id, language, 'content') : undefined)
        }
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
