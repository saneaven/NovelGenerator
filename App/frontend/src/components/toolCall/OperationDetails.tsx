import React, { useMemo, useRef, useEffect, useCallback } from 'react';
import { humanizePreviewKey } from '../../agent/utils/toolCallPreview';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatValue(value: unknown): { text: string; isCode: boolean } {
  if (value === null) return { text: 'null', isCode: false };
  if (value === undefined) return { text: 'undefined', isCode: false };
  if (typeof value === 'string') return { text: value, isCode: false };
  if (typeof value === 'number' || typeof value === 'boolean') return { text: String(value), isCode: false };

  try {
    return { text: JSON.stringify(value, null, 2), isCode: true };
  } catch {
    return { text: String(value), isCode: false };
  }
}

export interface OperationDetailsProps {
  data?: unknown;
  rawText?: string;
  errorMessage?: string;
}

export const OperationDetails: React.FC<OperationDetailsProps> = ({ data, rawText, errorMessage }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  const handleScroll = useCallback(() => {
    const el = panelRef.current;
    if (!el) return;
    const threshold = 50;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    userScrolledUpRef.current = !isAtBottom;
  }, []);

  useEffect(() => {
    if (userScrolledUpRef.current) return;
    const el = panelRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [data, rawText]);

  const fields = useMemo(() => {
    if (isRecord(data)) {
      return Object.entries(data).map(([key, value]) => {
        const formatted = formatValue(value);
        return { key, label: humanizePreviewKey(key), ...formatted };
      });
    }

    if (Array.isArray(data)) {
      const formatted = formatValue(data);
      return [{ key: 'array', label: 'Data', ...formatted }];
    }

    if (typeof data === 'string') {
      return [{ key: 'text', label: 'Data', text: data, isCode: false }];
    }

    if (data !== undefined) {
      const formatted = formatValue(data);
      return [{ key: 'value', label: 'Data', ...formatted }];
    }

    if (rawText) {
      return [{ key: 'raw', label: 'Raw', text: rawText, isCode: true }];
    }

    return [{ key: 'empty', label: 'Data', text: '(empty)', isCode: false }];
  }, [data, rawText]);

  return (
    <div className="tool-call-details">
      {errorMessage && <div className="tool-call-details__error">{errorMessage}</div>}
      <div className="tool-call-details__panel" ref={panelRef} onScroll={handleScroll}>
        {fields.map((f) => (
          <div key={f.key} className="tool-call-field">
            <div className="tool-call-field__label">{f.label}</div>
            <div className={`tool-call-field__value ${f.isCode ? 'tool-call-field__value--code' : ''}`}>
              {f.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

