import React, { useState, useMemo, useCallback, useEffect } from 'react';
import type { EditCard } from '../../chat/types';
import type { FunctionCallOperationPreview } from '../../llm_request/types';
import type { StoryObjects } from '../../types/storyObject';
import { buildOperationPreviewsFromArgs } from '../../chat/utils/functionCallPreview';
import { resolveStoryObjectName, parseFunctionName } from '../../chat/utils/objectNameResolver';
import './GroupedFunctionCallCard.css';

interface GroupedFunctionCallCardProps {
  cards: EditCard[];
  onConfirm: (selections: Record<string, boolean>) => Promise<void>;
  isConfirmed: boolean;
  storyObjects: StoryObjects;
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

const GroupedFunctionCallCard: React.FC<GroupedFunctionCallCardProps> = ({
  cards,
  onConfirm,
  isConfirmed,
  storyObjects,
}) => {
  // Initialize selections: all cards selected by default
  const [selections, setSelections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    cards.forEach(card => {
      initial[card.id] = true;
    });
    return initial;
  });

  // Sync selections when cards change (e.g., streaming adds new cards)
  useEffect(() => {
    setSelections(prev => {
      const updated = { ...prev };
      let hasChanges = false;
      cards.forEach(card => {
        if (!(card.id in updated)) {
          updated[card.id] = true; // New cards default to selected
          hasChanges = true;
        }
      });
      return hasChanges ? updated : prev;
    });
  }, [cards]);

  const [isConfirming, setIsConfirming] = useState(false);

  // Collapsible state: expanded by default when pending, collapsed when confirmed
  const [isExpanded, setIsExpanded] = useState(!isConfirmed);

  // Update expanded state when isConfirmed changes
  useEffect(() => {
    if (isConfirmed) {
      setIsExpanded(false);
    }
  }, [isConfirmed]);

  // Build previews for each card and enrich with resolved names
  const cardsWithPreviews: CardWithPreview[] = useMemo(() => {
    return cards.map(card => {
      const rawPreviews = buildOperationPreviewsFromArgs(card.data);

      // Parse action/type from function name (e.g., "update_character" -> {action: "update", objectType: "character"})
      const functionName = card.functionCall?.function_name;
      const parsed = functionName ? parseFunctionName(functionName) : undefined;

      // Enrich previews with resolved names from storyObjects
      const enrichedPreviews = rawPreviews.map(preview => {
        // Use parsed objectType if preview.type is missing
        const objectType = preview.type || parsed?.objectType;
        const action = preview.action || parsed?.action;
        // For update_manuscript, the ID is in chapterId field
        const objectId = preview.id || card.data?.id || card.data?.chapterId;

        return {
          ...preview,
          type: objectType,
          action,
          id: objectId,
          // Resolve targetName from ID if not already set
          targetName: preview.targetName ?? resolveStoryObjectName(storyObjects, objectType, objectId),
        };
      });

      return {
        card,
        previews: enrichedPreviews,
      };
    });
  }, [cards, storyObjects]);

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
    if (isConfirming || isConfirmed) return;
    setIsConfirming(true);
    try {
      await onConfirm(selections);
    } finally {
      setIsConfirming(false);
    }
  }, [selections, onConfirm, isConfirming, isConfirmed]);

  if (cards.length === 0) {
    return null;
  }

  const statusLabel = isConfirmed ? 'Confirmed' : 'Pending';
  const cardClassName = `grouped-function-call-card ${isConfirmed ? 'confirmed' : 'pending'}`;

  const handleToggleExpand = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  return (
    <div className={cardClassName}>
      <div className="gfcc-header" onClick={handleToggleExpand} role="button" tabIndex={0}>
        <div className="gfcc-header-text">
          <div className="gfcc-eyebrow">
            {isConfirmed ? 'Confirmed Function Calls' : 'Pending Function Calls'}
          </div>
          <div className="gfcc-title">
            {isConfirmed
              ? `Changes applied`
              : 'AI wants to make the following changes'}
          </div>
        </div>
        <div className="gfcc-meta">
          <span className={`gfcc-status gfcc-status--${statusLabel.toLowerCase()}`}>
            {statusLabel}
          </span>
          <span className={`gfcc-toggle ${isExpanded ? 'expanded' : 'collapsed'}`}>
            {isExpanded ? '▼' : '▶'}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="gfcc-content">
          <div className="gfcc-operation-list">
            {cardsWithPreviews.map(({ card, previews }) => {
              // Always use boolean to keep checkbox controlled (undefined would make it uncontrolled)
              const isSelected = isConfirmed
                ? (card.isApplied && !card.isRejected)
                : (selections[card.id] ?? true); // Default to true (apply) if not yet in selections
              const wasRejected = isConfirmed && card.isRejected;
              const wasApplied = isConfirmed && card.isApplied && !card.isRejected;

              return (
                <div
                  key={card.id}
                  className={`gfcc-operation-item ${isSelected ? 'selected' : 'rejected'} ${wasApplied ? 'applied' : ''} ${wasRejected ? 'was-rejected' : ''}`}
                >
                  <div className="gfcc-operation-checkbox">
                    {!isConfirmed ? (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggle(card.id)}
                        disabled={isConfirming}
                      />
                    ) : (
                      <span className={`gfcc-result-icon ${wasRejected ? 'rejected' : 'applied'}`}>
                        {wasRejected ? '✗' : '✓'}
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
                    {card.description && (
                      <div className="gfcc-operation-description">{card.description}</div>
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

          {!isConfirmed && (
            <div className="gfcc-footer">
              <div className="gfcc-summary">
                <span className="gfcc-summary-selected">{selectedCount} selected</span>
                {rejectedCount > 0 && (
                  <span className="gfcc-summary-rejected">, {rejectedCount} will be rejected</span>
                )}
              </div>
              <div className="gfcc-actions">
                <div className="gfcc-bulk-actions">
                  <button
                    className="gfcc-btn gfcc-btn--text"
                    onClick={handleSelectAll}
                    disabled={isConfirming || selectedCount === cards.length}
                  >
                    Select All
                  </button>
                  <button
                    className="gfcc-btn gfcc-btn--text"
                    onClick={handleDeselectAll}
                    disabled={isConfirming || rejectedCount === cards.length}
                  >
                    Deselect All
                  </button>
                </div>
                <button
                  className="gfcc-btn gfcc-btn--primary"
                  onClick={handleConfirm}
                  disabled={isConfirming}
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
  const subline = preview.summary || '';

  return (
    <div className="gfcc-preview-row">
      <div className="gfcc-preview-meta">
        <span className={`gfcc-preview-action action-${preview.action || 'pending'}`}>
          {actionLabel}
        </span>
        {typeLabel && <span className="gfcc-preview-type">{typeLabel}</span>}
      </div>

      {/* Show "Applies to: Name" for updates/deletes */}
      {preview.targetName && (
        <div className="gfcc-preview-target">
          <span className="gfcc-target-label">Applies to:</span>
          <span className="gfcc-target-name">{preview.targetName}</span>
        </div>
      )}

      {subline && <div className="gfcc-preview-subline">{subline}</div>}
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
