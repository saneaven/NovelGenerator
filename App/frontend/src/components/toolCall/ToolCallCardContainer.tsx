import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getToolDisplayName } from '../../toolCall';
import type { ToolCallProgress } from '../../llm/requestTypes';
import { resolveStoryObjectName } from '../../agent/utils/objectNameResolver';
import { useStoryObjects } from '../../store/unifiedObjectStore';
import { useSettingsStore, type ToolCallAutoApproveConfig } from '../../store/settingsStore';
import type { EditCard, ToolCallDecision } from '../../toolCall/types';
import type { ToolCallCardContainerProps, CardMode } from './types';
import { useOperationDecisions } from './hooks';
import { groupPatchOperations } from './utils/groupPatchOperations';
import { OperationItem } from './OperationItem';
import './ToolCallCard.css';

type AutoApproveOperation = keyof ToolCallAutoApproveConfig;

type CardOperationView = {
  card: EditCard;
  action?: string;
  type?: string;
  targetId?: string;
  label: string;
  isPatch: boolean;
};

function isDecisionEligible(card: EditCard): boolean {
  return card.toolCall.status === 'pending' || card.toolCall.status === 'validating';
}

function isValidationFailure(card: EditCard): boolean {
  return card.toolCall.status === 'failed' && card.toolCall.failureType === 'validation';
}

function getAutoApproveOperation(toolName: string): AutoApproveOperation | null {
  if (!toolName) return null;
  if (toolName === 'rag_search') return 'search';
  if (toolName.startsWith('call_')) return 'read';
  if (toolName === 'return_sub_agent_result') return 'read';
  if (toolName.startsWith('read_')) return 'read';
  if (toolName.startsWith('create_')) return 'create';
  if (toolName.startsWith('delete_')) return 'delete';
  if (toolName.startsWith('replace_')) return 'replace';
  if (toolName.startsWith('patch_')) return 'patch';
  return null;
}

function getAction(toolName: string): string | undefined {
  if (!toolName) return undefined;
  if (toolName === 'rag_search') return 'search';
  if (toolName.startsWith('call_')) return 'read';
  if (toolName === 'return_sub_agent_result') return 'read';
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

  if (toolName === 'rag_search') return 'rag';
  if (toolName.startsWith('call_')) return 'sub_agent';
  if (toolName === 'return_sub_agent_result') return 'sub_agent';
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

function omitKey(map: Record<string, boolean>, key: string): Record<string, boolean> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

export const ToolCallCardContainer: React.FC<ToolCallCardContainerProps> = ({
  mode,
  cards = [],
  streamingProgress = [],
  onCommitDecisions,
  onCommitDecisionsAndPause,
  projectId,
  isApplyDisabled = false,
  applyDisabledReason,
}) => {
  const { t } = useTranslation();
  const mainLanguage = useSettingsStore((state) => state.getSettings().mainLanguage);
  const toolCallAutoApprove = useSettingsStore((state) => state.getSettings().toolCallAutoApprove);
  const storyObjects = useStoryObjects(projectId, mainLanguage);

  const isStreaming = mode === 'streaming';
  const isPending = mode === 'pending';

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isCardCollapsed, setIsCardCollapsed] = useState(false);
  const [committingItemIds, setCommittingItemIds] = useState<Record<string, boolean>>({});
  const [committingGroupIds, setCommittingGroupIds] = useState<Record<string, boolean>>({});

  const decisionDisabled = !isPending || isApplyDisabled;
  const {
    acceptedCount,
    rejectedCount,
    getDecision,
    setDecision,
    isDecisionLocked,
    buildDecisionMap,
  } = useOperationDecisions(cards, decisionDisabled);

  const handleToggleCardCollapse = useCallback(() => {
    setIsCardCollapsed((prev) => !prev);
  }, []);

  useEffect(() => {
    if (mode === 'confirmed') {
      setIsCardCollapsed(true);
    }
  }, [mode]);

  const activeStreamingId = useMemo(() => {
    if (!isStreaming || streamingProgress.length === 0) return null;

    let best = streamingProgress[0];
    let bestIndex = typeof best?.draft?.index === 'number' ? best.draft.index : Number.NEGATIVE_INFINITY;
    for (const p of streamingProgress) {
      const pIndex = typeof p?.draft?.index === 'number' ? p.draft.index : Number.NEGATIVE_INFINITY;
      if (pIndex > bestIndex) {
        best = p;
        bestIndex = pIndex;
      } else if (
        pIndex === bestIndex &&
        (p.updatedAt ?? 0) > (best.updatedAt ?? 0)
      ) {
        best = p;
      }
    }
    return best?.draft?.id ?? null;
  }, [isStreaming, streamingProgress]);

  const prevActiveStreamingIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isStreaming) {
      prevActiveStreamingIdRef.current = null;
      return;
    }

    const nextActiveId = activeStreamingId;
    if (!nextActiveId) {
      prevActiveStreamingIdRef.current = null;
      return;
    }

    const prevActiveId = prevActiveStreamingIdRef.current;

    setExpandedId((prevExpandedId) => {
      if (prevExpandedId === null) {
        return prevActiveId ? null : nextActiveId;
      }
      if (prevActiveId && prevExpandedId === prevActiveId && prevActiveId !== nextActiveId) {
        return nextActiveId;
      }
      return prevExpandedId;
    });

    prevActiveStreamingIdRef.current = nextActiveId;
  }, [isStreaming, activeStreamingId]);

  useEffect(() => {
    if (isStreaming) return;
    setExpandedId(null);
  }, [isStreaming, mode]);

  const handleToggleExpanded = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const cardOperations = useMemo<CardOperationView[]>(() => {
    return cards.map((card) => {
      const toolName = card.toolCall.toolName;
      const args = card.data;
      const action = getAction(toolName);
      const type = getType(toolName, args);
      const targetId = getTargetId(type, args);
      const label = getLabel({
        toolName,
        fallbackTitle: card.title,
        action,
        type,
        args,
        storyObjects,
      });
      return {
        card,
        action,
        type,
        targetId,
        label,
        isPatch: toolName.startsWith('patch_'),
      };
    });
  }, [cards, storyObjects]);

  const immediateOperations = useMemo(
    () => cardOperations.filter((op) => !op.isPatch),
    [cardOperations]
  );

  const patchGroups = useMemo(
    () =>
      groupPatchOperations(
        cardOperations
          .filter((op) => op.isPatch)
          .map((op) => ({
            id: op.card.id,
            type: op.type,
            targetId: op.targetId,
            label: op.label,
            value: op,
          }))
      ),
    [cardOperations]
  );

  const commitDecisions = useCallback(
    async (decisions: Record<string, ToolCallDecision>, andPause: boolean = false) => {
      if (!isPending || isApplyDisabled) return;
      const hasDecisions = Object.keys(decisions).length > 0;
      if (!hasDecisions) return;

      if (andPause) {
        if (!onCommitDecisionsAndPause) return;
        await onCommitDecisionsAndPause(decisions);
        return;
      }

      if (!onCommitDecisions) return;
      await onCommitDecisions(decisions);
    },
    [isPending, isApplyDisabled, onCommitDecisions, onCommitDecisionsAndPause]
  );

  const handleImmediateDecision = useCallback(
    async (card: EditCard, decision: ToolCallDecision) => {
      if (decisionDisabled) return;
      if (!isDecisionEligible(card) || isValidationFailure(card)) return;
      if (committingItemIds[card.id]) return;

      setDecision(card.id, decision);
      setCommittingItemIds((prev) => ({ ...prev, [card.id]: true }));
      try {
        await commitDecisions({ [card.id]: decision });
      } finally {
        setCommittingItemIds((prev) => omitKey(prev, card.id));
      }
    },
    [decisionDisabled, committingItemIds, setDecision, commitDecisions]
  );

  const handleConfirmPatchGroup = useCallback(
    async (groupId: string, cardIds: string[], andPause: boolean = false) => {
      if (decisionDisabled) return;
      if (committingGroupIds[groupId]) return;

      const decisions = buildDecisionMap(cardIds);
      if (Object.keys(decisions).length === 0) return;

      setCommittingGroupIds((prev) => ({ ...prev, [groupId]: true }));
      try {
        await commitDecisions(decisions, andPause);
      } finally {
        setCommittingGroupIds((prev) => omitKey(prev, groupId));
      }
    },
    [decisionDisabled, committingGroupIds, buildDecisionMap, commitDecisions]
  );

  const autoConfirmSignature = useMemo(() => {
    if (!isPending || !onCommitDecisions || isApplyDisabled) return null;
    if (cards.length === 0) return null;
    if (!cards.every((c) => c.toolCall.status === 'pending')) return null;

    for (const card of cards) {
      const op = getAutoApproveOperation(card.toolCall.toolName);
      if (!op) return null;
      if (!toolCallAutoApprove?.[op]) return null;
    }

    const ids = cards.map((c) => c.id).join(',');
    const config = JSON.stringify(toolCallAutoApprove ?? {});
    return `${ids}|${config}`;
  }, [isPending, onCommitDecisions, isApplyDisabled, cards, toolCallAutoApprove]);

  const lastAutoConfirmedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoConfirmSignature) return;
    if (lastAutoConfirmedRef.current === autoConfirmSignature) return;
    lastAutoConfirmedRef.current = autoConfirmSignature;

    const autoAcceptMap: Record<string, ToolCallDecision> = {};
    cards.forEach((card) => {
      if (card.toolCall.status === 'pending') {
        autoAcceptMap[card.id] = 'accept';
      }
    });

    void commitDecisions(autoAcceptMap);
  }, [autoConfirmSignature, cards, commitDecisions]);

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
              onToggle={() => handleToggleExpanded(p.draft.id)}
              detailsData={p.preview}
              rawText={p.rawPreview}
              errorMessage={p.error}
            />
          );
        })}

        {!isStreaming && isPending && (
          <div className="tool-call-card__decision-summary">
            {t('toolCall.pendingDecisionSummary', {
              accepted: acceptedCount,
              rejected: rejectedCount,
            })}
          </div>
        )}

        {!isStreaming && isApplyDisabled && applyDisabledReason && (
          <div className="tool-call-card__warning">{applyDisabledReason}</div>
        )}

        {!isStreaming && immediateOperations.length > 0 && (
          <div className="tool-call-section">
            <div className="tool-call-section__title">{t('toolCall.sectionImmediate')}</div>
            {immediateOperations.map((op) => {
              const card = op.card;
              const showDecisionControls =
                isPending && (isDecisionEligible(card) || isValidationFailure(card));
              const decisionLocked = isDecisionLocked(card) || committingItemIds[card.id] === true;

              return (
                <OperationItem
                  key={card.id}
                  mode={mode}
                  id={card.id}
                  label={op.label}
                  action={op.action}
                  type={op.type}
                  status={card.toolCall.status as any}
                  isExpanded={expandedId === card.id}
                  onToggle={() => handleToggleExpanded(card.id)}
                  showDecisionControls={showDecisionControls}
                  decisionControlStyle="buttons"
                  decision={getDecision(card)}
                  isDecisionDisabled={decisionLocked}
                  onAccept={() => void handleImmediateDecision(card, 'accept')}
                  onReject={() => void handleImmediateDecision(card, 'reject')}
                  detailsData={card.data}
                  result={card.toolCall.result}
                  errorMessage={card.toolCall.reason}
                />
              );
            })}
          </div>
        )}

        {!isStreaming && patchGroups.length > 0 && (
          <div className="tool-call-section">
            <div className="tool-call-section__title">{t('toolCall.sectionPatchGroups')}</div>
            {patchGroups.map((group) => {
              const isGroupCommitting = committingGroupIds[group.id] === true;
              const groupCardIds = group.items.map((item) => item.id);
              const canCommitGroup = Object.keys(buildDecisionMap(groupCardIds)).length > 0;

              return (
                <div key={group.id} className="tool-call-patch-group">
                  <div className="tool-call-patch-group__header">
                    <div className="tool-call-patch-group__title">{group.label}</div>
                    <div className="tool-call-patch-group__count">
                      {t('toolCall.patchCount', { count: group.items.length })}
                    </div>
                  </div>

                  {group.items.map(({ value: op }) => {
                    const card = op.card;
                    const showDecisionControls =
                      isPending && (isDecisionEligible(card) || isValidationFailure(card));
                    const decisionLocked = isDecisionLocked(card) || isGroupCommitting;
                    return (
                      <OperationItem
                        key={card.id}
                        mode={mode}
                        id={card.id}
                        label={op.label}
                        action={op.action}
                        type={op.type}
                        status={card.toolCall.status as any}
                        isExpanded={expandedId === card.id}
                        onToggle={() => handleToggleExpanded(card.id)}
                        showDecisionControls={showDecisionControls}
                        decision={getDecision(card)}
                        isDecisionDisabled={decisionLocked}
                        onAccept={() => setDecision(card.id, 'accept')}
                        onReject={() => setDecision(card.id, 'reject')}
                        detailsData={card.data}
                        result={card.toolCall.result}
                        errorMessage={card.toolCall.reason}
                      />
                    );
                  })}

                  {isPending && (
                    <div className="tool-call-patch-group__actions">
                      {onCommitDecisionsAndPause && (
                        <button
                          type="button"
                          className="tool-call-btn tool-call-btn--secondary"
                          onClick={() => void handleConfirmPatchGroup(group.id, groupCardIds, true)}
                          disabled={isGroupCommitting || !canCommitGroup || isApplyDisabled}
                        >
                          {isGroupCommitting ? t('toolCall.applying') : t('toolCall.confirmAndPause')}
                        </button>
                      )}
                      <button
                        type="button"
                        className="tool-call-btn tool-call-btn--primary"
                        onClick={() => void handleConfirmPatchGroup(group.id, groupCardIds)}
                        disabled={isGroupCommitting || !canCommitGroup || isApplyDisabled}
                      >
                        {isGroupCommitting ? t('toolCall.applying') : t('toolCall.confirmPatchGroup')}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ToolCallCardContainer;
