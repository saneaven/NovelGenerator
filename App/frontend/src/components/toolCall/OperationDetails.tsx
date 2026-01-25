import React, { useMemo, useRef, useEffect, useCallback } from 'react';
import { humanizePreviewKey } from '../../agent/utils/toolCallPreview';
import type { ApplicationResult } from '../../toolCall/types';

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
  result?: ApplicationResult;
}

export const OperationDetails: React.FC<OperationDetailsProps> = ({ data, rawText, errorMessage, result }) => {
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
  }, [data, rawText, result?.message]);

  const fields = useMemo(() => {
    const resultField = result
      ? (() => {
          const formatted = formatValue(result.message);
          return [{ key: 'result', label: 'Result', ...formatted }];
        })()
      : [];

    if (isRecord(data)) {
      const base = Object.entries(data).map(([key, value]) => {
        const formatted = formatValue(value);
        return { key, label: humanizePreviewKey(key), ...formatted };
      });
      return [...resultField, ...base];
    }

    if (Array.isArray(data)) {
      const formatted = formatValue(data);
      return [...resultField, { key: 'array', label: 'Data', ...formatted }];
    }

    if (typeof data === 'string') {
      return [...resultField, { key: 'text', label: 'Data', text: data, isCode: false }];
    }

    if (data !== undefined) {
      const formatted = formatValue(data);
      return [...resultField, { key: 'value', label: 'Data', ...formatted }];
    }

    if (rawText) {
      return [...resultField, { key: 'raw', label: 'Raw', text: rawText, isCode: true }];
    }

    return resultField.length > 0
      ? resultField
      : [{ key: 'empty', label: 'Data', text: '(empty)', isCode: false }];
  }, [data, rawText, result]);

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
