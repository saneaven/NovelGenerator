import React, { useState, useMemo, useCallback, useEffect } from 'react';
import type { EditCard } from '../../chat/types';
import type { FunctionCallOperationPreview, FunctionCallProgress } from '../../llm/requestTypes';
import type { StoryObjects } from '../../types/storyObject';
import { buildOperationPreviewsFromArgs } from '../../chat/utils/functionCallPreview';
import { resolveStoryObjectName, parseFunctionName } from '../../chat/utils/objectNameResolver';
import { Expand, Collapse, Check, Close, Warning } from '../icons';
import './GroupedFunctionCallCard.css';

type CardMode = 'streaming' | 'pending' | 'confirmed';

interface GroupedFunctionCallCardProps {
  mode: CardMode;
  cards?: EditCard[];
  streamingProgress?: FunctionCallProgress[];
  onConfirm?: (selections: Record<string, boolean>) => Promise<void>;
  storyObjects: StoryObjects;
  isApplyDisabled?: boolean;
  applyDisabledReason?: string;
}

interface CardWithPreview {
  card: EditCard;
  previews: FunctionCallOperationPreview[];
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

const humanize = (value?: string) => {
  if (!value) return '';
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/g, (char) => char.toUpperCase());
};

const STATUS_LABELS: Record<string, string> = {
  collecting: 'Collecting',
  validating: 'Validating',
  ready: 'Ready',
  error: 'Error',
};

const formatRelativeTime = (timestamp: number) => {
  const diff = Date.now() - timestamp;
  if (Number.isNaN(diff)) return '';
  if (diff < 5_000) return 'Just now';
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const GroupedFunctionCallCard: React.FC<GroupedFunctionCallCardProps> = ({
  mode,
  cards = [],
  streamingProgress = [],
  onConfirm,
  storyObjects,
  isApplyDisabled = false,
  applyDisabledReason,
}) => {
  const isStreaming = mode === 'streaming';
  const isConfirmed = mode === 'confirmed';
  const isPending = mode === 'pending';

  // Initialize selections: all cards selected by default
  const [selections, setSelections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    cards.forEach(card => {
      initial[card.id] = true;
    });
    return initial;
  });

  // Sync selections when cards change - use card IDs as stable dependency
  const cardIds = useMemo(() => cards.map(c => c.id).join(','), [cards]);
  useEffect(() => {
    if (isStreaming) return;
    setSelections(prev => {
      const currentIds = new Set(cards.map(c => c.id));
      const updated = { ...prev };
      let hasChanges = false;
      // Add new cards
      cards.forEach(card => {
        if (!(card.id in updated)) {
          updated[card.id] = true;
          hasChanges = true;
        }
      });
      // Remove stale cards
      Object.keys(updated).forEach(id => {
        if (!currentIds.has(id)) {
          delete updated[id];
          hasChanges = true;
        }
      });
      return hasChanges ? updated : prev;
    });
  }, [cardIds, isStreaming]); // Use stable cardIds string instead of cards array

  const [isConfirming, setIsConfirming] = useState(false);

  // Collapsible state: expanded by default when streaming or pending, collapsed when confirmed
  const [isExpanded, setIsExpanded] = useState(!isConfirmed);

  // Update expanded state when mode changes
  useEffect(() => {
    if (isConfirmed) {
      setIsExpanded(false);
    } else {
      setIsExpanded(true);
    }
  }, [isConfirmed]);

  // Build previews for each card and enrich with resolved names (for pending/confirmed modes)
  const cardsWithPreviews: CardWithPreview[] = useMemo(() => {
    if (isStreaming) return [];
    return cards.map(card => {
      const rawPreviews = buildOperationPreviewsFromArgs(card.data);

      // Parse action/type from function name (e.g., "update_character" -> {action: "update", objectType: "character"})
      const functionName = card.functionCall?.functionName;
      const parsed = functionName ? parseFunctionName(functionName) : undefined;

      // Enrich previews with resolved names from storyObjects
      const enrichedPreviews = rawPreviews.map(preview => {
        // Use parsed objectType if preview.type is missing
        const objectType = preview.type || parsed?.objectType;
        const action = preview.action || parsed?.action;
        // For update_manuscript, the ID is in chapterId field
        const objectId = (preview.id || card.data?.id || card.data?.chapterId) as string | undefined;

        return {
          ...preview,
          type: objectType,
          action,
          id: objectId,
          // Only use resolved name from ID - validates ID actually exists
          targetName: resolveStoryObjectName(storyObjects, objectType, objectId),
        } as FunctionCallOperationPreview;
      });

      return {
        card,
        previews: enrichedPreviews,
      };
    });
  }, [cards, storyObjects, isStreaming]);

  // Build streaming previews (for streaming mode)
  const streamingPreviews = useMemo(() => {
    if (!isStreaming) return [];
    return streamingProgress.map(progress => {
      const functionName = progress.draft.functionName;
      const parsed = functionName ? parseFunctionName(functionName) : undefined;

      // Enrich operation previews with resolved names
      const enrichedPreviews = (progress.operationPreviews ?? []).map(preview => {
        const objectType = preview.type || parsed?.objectType;
        const action = preview.action || parsed?.action;
        const objectId = preview.id;

        return {
          ...preview,
          type: objectType,
          action,
          targetName: preview.targetName ?? resolveStoryObjectName(storyObjects, objectType, objectId),
        };
      });

      return {
        progress,
        functionName: functionName || `Function #${progress.draft.index + 1}`,
        previews: enrichedPreviews,
      };
    });
  }, [streamingProgress, storyObjects, isStreaming]);

  // Calculate selection counts
  const { selectedCount, rejectedCount } = useMemo(() => {
    let selected = 0;
    let rejected = 0;
    cards.forEach(card => {
      if (selections[card.id]) {
        selected++;
      } else {
        rejected++;
      }
    });
    return { selectedCount: selected, rejectedCount: rejected };
  }, [cards, selections]);

  const handleToggle = useCallback((cardId: string) => {
    if (isConfirmed) return;
    setSelections(prev => ({
      ...prev,
      [cardId]: !prev[cardId],
    }));
  }, [isConfirmed]);

  const handleSelectAll = useCallback(() => {
    if (isConfirmed) return;
    const newSelections: Record<string, boolean> = {};
    cards.forEach(card => {
      newSelections[card.id] = true;
    });
    setSelections(newSelections);
  }, [cards, isConfirmed]);

  const handleDeselectAll = useCallback(() => {
    if (isConfirmed) return;
    const newSelections: Record<string, boolean> = {};
    cards.forEach(card => {
      newSelections[card.id] = false;
    });
    setSelections(newSelections);
  }, [cards, isConfirmed]);

  const handleConfirm = useCallback(async () => {
    if (isConfirming || isConfirmed || !onConfirm) return;
    setIsConfirming(true);
    try {
      await onConfirm(selections);
    } finally {
      setIsConfirming(false);
    }
  }, [selections, onConfirm, isConfirming, isConfirmed]);

  // Empty check based on mode
  if (isStreaming && streamingProgress.length === 0) {
    return null;
  }
  if (!isStreaming && cards.length === 0) {
    return null;
  }

  // Get streaming status for header
  const streamingStatus = isStreaming && streamingProgress.length > 0
    ? streamingProgress[0].status
    : undefined;

  const statusLabel = isStreaming
    ? (STATUS_LABELS[streamingStatus ?? 'collecting'] ?? 'Streaming')
    : isConfirmed
      ? 'Confirmed'
      : 'Pending';

  const cardClassName = `grouped-function-call-card ${mode}`;

  const handleToggleExpand = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  return (
    <div className={cardClassName}>
      <div className="gfcc-header" onClick={handleToggleExpand} role="button" tabIndex={0}>
        <div className="gfcc-header-text">
          <div className="gfcc-eyebrow">
            {isStreaming
              ? 'Streaming Function Calls'
              : isConfirmed
                ? 'Confirmed Function Calls'
                : 'Pending Function Calls'}
          </div>
          <div className="gfcc-title">
            {isStreaming
              ? 'AI is generating changes...'
              : isConfirmed
                ? 'Changes applied'
                : 'AI wants to make the following changes'}
          </div>
        </div>
        <div className="gfcc-meta">
          <span className={`gfcc-status gfcc-status--${statusLabel.toLowerCase()}`}>
            {statusLabel}
          </span>
          <span className={`gfcc-toggle ${isExpanded ? 'expanded' : 'collapsed'}`}>
            {isExpanded ? <Collapse size="xs" /> : <Expand size="xs" />}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="gfcc-content">
          <div className="gfcc-operation-list">
            {/* Streaming mode: render streaming previews */}
            {isStreaming && streamingPreviews.map(({ progress, functionName, previews }) => (
              <div
                key={progress.draft.id}
                className={`gfcc-operation-item streaming status-${progress.status}`}
              >
                <div className="gfcc-operation-content">
                  <div className="gfcc-operation-header">
                    <span className="gfcc-operation-title">{functionName}</span>
                    <span className="gfcc-streaming-meta">
                      <span className={`gfcc-streaming-status status-${progress.status}`}>
                        {STATUS_LABELS[progress.status] ?? progress.status}
                      </span>
                      {progress.updatedAt && (
                        <span className="gfcc-streaming-time">
                          {formatRelativeTime(progress.updatedAt)}
                        </span>
                      )}
                    </span>
                  </div>
                  {progress.error && (
                    <div className="gfcc-streaming-error">
                      Unable to parse JSON yet. The AI may still be streaming.
                    </div>
                  )}
                  {previews.length > 0 && (
                    <div className="gfcc-operation-previews">
                      {previews.map((preview, idx) => (
                        <OperationPreviewRow key={preview.key || idx} preview={preview} />
                      ))}
                    </div>
                  )}
                  {previews.length === 0 && !progress.error && (
                    <div className="gfcc-streaming-placeholder">
                      Waiting for the AI to stream structured arguments...
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Pending/Confirmed mode: render cards with previews */}
            {!isStreaming && cardsWithPreviews.map(({ card, previews }) => {
              // Check for errors
              const hasValidationError = !!card.validationError;
              const hasApplyError = !!card.applyError;
              const hasError = hasValidationError || hasApplyError;

              // Always use boolean to keep checkbox controlled (undefined would make it uncontrolled)
              // Cards with validation errors are auto-deselected and cannot be selected
              const isSelected = isConfirmed
                ? (card.isApplied && !card.isRejected)
                : hasValidationError
                  ? false
                  : (selections[card.id] ?? true); // Default to true (apply) if not yet in selections
              const wasRejected = isConfirmed && card.isRejected;
              const wasApplied = isConfirmed && card.isApplied && !card.isRejected;

              return (
                <div
                  key={card.id}
                  className={`gfcc-operation-item ${isSelected ? 'selected' : 'rejected'} ${wasApplied ? 'applied' : ''} ${wasRejected ? 'was-rejected' : ''} ${hasError ? 'has-error' : ''}`}
                >
                  <div className="gfcc-operation-checkbox">
                    {!isConfirmed ? (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggle(card.id)}
                        disabled={isConfirming || hasValidationError}
                      />
                    ) : (
                      <span className={`gfcc-result-icon ${wasRejected ? 'rejected' : 'applied'}`}>
                        {wasRejected ? <Close size="xs" /> : <Check size="xs" />}
                      </span>
                    )}
                  </div>
                  <div className="gfcc-operation-content">
                    <div className="gfcc-operation-header">
                      <span className="gfcc-operation-title">{card.title}</span>
                      {isConfirmed && (
                        <span className={`gfcc-operation-result ${wasRejected ? 'rejected' : 'applied'}`}>
                          {wasRejected ? 'Rejected by user' : 'Applied'}
                        </span>
                      )}
                    </div>
                    {/* Show error banner for validation or apply errors */}
                    {hasError && (
                      <div className="gfcc-error-banner">
                        <Warning size="sm" />
                        <span>{card.validationError || card.applyError}</span>
                      </div>
                    )}
                    {previews.length > 0 && (
                      <div className="gfcc-operation-previews">
                        {previews.map((preview, idx) => (
                          <OperationPreviewRow key={preview.key || idx} preview={preview} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer only for pending mode */}
          {isPending && (
            <div className="gfcc-footer">
              <div className="gfcc-summary">
                <span className="gfcc-summary-selected">{selectedCount} selected</span>
                {rejectedCount > 0 && (
                  <span className="gfcc-summary-rejected">, {rejectedCount} will be rejected</span>
                )}
              </div>
              {isApplyDisabled && applyDisabledReason && (
                <div className="gfcc-warning">{applyDisabledReason}</div>
              )}
              <div className="gfcc-actions">
                <div className="gfcc-bulk-actions">
                  <button
                    className="gfcc-btn gfcc-btn--text"
                    onClick={handleSelectAll}
                    disabled={isConfirming || isApplyDisabled || selectedCount === cards.length}
                  >
                    Select All
                  </button>
                  <button
                    className="gfcc-btn gfcc-btn--text"
                    onClick={handleDeselectAll}
                    disabled={isConfirming || isApplyDisabled || rejectedCount === cards.length}
                  >
                    Deselect All
                  </button>
                </div>
                <button
                  className="gfcc-btn gfcc-btn--primary"
                  onClick={handleConfirm}
                  disabled={isConfirming || isApplyDisabled}
                >
                  {isConfirming ? 'Confirming...' : 'Confirm Changes'}
                </button>
              </div>
            </div>
          )}

          {isConfirmed && (
            <div className="gfcc-footer gfcc-footer--confirmed">
              <div className="gfcc-confirmed-summary">
                {selectedCount > 0 && (
                  <span className="gfcc-confirmed-applied">{selectedCount} applied</span>
                )}
                {rejectedCount > 0 && (
                  <span className="gfcc-confirmed-rejected">{rejectedCount} rejected</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface OperationPreviewRowProps {
  preview: FunctionCallOperationPreview;
}

const OperationPreviewRow: React.FC<OperationPreviewRowProps> = ({ preview }) => {
  const actionLabel = preview.action ? ACTION_LABELS[preview.action] ?? humanize(preview.action) : 'Action';
  const typeLabel = preview.type ? TYPE_LABELS[preview.type] ?? humanize(preview.type) : '';

  return (
    <div className="gfcc-preview-row">
      <div className="gfcc-preview-meta">
        <span className={`gfcc-preview-action action-${preview.action || 'pending'}`}>
          {actionLabel}
        </span>
        {typeLabel && <span className="gfcc-preview-type">{typeLabel}</span>}
      </div>

      {/* Show "Applies to: Name" for updates/deletes (not for create) */}
      {preview.targetName && preview.action !== 'create' && (
        <div className="gfcc-preview-target">
          <span className="gfcc-target-label">Applies to:</span>
          <span className="gfcc-target-name">{preview.targetName}</span>
        </div>
      )}
      {preview.fields && preview.fields.length > 0 && (
        <div className="gfcc-preview-fields">
          {preview.fields.map((field) => (
            <div key={field.key} className="gfcc-preview-field">
              <span className="gfcc-preview-field-label">{field.label}</span>
              <div className="gfcc-preview-field-value">{field.value}</div>
            </div>
          ))}
        </div>
      )}
      {preview.chapters && preview.chapters.length > 0 && (
        <div className="gfcc-preview-chapters">
          <div className="gfcc-preview-chapters-title">Chapters</div>
          <div className="gfcc-preview-chapters-list">
            {preview.chapters.map((chapter, index) => (
              <div key={chapter.name || `chapter-${index}`} className="gfcc-preview-chapter">
                <span className="gfcc-preview-chapter-name">
                  {chapter.name || `Chapter ${index + 1}`}
                </span>
                {chapter.description && (
                  <span className="gfcc-preview-chapter-desc">{chapter.description}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default GroupedFunctionCallCard;
