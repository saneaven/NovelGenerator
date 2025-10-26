import React, { useState } from 'react';
import type { ContentPart } from '../llm_request/types';
import './ReasoningDisplay.css';

interface ReasoningDisplayProps {
  contentParts?: ContentPart[];
  displayMode?: 'inline' | 'separate';  // Toggle display mode
  isStreaming?: boolean;
}

const ReasoningDisplay: React.FC<ReasoningDisplayProps> = ({
  contentParts,
  displayMode = 'separate',
  isStreaming = false
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!contentParts || contentParts.length === 0) {
    return null;
  }

  // Extract thinking/reasoning parts
  const thinkingParts = contentParts.filter(p => p.type === 'thinking' || p.type === 'reasoning');
  const contentOnlyParts = contentParts.filter(p => p.type === 'content');

  if (thinkingParts.length === 0) {
    // No reasoning to display - just show content
    return (
      <div className="message-content-clean">
        {contentOnlyParts.map((part, index) => (
          <span key={index}>{part.text}</span>
        ))}
      </div>
    );
  }

  // Inline mode: Show thinking where it occurred
  if (displayMode === 'inline') {
    return (
      <div className="message-content-interleaved">
        {contentParts.map((part, index) => (
          <div key={index} className={`content-part content-part-${part.type}`}>
            {part.type === 'content' ? (
              <div className="content-text">{part.text}</div>
            ) : (
              <div className="thinking-block">
                <div className="thinking-indicator">
                  {part.type === 'thinking' ? '💭 Thinking' : '🧠 Reasoning'}
                </div>
                <div className="thinking-text">{part.text}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Separate mode: Collapsible panel + clean content
  return (
    <div className="message-with-reasoning">
      {/* Collapsible thinking panel */}
      <div className="reasoning-panel">
        <button
          className="reasoning-toggle"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <span className="toggle-icon">{isExpanded ? '▼' : '▶'}</span>
          <span className="toggle-label">
            {thinkingParts[0].type === 'thinking' ? '💭 Thinking' : '🧠 Reasoning'}
            {' '}({thinkingParts.length} {thinkingParts.length === 1 ? 'block' : 'blocks'})
          </span>
          {isStreaming && <span className="streaming-indicator">●</span>}
        </button>

        {isExpanded && (
          <div className="reasoning-content">
            {thinkingParts.map((part, index) => (
              <div key={index} className="reasoning-block">
                <div className="reasoning-block-header">
                  Block #{index + 1}
                </div>
                <div className="reasoning-block-text">{part.text}</div>
                {index < thinkingParts.length - 1 && <hr className="reasoning-separator" />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Clean content only */}
      {contentOnlyParts.length > 0 && (
        <div className="message-content-clean">
          {contentOnlyParts.map((part, index) => (
            <span key={index}>{part.text}</span>
          ))}
        </div>
      )}
    </div>
  );
};

export default ReasoningDisplay;
