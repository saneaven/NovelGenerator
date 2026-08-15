import React from 'react';
import { useTranslation } from 'react-i18next';
import { useThreadStreamStore } from '../../../store/threadStreamStore';

interface StageIndicatorProps {
  threadId: string;
  isMessageRunActive: boolean;
  threadStatus?: string | null;
}

const STAGE_KEY_BY_STAGE: Record<string, string> = {
  queued: 'agent.stage.queued',
  retrieving_memory: 'agent.stage.retrievingMemory',
  rendering_prompt: 'agent.stage.renderingPrompt',
  summarizing_context: 'agent.stage.summarizingContext',
  retrying: 'agent.stage.retrying',
};

const StageIndicator: React.FC<StageIndicatorProps> = ({
  threadId,
  isMessageRunActive,
  threadStatus,
}) => {
  const { t } = useTranslation();
  const stage = useThreadStreamStore((state) => state.currentStageByThread[threadId] ?? null);
  const translationKey = stage ? STAGE_KEY_BY_STAGE[stage] : null;

  if (!translationKey || !isMessageRunActive || threadStatus !== 'running') {
    return null;
  }

  return <div className="stage-indicator">{t(translationKey)}...</div>;
};

export default StageIndicator;
