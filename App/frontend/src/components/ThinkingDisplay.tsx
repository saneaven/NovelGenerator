import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { ContentPart } from '../llm/requestTypes';
import './ThinkingDisplay.css';

interface ThinkingDisplayProps {
  messageId: string;
  contentParts?: ContentPart[];
  isStreaming?: boolean;
}

const ThinkingDisplay: React.FC<ThinkingDisplayProps> = ({
  messageId,
  contentParts,
  isStreaming = false,
}) => {
  const [expandedStates, setExpandedStates] = useState<Record<string, boolean>>({});
  const contentRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  const thinkingParts = contentParts?.filter((p) => p.type === 'thinking') ?? [];
  const lastText = thinkingParts[thinkingParts.length - 1]?.text;

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

  if (!contentParts || contentParts.length === 0) return null;
  if (thinkingParts.length === 0) return null;

  const getStableKey = (index: number): string => `${messageId}-thinking-${index}`;

  const toggleExpanded = (key: string) => {
    setExpandedStates((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="message-with-thinking">
      {thinkingParts.map((part, index) => {
        const key = getStableKey(index);
        const isExpanded = expandedStates[key] ?? false;
        const isLast = index === thinkingParts.length - 1;
        const streaming = isStreaming && isLast;

        return (
          <div key={key} className="thinking-card-minimal">
            <button
              className="thinking-card-toggle"
              onClick={() => toggleExpanded(key)}
            >
              <span className="toggle-icon">{isExpanded ? '-' : '+'}</span>
              <span className="toggle-label">Thinking</span>
              {streaming && <span className="streaming-indicator">...</span>}
            </button>

            {isExpanded && (
              <div
                ref={isLast ? contentRef : undefined}
                className="thinking-card-content"
                onScroll={isLast ? handleScroll : undefined}
              >
                {part.text}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(ThinkingDisplay);
