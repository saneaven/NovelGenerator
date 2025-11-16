import React, { useMemo } from 'react';
import type {
  FunctionCallOperationPreview,
  FunctionCallProgress,
} from '../../../llm_request/types';
import type { StoryObjects, Act, Chapter } from '../../../types/storyObject';

interface FunctionCallPreviewCardProps {
  progress: FunctionCallProgress;
  storyObjects: StoryObjects;
}

const ACTION_LABELS: Record<string, string> = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
};

const TYPE_LABELS: Record<string, string> = {
  basic_info: 'Basic Info',
  character: 'Character',
  organization: 'Organization',
  location: 'Location',
  lorebook: 'Lorebook',
  act: 'Act',
  chapter: 'Chapter',
};

const STATUS_LABELS: Record<FunctionCallProgress['status'], string> = {
  collecting: 'Collecting',
  validating: 'Validating',
  ready: 'Ready',
  error: 'Error',
};

const FunctionCallPreviewCard: React.FC<FunctionCallPreviewCardProps> = ({ progress, storyObjects }) => {
  const operationPreviews = progress.operationPreviews ?? [];
  const displayName = progress.draft.functionName || `Function #${progress.draft.index + 1}`;
  const statusLabel = STATUS_LABELS[progress.status] ?? progress.status;

  return (
    <div className="function-call-preview-item">
      <div className="function-call-preview-header">
        <div className="function-call-preview-title">
          <div className="function-call-preview-name">{displayName}</div>
          <div className="function-call-preview-status">{statusLabel}</div>
        </div>
      </div>

      {operationPreviews.length > 0 ? (
        <div className="function-call-operation-list">
          {operationPreviews.map((operation) => (
            <OperationCard
              key={operation.key}
              operation={operation}
              storyObjects={storyObjects}
            />
          ))}
        </div>
      ) : (
        <div className="function-call-preview-placeholder">
          Waiting for the AI to stream structured arguments...
        </div>
      )}

      {progress.error && (
        <div className="function-call-preview-error">
          Unable to parse the JSON yet. The AI may still be streaming. ({progress.error})
        </div>
      )}
    </div>
  );
};

interface OperationCardProps {
  operation: FunctionCallOperationPreview;
  storyObjects: StoryObjects;
}

const OperationCard: React.FC<OperationCardProps> = ({ operation, storyObjects }) => {
  const resolvedName = useMemo(
    () => operation.targetName ?? resolveStoryObjectName(storyObjects, operation.type, operation.id),
    [operation.targetName, operation.type, operation.id, storyObjects]
  );

  const actionLabel = operation.action ? ACTION_LABELS[operation.action] ?? capitalize(operation.action) : 'Action';
  const typeLabel = operation.type ? TYPE_LABELS[operation.type] ?? humanize(operation.type) : '';
  const headline = [typeLabel, resolvedName].filter(Boolean).join(' - ');
  const fieldItems = operation.fields ?? [];

  return (
    <div className="operation-card operation-card-vertical">
      <div className="operation-card-header">
        <div className="operation-card-badge">
          <span className="operation-card-action">{actionLabel}</span>
          {typeLabel && <span className="operation-card-type">{typeLabel}</span>}
        </div>
      </div>

      {headline && <div className="operation-card-headline">{headline}</div>}

      {operation.summary && (
        <p className="operation-card-summary">{operation.summary}</p>
      )}

      {fieldItems.length > 0 && (
        <div className="operation-card-field-list">
          {fieldItems.map((field) => (
            <div key={field.key} className="operation-card-field-row">
              <span className="operation-card-field-label">{field.label}</span>
              <span className="operation-card-field-value">{field.value}</span>
            </div>
          ))}
        </div>
      )}

      {operation.chapters && operation.chapters.length > 0 && (
        <div className="operation-card-chapters">
          <div className="operation-card-section-title">Chapters</div>
          {operation.chapters.map((chapter, index) => (
            <div key={`${operation.key}-chapter-${index}`} className="operation-card-chapter">
              <div className="operation-card-chapter-title">
                {chapter.title || `Chapter ${index + 1}`}
              </div>
              {chapter.summary && (
                <div className="operation-card-chapter-summary">{chapter.summary}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {operation.missingFields && operation.missingFields.length > 0 && (
        <div className="operation-card-missing">
          Still waiting for required fields: {operation.missingFields.map(humanize).join(', ')}
        </div>
      )}

      {!fieldItems.length && !operation.chapters?.length && operation.rawSnippet && (
        <pre className="operation-card-raw">{operation.rawSnippet}</pre>
      )}
    </div>
  );
};

const humanize = (value?: string) => {
  if (!value) return '';
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/g, (char) => char.toUpperCase());
};

const capitalize = (value?: string) => {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const resolveStoryObjectName = (
  storyObjects: StoryObjects,
  type?: string,
  id?: string
): string | undefined => {
  if (!type || !id) return undefined;

  switch (type) {
    case 'basic_info':
      return storyObjects.basicInfo?.title || storyObjects.basicInfo?.logline;
    case 'character':
      return storyObjects.characters.find((item) => item.id === id)?.name;
    case 'organization':
      return storyObjects.organizations.find((item) => item.id === id)?.name;
    case 'location':
      return storyObjects.locations.find((item) => item.id === id)?.name;
    case 'lorebook':
      return storyObjects.lorebook.find((item) => item.id === id)?.name;
    case 'act':
      return findAct(storyObjects.outline?.acts, id)?.name;
    case 'chapter': {
      const chapter = findChapter(storyObjects.outline?.acts, id);
      return chapter?.name;
    }
    default:
      return undefined;
  }
};

const findAct = (acts: Act[] | undefined, id: string) =>
  acts?.find((act) => act.id === id);

const findChapter = (acts: Act[] | undefined, id: string): Chapter | undefined => {
  if (!acts) return undefined;
  for (const act of acts) {
    const chapter = act.chapters?.find((entry) => entry.id === id);
    if (chapter) {
      return chapter;
    }
  }
  return undefined;
};

export default FunctionCallPreviewCard;
