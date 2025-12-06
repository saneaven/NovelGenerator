import React, { useState } from 'react';
import type { ContentPart } from '../llm/requestTypes';
import './ThinkingDisplay.css';

interface ThinkingDisplayProps {
  messageId: string;
  contentParts?: ContentPart[];
  displayMode?: 'inline' | 'separate';
  isStreaming?: boolean;
}

const ThinkingDisplay: React.FC<ThinkingDisplayProps> = ({
  messageId,
  contentParts,
  displayMode = 'separate',
  isStreaming = false,
}) => {
  const [expandedStates, setExpandedStates] = useState<Record<string, boolean>>({});

  if (!contentParts || contentParts.length === 0) return null;

  const thinkingParts = contentParts.filter((p) => p.type === 'thinking');
  if (thinkingParts.length === 0) return null;

  const getStableKey = (index: number): string => `${messageId}-thinking-${index}`;

  const toggleExpanded = (key: string) => {
    setExpandedStates((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (displayMode === 'inline') {
    return (
      <div className="message-content-interleaved">
        {contentParts.map((part, index) => (
          <div
            key={getStableKey(index)}
            className={`content-part content-part-${part.type}`}
          >
            {part.type === 'content' ? (
              <div className="content-text">{part.text}</div>
            ) : (
              <div className="thinking-block">
                <div className="thinking-indicator">Thinking</div>
                <div className="thinking-text">{part.text}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

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

            {isExpanded && <div className="thinking-card-content">{part.text}</div>}
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(ThinkingDisplay);
