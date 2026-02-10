import React, { useMemo } from 'react';
import { MarkdownRenderer } from '../../MarkdownRenderer';

export interface ReadOnlyOutlineItemDisplayProps {
  variant: 'outline' | 'outline_act' | 'outline_chapter';
  title: string;
  values: Record<string, unknown>;
  mode: 'read' | 'create' | 'replace' | 'delete';
  changedFields?: string[];
}

const FIELD_ORDER = ['name', 'description', 'content', 'order', 'actId', 'outlineId'];

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .replace(/^\w/, (m) => m.toUpperCase());
}

function sortedKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ai = FIELD_ORDER.indexOf(a);
    const bi = FIELD_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function renderValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) return <span className="function-call-outline-readonly__empty">(empty)</span>;
  if (typeof value === 'string') {
    if (!value.trim()) return <span className="function-call-outline-readonly__empty">(empty)</span>;
    return <MarkdownRenderer className="markdown-content">{value}</MarkdownRenderer>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="function-call-outline-readonly__plain">{String(value)}</span>;
  }
  try {
    return <pre className="function-call-outline-readonly__code">{JSON.stringify(value, null, 2)}</pre>;
  } catch {
    return <span className="function-call-outline-readonly__plain">{String(value)}</span>;
  }
}

export const ReadOnlyOutlineItemDisplay: React.FC<ReadOnlyOutlineItemDisplayProps> = ({
  variant,
  title,
  values,
  mode,
  changedFields,
}) => {
  const keys = useMemo(() => {
    const source = mode === 'replace' ? (changedFields ?? []) : Object.keys(values);
    return sortedKeys(source.filter((key) => key in values));
  }, [mode, changedFields, values]);

  const order = values.order;
  const actId = values.actId;
  const outlineId = values.outlineId;

  return (
    <div className="outline-manager function-call-outline-readonly">
      <div className={`content-card function-call-outline-readonly__card ${variant === 'outline_chapter' ? 'chapter-card' : variant === 'outline_act' ? 'act-card' : ''}`}>
        <div className="card-header">
          <div className="card-title-section">
            <div className="title-row">
              <h4>{title}</h4>
              <div className="card-meta">
                {typeof order === 'number' && <span className="function-call-outline-readonly__chip">Order {order}</span>}
                {typeof outlineId === 'string' && outlineId.trim() && <span className="function-call-outline-readonly__chip">Outline {outlineId}</span>}
                {typeof actId === 'string' && actId.trim() && <span className="function-call-outline-readonly__chip">Act {actId}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="card-body-wrapper function-call-outline-readonly__body-wrapper">
          <div className="card-body-content markdown-content">
            {mode === 'replace' && keys.length === 0 && (
              <div className="function-call-outline-readonly__empty">No effective field changes</div>
            )}

            {keys.map((key) => (
              <div className="function-call-outline-readonly__field" key={key}>
                <div className="function-call-outline-readonly__label">{humanizeKey(key)}</div>
                {renderValue(values[key])}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReadOnlyOutlineItemDisplay;
