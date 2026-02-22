import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { ReasoningDetail } from '../../types/thread';
import { ChevronRight } from '../icons/navigation/ChevronRight';
import { Loading } from './Loading';
import { getByDotPath } from '../../utils/dotPath';
import './ThinkingDisplay.css';

interface ThinkingDisplayProps {
  messageId: string;
  reasoningDetail?: ReasoningDetail;
  isStreaming?: boolean;
}

const ThinkingDisplay: React.FC<ThinkingDisplayProps> = ({
  messageId,
  reasoningDetail,
  isStreaming = false,
}) => {
  const [expandedStates, setExpandedStates] = useState<Record<string, boolean>>({});
  const contentRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const displayPath = reasoningDetail?.meta?.thinking_display?.trim() ?? '';
  const thinkingValue = displayPath && reasoningDetail?.data
    ? getByDotPath(reasoningDetail.data, displayPath)
    : undefined;
  const thinkingText = typeof thinkingValue === 'string' ? thinkingValue : '';
  const lastText = thinkingText;

  // Check if user has scrolled away from bottom
  const handleScroll = useCallback(() => {
    const container = contentRef.current;
    if (!container) return;

    const threshold = 20;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    userScrolledRef.current = !isAtBottom;
  }, []);

  // Auto-scroll to bottom when streaming
  useEffect(() => {
    if (!isStreaming || userScrolledRef.current) return;

    const container = contentRef.current;
    if (!container) return;

    container.scrollTop = container.scrollHeight;
  }, [isStreaming, lastText]);

  if (!displayPath) return null;
  if (!thinkingText.trim()) return null;

  const key = `${messageId}-thinking`;
  const isExpanded = expandedStates[key] ?? false;

  const toggleExpanded = (key: string) => {
    setExpandedStates((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className={`thinking-card ${isExpanded ? 'expanded' : ''}`}>
      <button
        className="thinking-card-toggle"
        onClick={() => toggleExpanded(key)}
      >
        <span className="toggle-icon">
          <ChevronRight size="sm"/>
        </span>
        <span className="toggle-label">Thinking</span>
        {isStreaming && <Loading variant="pulse" size="xs" className="streaming-indicator" />}
      </button>

      <div className="thinking-card-content">
        <div
          ref={contentRef}
          className="thinking-card-content-inner"
          onScroll={handleScroll}
        >
          {thinkingText}
        </div>
      </div>
    </div>
  );
};

export default React.memo(ThinkingDisplay);
