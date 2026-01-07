import React, { useRef, useEffect } from 'react';
import { humanizePreviewKey } from '../../agent/utils/functionCallPreview';

interface StreamingFieldDisplayProps {
  fieldKey: string;
  value: any;
  isStreaming?: boolean;
}

/**
 * Formats a value for display, handling different types appropriately
 */
const formatValue = (value: any): string => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value) || typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
};

/**
 * Determines if a value should use multi-line display
 */
const isMultilineValue = (value: any): boolean => {
  if (typeof value === 'string') {
    return value.length > 100 || value.includes('\n');
  }
  if (Array.isArray(value) || typeof value === 'object') {
    return true;
  }
  return false;
};

export const StreamingFieldDisplay: React.FC<StreamingFieldDisplayProps> = ({
  fieldKey,
  value,
  isStreaming = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUp = useRef(false);
  const formattedValue = formatValue(value);
  const isMultiline = isMultilineValue(value);

  // Auto-scroll to bottom while streaming
  useEffect(() => {
    if (isStreaming && !isUserScrolledUp.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [formattedValue, isStreaming]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const isAtBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 10;
    isUserScrolledUp.current = !isAtBottom;
  };

  const label = humanizePreviewKey(fieldKey);

  return (
    <div className="fc-streaming-field">
      <div className="fc-streaming-field__label">{label}</div>
      <div
        ref={containerRef}
        className={`fc-streaming-field__value ${isMultiline ? 'fc-streaming-field__value--multiline' : ''} ${isStreaming ? 'fc-streaming-field__value--streaming' : ''}`}
        onScroll={handleScroll}
      >
        {formattedValue}
      </div>
    </div>
  );
};
