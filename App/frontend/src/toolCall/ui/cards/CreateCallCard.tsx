import React, { useMemo } from 'react';
import { useSettingsStore } from '../../../store/settingsStore';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { FunctionCallCardShell } from '../FunctionCallCardShell';
import { ReadOnlyObjectDisplay } from '../displays/ReadOnlyObjectDisplay';
import { OutlineItemCard, toOutlineItemVariant } from '../../../components/OutlineItemCard';
import { ReadOnlyManuscriptDisplay } from '../displays/ReadOnlyManuscriptDisplay';
import { ReadOnlyBasicInfoDisplay } from '../displays/ReadOnlyBasicInfoDisplay';
import type { ObjectCardProps } from './types';
import { pickExistingKeys, pickValues, resolveObjectTitle } from './helpers';

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
      return ['trackId', 'name', 'description', 'content', 'startDate', 'endDate', 'tags'];
    default:
      return pickExistingKeys({} as Record<string, unknown>);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatRecord(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([key, entry]) => `${key}: ${String(entry ?? '')}`)
    .join(', ');
}

function formatStringList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => String(item ?? '').trim()).filter(Boolean);
  return items.length > 0 ? items.join(', ') : undefined;
}

function buildTimelineContentMarkdown(
  objectType: ObjectCardProps['operation']['objectType'],
  fields: Record<string, unknown>
): string | undefined {
  if (objectType !== 'timeline_track' && objectType !== 'timeline_event') {
    return typeof fields.content === 'string' ? fields.content : undefined;
  }

  const content = typeof fields.content === 'string' ? fields.content.trim() : '';
  const details: string[] = [];

  if (objectType === 'timeline_track') {
    if ('parentId' in fields) {
      details.push(`Parent: ${typeof fields.parentId === 'string' && fields.parentId.trim() ? fields.parentId : 'Root'}`);
    }
    if (typeof fields.position === 'number') {
      details.push(`Position: ${fields.position}`);
    }
    if (typeof fields.color === 'string' && fields.color.trim()) {
      details.push(`Color: ${fields.color}`);
    }
  }

  if (objectType === 'timeline_event') {
    if (typeof fields.trackId === 'string' && fields.trackId.trim()) {
      details.push(`Track: ${fields.trackId}`);
    }
    if (isRecord(fields.startDate)) {
      details.push(`Start: ${formatRecord(fields.startDate)}`);
    }
    if ('endDate' in fields) {
      details.push(isRecord(fields.endDate) ? `End: ${formatRecord(fields.endDate)}` : 'End: none');
    }
    const tags = formatStringList(fields.tags);
    if (tags) {
      details.push(`Tags: ${tags}`);
    }
  }

  if (details.length === 0) {
    return content || undefined;
  }

  return [
    content,
    ['**Details**', ...details.map((detail) => `- ${detail}`)].join('\n'),
  ].filter(Boolean).join('\n\n');
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
  const language = useSettingsStore((state) => state.getSettings().mainLanguage);
  const objects = useUnifiedObjectStore((state) => state.objects);

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
        contentMarkdown={buildTimelineContentMarkdown(operation.objectType, fields)}
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
