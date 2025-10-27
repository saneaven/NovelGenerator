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
  // Track expanded state for each thinking block individually
  const [expandedStates, setExpandedStates] = useState<Record<number, boolean>>({});

  if (!contentParts || contentParts.length === 0) {
    return null;
  }

  // Extract thinking/reasoning parts
  const thinkingParts = contentParts.filter(p => p.type === 'thinking' || p.type === 'reasoning');
  const contentOnlyParts = contentParts.filter(p => p.type === 'content');

  const toggleExpanded = (index: number) => {
    setExpandedStates(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

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

  // Separate mode: Individual minimal cards for each thinking block
  return (
    <div className="message-with-reasoning">
      {/* Individual thinking cards */}
      {thinkingParts.map((part, index) => {
        const isExpanded = expandedStates[index] || false;
        const isLastBlock = index === thinkingParts.length - 1;
        const isStreamingThisBlock = isStreaming && isLastBlock;

        return (
          <div key={index} className="thinking-card-minimal">
            <button
              className="thinking-card-toggle"
              onClick={() => toggleExpanded(index)}
            >
              <span className="toggle-icon">{isExpanded ? '▼' : '▶'}</span>
              <span className="toggle-label">
                💭 {part.type === 'thinking' ? 'Thinking' : 'Reasoning'}
              </span>
              {isStreamingThisBlock && <span className="streaming-indicator">●</span>}
            </button>

            {isExpanded && (
              <div className="thinking-card-content">
                {part.text}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ReasoningDisplay;
