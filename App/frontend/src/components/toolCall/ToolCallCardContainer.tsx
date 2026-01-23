import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getToolDisplayName } from '../../toolCall';
import type { ToolCallProgress } from '../../llm/requestTypes';
import { resolveStoryObjectName } from '../../agent/utils/objectNameResolver';
import { useStoryObjects } from '../../store/unifiedObjectStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { ToolCallCardContainerProps, CardMode } from './types';
import { useCardSelection } from './hooks';
import { OperationItem } from './OperationItem';
import './ToolCallCard.css';

function getAction(toolName: string): string | undefined {
  if (!toolName) return undefined;
  if (toolName.startsWith('create_')) return 'create';
  if (toolName.startsWith('delete_')) return 'delete';
  if (toolName.startsWith('replace_')) return 'replace';
  if (toolName.startsWith('patch_')) return 'patch';
  if (toolName.startsWith('set_')) return 'set';
  if (toolName.startsWith('read_')) return 'read';
  return undefined;
}

function getType(toolName: string, args: Record<string, unknown> | undefined): string | undefined {
  const argType = args?.type;
  if (typeof argType === 'string' && argType.trim()) return argType;

  if (toolName.includes('basic_info')) return 'basic_info';
  if (toolName.includes('manuscript')) return 'manuscript';
  if (toolName.includes('outline_act')) return 'act';
  if (toolName.includes('outline_chapter')) return 'chapter';
  if (toolName.includes('outline')) return 'outline';
  if (toolName.includes('story_object')) return 'story_object';

  return undefined;
}

function getTargetId(type: string | undefined, args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;

  if (type === 'manuscript') {
    const chapterId = args.chapterId;
    if (typeof chapterId === 'string' && chapterId.trim()) return chapterId;
  }

  const id = args.id;
  if (typeof id === 'string' && id.trim()) return id;

  const chapterId = args.chapterId;
  if (typeof chapterId === 'string' && chapterId.trim()) return chapterId;

  const actId = args.actId;
  if (typeof actId === 'string' && actId.trim()) return actId;

  const outlineId = args.outlineId;
  if (typeof outlineId === 'string' && outlineId.trim()) return outlineId;

  return undefined;
}

function getLabel(params: {
  toolName: string;
  fallbackTitle: string;
  action?: string;
  type?: string;
  args?: Record<string, unknown>;
  storyObjects: ReturnType<typeof useStoryObjects>;
}): string {
  const { toolName, fallbackTitle, action, type, args, storyObjects } = params;

  // Create operations should show the provided name/title when present.
  if (action === 'create') {
    const name = args?.name;
    if (typeof name === 'string' && name.trim()) return name;
    const title = args?.title;
    if (typeof title === 'string' && title.trim()) return title;
  }

  const targetId = getTargetId(type, args);
  const resolved = resolveStoryObjectName(storyObjects, type, targetId);
  if (resolved) return resolved;

  const name = args?.name;
  if (typeof name === 'string' && name.trim()) return name;

  const title = args?.title;
  if (typeof title === 'string' && title.trim()) return title;

  if (!fallbackTitle.trim()) return toolName || 'Tool call';
  return fallbackTitle;
}

function modeLabel(mode: CardMode): string {
  switch (mode) {
    case 'streaming':
      return 'Streaming';
    case 'pending':
      return 'Pending';
    case 'confirmed':
      return 'Completed';
    default:
      return mode;
  }
}

export const ToolCallCardContainer: React.FC<ToolCallCardContainerProps> = ({
  mode,
  cards = [],
  streamingProgress = [],
  onConfirm,
  onConfirmAndPause,
  projectId,
  isApplyDisabled = false,
  applyDisabledReason,
}) => {
  const mainLanguage = useSettingsStore(state => state.settings.mainLanguage);
  const storyObjects = useStoryObjects(projectId, mainLanguage);

  const isStreaming = mode === 'streaming';
  const isPending = mode === 'pending';

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isCardCollapsed, setIsCardCollapsed] = useState(false);

  const handleToggleCardCollapse = useCallback(() => {
    setIsCardCollapsed(prev => !prev);
  }, []);

  // Auto-collapse when mode changes to 'confirmed'
  useEffect(() => {
    if (mode === 'confirmed') {
      setIsCardCollapsed(true);
    }
  }, [mode]);

  // Selection is only relevant for pending mode
  const selectionDisabled = !isPending || isConfirming || isApplyDisabled;
  const {
    selections,
    selectedCount,
    toggleSelection,
  } = useCardSelection(cards, selectionDisabled);

  // Auto-expand the most recently updated streaming operation.
  const activeStreamingId = useMemo(() => {
    if (!isStreaming || streamingProgress.length === 0) return null;
    let best = streamingProgress[0];
    for (const p of streamingProgress) {
      if ((p.updatedAt ?? 0) > (best.updatedAt ?? 0)) {
        best = p;
      }
    }
    return best?.draft?.id ?? null;
  }, [isStreaming, streamingProgress]);

  useEffect(() => {
    if (isStreaming) {
      setExpandedId(activeStreamingId);
      return;
    }
    // Reset when leaving streaming or changing modes
    setExpandedId(null);
  }, [isStreaming, activeStreamingId, mode]);

  const handleToggleExpanded = useCallback((id: string) => {
    if (isStreaming) return;
    setExpandedId(prev => (prev === id ? null : id));
  }, [isStreaming]);

  const handleConfirm = useCallback(async () => {
    if (!onConfirm || isConfirming || !isPending) return;
    setIsConfirming(true);
    try {
      await onConfirm(selections);
    } finally {
      setIsConfirming(false);
    }
  }, [onConfirm, isConfirming, isPending, selections]);

  const handleConfirmAndPause = useCallback(async () => {
    if (!onConfirmAndPause || isConfirming || !isPending) return;
    setIsConfirming(true);
    try {
      await onConfirmAndPause(selections);
    } finally {
      setIsConfirming(false);
    }
  }, [onConfirmAndPause, isConfirming, isPending, selections]);

  if (isStreaming && streamingProgress.length === 0) return null;
  if (!isStreaming && cards.length === 0) return null;

  const itemCount = isStreaming ? streamingProgress.length : cards.length;

  return (
    <div className={`tool-call-card tool-call-card--${mode}${isCardCollapsed ? ' tool-call-card--collapsed' : ''}`}>
      <button
        type="button"
        className="tool-call-card__header"
        onClick={handleToggleCardCollapse}
      >
        <div className="tool-call-card__header-left">
          <div className="tool-call-card__title">AI Changes</div>
          <div className="tool-call-card__count">{itemCount}</div>
        </div>
        <div className="tool-call-card__header-right">
          <div className={`tool-call-pill tool-call-pill--${mode}`}>{modeLabel(mode)}</div>
          <svg
            className={`tool-call-card__chevron${isCardCollapsed ? '' : ' tool-call-card__chevron--open'}`}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      <div className={`tool-call-card__list${isCardCollapsed ? ' tool-call-card__list--collapsed' : ''}`}>
        {isStreaming && streamingProgress.map((p: ToolCallProgress) => {
          const toolName = p.draft.toolName || '';
          const args = (p.preview && typeof p.preview === 'object') ? (p.preview as Record<string, unknown>) : undefined;
          const action = getAction(toolName);
          const type = getType(toolName, args);
          const label = getLabel({
            toolName,
            fallbackTitle: getToolDisplayName(toolName),
            action,
            type,
            args,
            storyObjects,
          });

          return (
            <OperationItem
              key={p.draft.id}
              mode={mode}
              id={p.draft.id}
              label={label}
              action={action}
              type={type}
              status={p.status as any}
              isExpanded={expandedId === p.draft.id}
              detailsData={p.preview}
              rawText={p.rawPreview}
              errorMessage={p.error}
            />
          );
        })}

        {!isStreaming && cards.map((card) => {
          const toolName = card.toolCall.toolName;
          const args = card.data;
          const action = getAction(toolName);
          const type = getType(toolName, args);
          const label = getLabel({
            toolName,
            fallbackTitle: card.title,
            action,
            type,
            args,
            storyObjects,
          });

          const fcStatus = card.toolCall.status;
          const isValidationFailed = fcStatus === 'failed' && card.toolCall.failureType === 'validation';
          const showCheckbox = isPending;

          return (
            <OperationItem
              key={card.id}
              mode={mode}
              id={card.id}
              label={label}
              action={action}
              type={type}
              status={fcStatus as any}
              isExpanded={expandedId === card.id}
              onToggle={() => handleToggleExpanded(card.id)}
              showCheckbox={showCheckbox}
              isSelected={selections[card.id] ?? true}
              isCheckboxDisabled={selectionDisabled || isValidationFailed}
              onToggleSelected={() => toggleSelection(card.id)}
              detailsData={args}
              errorMessage={card.toolCall.reason}
            />
          );
        })}
      </div>

      {isPending && !isCardCollapsed && (
        <div className="tool-call-card__footer">
          <div className="tool-call-card__footer-left">
            <span className="tool-call-card__footer-count">{selectedCount} selected</span>
            {isApplyDisabled && applyDisabledReason && (
              <span className="tool-call-card__footer-warning">{applyDisabledReason}</span>
            )}
          </div>
          <div className="tool-call-card__footer-buttons">
            {onConfirmAndPause && (
              <button
                type="button"
                className="tool-call-btn tool-call-btn--secondary"
                onClick={handleConfirmAndPause}
                disabled={isConfirming || isApplyDisabled}
              >
                {isConfirming ? 'Applying…' : 'Confirm & Pause'}
              </button>
            )}
            <button
              type="button"
              className="tool-call-btn tool-call-btn--primary"
              onClick={handleConfirm}
              disabled={isConfirming || isApplyDisabled}
            >
              {isConfirming ? 'Applying…' : 'Confirm'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ToolCallCardContainer;
