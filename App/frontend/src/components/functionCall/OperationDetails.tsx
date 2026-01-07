import React, { useMemo } from 'react';
import { humanizePreviewKey } from '../../agent/utils/functionCallPreview';

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
    <div className="fc-details">
      {errorMessage && <div className="fc-details__error">{errorMessage}</div>}
      <div className="fc-details__panel">
        {fields.map((f) => (
          <div key={f.key} className="fc-field">
            <div className="fc-field__label">{f.label}</div>
            <div className={`fc-field__value ${f.isCode ? 'fc-field__value--code' : ''}`}>
              {f.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

