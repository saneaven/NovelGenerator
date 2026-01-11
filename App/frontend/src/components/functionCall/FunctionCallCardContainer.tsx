import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getFunctionDisplayName } from '../../functionCall';
import type { FunctionCallProgress } from '../../llm/requestTypes';
import { resolveStoryObjectName } from '../../agent/utils/objectNameResolver';
import { useStoryObjects } from '../../store/unifiedObjectStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { FunctionCallCardContainerProps, CardMode } from './types';
import { useCardSelection } from './hooks';
import { OperationItem } from './OperationItem';
import './FunctionCallCard.css';

function getAction(functionName: string): string | undefined {
  if (!functionName) return undefined;
  if (functionName.startsWith('create_')) return 'create';
  if (functionName.startsWith('delete_')) return 'delete';
  if (functionName.startsWith('replace_')) return 'replace';
  if (functionName.startsWith('patch_')) return 'patch';
  if (functionName.startsWith('set_')) return 'set';
  return undefined;
}

function getType(functionName: string, args: Record<string, unknown> | undefined): string | undefined {
  const argType = args?.type;
  if (typeof argType === 'string' && argType.trim()) return argType;

  if (functionName.includes('basic_info')) return 'basic_info';
  if (functionName.includes('manuscript')) return 'manuscript';
  if (functionName.includes('outline_act')) return 'act';
  if (functionName.includes('outline_chapter')) return 'chapter';
  if (functionName.includes('outline')) return 'outline';
  if (functionName.includes('story_object')) return 'story_object';

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
  functionName: string;
  fallbackTitle: string;
  action?: string;
  type?: string;
  args?: Record<string, unknown>;
  storyObjects: ReturnType<typeof useStoryObjects>;
}): string {
  const { functionName, fallbackTitle, action, type, args, storyObjects } = params;

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

  if (!fallbackTitle.trim()) return functionName || 'Function call';
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

export const FunctionCallCardContainer: React.FC<FunctionCallCardContainerProps> = ({
  mode,
  cards = [],
  streamingProgress = [],
  onConfirm,
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

  if (isStreaming && streamingProgress.length === 0) return null;
  if (!isStreaming && cards.length === 0) return null;

  const itemCount = isStreaming ? streamingProgress.length : cards.length;

  return (
    <div className={`fc-card fc-card--${mode}${isCardCollapsed ? ' fc-card--collapsed' : ''}`}>
      <button
        type="button"
        className="fc-card__header"
        onClick={handleToggleCardCollapse}
      >
        <div className="fc-card__header-left">
          <div className="fc-card__title">AI Changes</div>
          <div className="fc-card__count">{itemCount}</div>
        </div>
        <div className="fc-card__header-right">
          <div className={`fc-pill fc-pill--${mode}`}>{modeLabel(mode)}</div>
          <svg
            className={`fc-card__chevron${isCardCollapsed ? '' : ' fc-card__chevron--open'}`}
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

      <div className={`fc-card__list${isCardCollapsed ? ' fc-card__list--collapsed' : ''}`}>
        {isStreaming && streamingProgress.map((p: FunctionCallProgress) => {
          const functionName = p.draft.functionName || '';
          const args = (p.preview && typeof p.preview === 'object') ? (p.preview as Record<string, unknown>) : undefined;
          const action = getAction(functionName);
          const type = getType(functionName, args);
          const label = getLabel({
            functionName,
            fallbackTitle: getFunctionDisplayName(functionName),
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
          const functionName = card.functionCall.functionName;
          const args = card.data;
          const action = getAction(functionName);
          const type = getType(functionName, args);
          const label = getLabel({
            functionName,
            fallbackTitle: card.title,
            action,
            type,
            args,
            storyObjects,
          });

          const fcStatus = card.functionCall.status;
          const isValidationFailed = fcStatus === 'failed' && card.functionCall.failureType === 'validation';
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
              errorMessage={card.functionCall.reason}
            />
          );
        })}
      </div>

      {isPending && !isCardCollapsed && (
        <div className="fc-card__footer">
          <div className="fc-card__footer-left">
            <span className="fc-card__footer-count">{selectedCount} selected</span>
            {isApplyDisabled && applyDisabledReason && (
              <span className="fc-card__footer-warning">{applyDisabledReason}</span>
            )}
          </div>
          <button
            type="button"
            className="fc-btn fc-btn--primary"
            onClick={handleConfirm}
            disabled={isConfirming || isApplyDisabled}
          >
            {isConfirming ? 'Applying…' : 'Confirm'}
          </button>
        </div>
      )}
    </div>
  );
};

export default FunctionCallCardContainer;
