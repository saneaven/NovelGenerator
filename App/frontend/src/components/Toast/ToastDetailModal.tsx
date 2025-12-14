import React, { useMemo } from 'react';
import { useModalHistory } from '../../hooks/useModalHistory';
import type { LLMTaskSessionState } from '../../store/llmTaskStore';
import ThinkingDisplay from '../ThinkingDisplay';
import ToastProgressBar from './ToastProgressBar';
import { parsePartialJson } from '../../utils/nativeOutputParser';
import { Close } from '../icons';
import './ToastDetailModal.css';

// Content segment types for mixed text/JSON content
interface ContentSegment {
  type: 'text' | 'json';
  content: string;
  parsed?: any;
}

// Parse content into text and JSON segments
const parseContentSegments = (content: string): ContentSegment[] => {
  const segments: ContentSegment[] = [];
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)(?:```|$)/g;

  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Text before the code block
    if (match.index > lastIndex) {
      const textContent = content.slice(lastIndex, match.index).trim();
      if (textContent) {
        segments.push({ type: 'text', content: textContent });
      }
    }

    // JSON code block
    const jsonContent = match[1].trim();
    if (jsonContent) {
      const parsed = parsePartialJson(jsonContent);
      segments.push({
        type: 'json',
        content: jsonContent,
        parsed: parsed
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last code block
  if (lastIndex < content.length) {
    const textContent = content.slice(lastIndex).trim();
    if (textContent) {
      segments.push({ type: 'text', content: textContent });
    }
  }

  // If no code blocks found, treat as plain text
  if (segments.length === 0 && content.trim()) {
    segments.push({ type: 'text', content: content });
  }

  return segments;
};

// JSON Value renderer component
interface JsonValueProps {
  value: any;
  isLast?: boolean;
  isStreaming?: boolean;
  depth?: number;
}

const JsonValue: React.FC<JsonValueProps> = ({ value, isLast, isStreaming, depth = 0 }) => {
  // Null
  if (value === null) {
    return <span className="json-null">null</span>;
  }

  // String
  if (typeof value === 'string') {
    return (
      <>
        {value}
        {isLast && isStreaming && <span className="toast-detail-cursor">|</span>}
      </>
    );
  }

  // Number
  if (typeof value === 'number') {
    return <span className="json-number">{value}</span>;
  }

  // Boolean
  if (typeof value === 'boolean') {
    return <span className="json-boolean">{value.toString()}</span>;
  }

  // Array
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="json-empty">[]</span>;
    }
    return (
      <div className="json-array-viewer">
        {value.map((item, index) => (
          <div key={index} className="json-array-item">
            <div className="json-array-index">[{index}]</div>
            <div className="json-boxed-content">
              <JsonValue
                value={item}
                isLast={index === value.length - 1}
                isStreaming={isStreaming}
                depth={depth + 1}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Object
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <span className="json-empty">{'{}'}</span>;
    }
    return (
      <div className={`json-object-fields ${depth === 0 ? 'json-root' : ''}`}>
        {entries.map(([key, val], index) => (
          <div key={key} className={`json-field ${depth === 0 ? 'json-field-root' : 'json-field-nested'}`}>
            <div className="json-field-label">{key}</div>
            <div className={depth >= 1 ? 'json-boxed-content' : 'json-field-value'}>
              <JsonValue
                value={val}
                isLast={index === entries.length - 1}
                isStreaming={isStreaming}
                depth={depth + 1}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return <>{String(value)}</>;
};

// JSON Object Viewer component
interface JsonObjectViewerProps {
  data: any;
  isStreaming: boolean;
}

const JsonObjectViewer: React.FC<JsonObjectViewerProps> = ({ data, isStreaming }) => {
  if (!data) return null;
  return (
    <div className="json-object-viewer">
      <JsonValue value={data} isLast={true} isStreaming={isStreaming} depth={0} />
    </div>
  );
};

interface ToastDetailModalProps {
  session: LLMTaskSessionState;
  onClose: () => void;
}

const ToastDetailModal: React.FC<ToastDetailModalProps> = ({ session, onClose }) => {
  useModalHistory(true, onClose);  // Always open when rendered

  const streamContent = useMemo(() => {
    if (!session.contentParts || session.contentParts.length === 0) {
      return '';
    }
    return session.contentParts
      .filter((part) => part.type === 'content')
      .map((part) => part.text)
      .join('');
  }, [session.contentParts]);

  // Parse content into text and JSON segments
  const contentSegments = useMemo(() => {
    if (!streamContent) return [];
    return parseContentSegments(streamContent);
  }, [streamContent]);

  const hasThinking = useMemo(() => {
    return session.contentParts?.some((part) => part.type === 'thinking') ?? false;
  }, [session.contentParts]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const getStatusLabel = () => {
    switch (session.status) {
      case 'running':
        return 'In Progress';
      case 'success':
        return 'Completed';
      case 'error':
        return 'Failed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className="toast-detail-overlay" onClick={handleOverlayClick}>
      <div className="toast-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="toast-detail-header">
          <div className="toast-detail-title">
            <span className={`toast-detail-status toast-detail-status--${session.status}`}>
              {session.status === 'running' && (
                <span className="toast-detail-spinner" />
              )}
              {getStatusLabel()}
            </span>
            <h3>{session.label || 'Task'}</h3>
          </div>
          <button className="toast-detail-close" onClick={onClose} title="Close">
            <Close size={14} />
          </button>
        </div>

        {session.progress && (
          <div className="toast-detail-progress">
            <div className="toast-detail-progress-text">
              {session.progress.currentItemLabel || `${session.progress.current} / ${session.progress.total}`}
            </div>
            <ToastProgressBar current={session.progress.current} total={session.progress.total} />
          </div>
        )}

        <div className="toast-detail-content">
          {/* Thinking Display */}
          {hasThinking && session.contentParts && (
            <div className="toast-detail-thinking">
              <ThinkingDisplay
                messageId={session.id}
                contentParts={session.contentParts}
                displayMode="separate"
                isStreaming={session.status === 'running'}
              />
            </div>
          )}

          {/* Streaming Content - Mixed Text/JSON */}
          {contentSegments.length > 0 && (
            <div className="toast-detail-stream">
              <div className="toast-detail-stream-label">Output</div>
              <div className="toast-detail-segments">
                {contentSegments.map((segment, index) => {
                  const isLastSegment = index === contentSegments.length - 1;
                  const isStreaming = session.status === 'running';

                  if (segment.type === 'json' && segment.parsed) {
                    return (
                      <JsonObjectViewer
                        key={index}
                        data={segment.parsed}
                        isStreaming={isLastSegment && isStreaming}
                      />
                    );
                  }

                  // Text segment
                  return (
                    <div key={index} className="toast-detail-text-segment">
                      {segment.content}
                      {isLastSegment && isStreaming && (
                        <span className="toast-detail-cursor">|</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* No content yet */}
          {!streamContent && !hasThinking && session.status === 'running' && (
            <div className="toast-detail-waiting">
              <div className="toast-detail-waiting-spinner" />
              <span>Waiting for response...</span>
            </div>
          )}
        </div>

        <div className="toast-detail-footer">
          <button className="toast-detail-btn" onClick={onClose}>
            {session.status === 'running' ? 'Continue in Background' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default React.memo(ToastDetailModal);
