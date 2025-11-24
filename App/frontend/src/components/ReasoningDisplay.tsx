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
  // Track expanded state for each thinking block individually using stable keys
  const [expandedStates, setExpandedStates] = useState<Record<string, boolean>>({});

  if (!contentParts || contentParts.length === 0) {
    return null;
  }

  // Extract thinking parts
  const thinkingParts = contentParts.filter(p => p.type === 'thinking');
  const contentOnlyParts = contentParts.filter(p => p.type === 'content');

  // Generate stable key for a content part based on text hash and position
  const generateStableKey = (text: string, index: number): string => {
    // Simple hash function for creating stable keys
    const hash = text.split('').reduce((acc, char, i) => {
      return ((acc << 5) - acc) + char.charCodeAt(0) + i;
    }, 0);
    return `${index}-${Math.abs(hash)}`;
  };

  const toggleExpanded = (key: string) => {
    setExpandedStates(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  if (thinkingParts.length === 0) {
    // No thinking/reasoning to display
    return null;
  }

  // Inline mode: Show thinking where it occurred
  if (displayMode === 'inline') {
    return (
      <div className="message-content-interleaved">
        {contentParts.map((part, index) => (
          <div key={generateStableKey(part.text, index)} className={`content-part content-part-${part.type}`}>
            {part.type === 'content' ? (
              <div className="content-text">{part.text}</div>
            ) : (
              <div className="thinking-block">
                <div className="thinking-indicator">
                  {'🧠 Thinking'}
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
        const stableKey = generateStableKey(part.text, index);
        const isExpanded = expandedStates[stableKey] || false;
        const isLastBlock = index === thinkingParts.length - 1;
        const isStreamingThisBlock = isStreaming && isLastBlock;

        return (
          <div key={stableKey} className="thinking-card-minimal">
            <button
              className="thinking-card-toggle"
              onClick={() => toggleExpanded(stableKey)}
            >
              <span className="toggle-icon">{isExpanded ? '▼' : '▶'}</span>
              <span className="toggle-label">
                💭 Thinking
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
