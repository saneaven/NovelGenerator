import React, { useMemo } from 'react';
import { MarkdownRenderer } from '../../MarkdownRenderer';
import '../../StoryObjectManager/StoryObjectCards/StoryObjectCards.css';

export interface ReadOnlyItemDisplayProps {
  title: string;
  values: Record<string, unknown>;
  mode: 'read' | 'create' | 'replace' | 'delete';
  changedFields?: string[];
  imageUrl?: string | null;
}

const FIELD_ORDER = [
  'title',
  'logline',
  'genre',
  'name',
  'description',
  'content',
  'authorNote',
  'order',
  'actId',
  'outlineId',
];

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .replace(/^\w/, (m) => m.toUpperCase());
}

function sortKeys(keys: string[]): string[] {
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
  if (value === null || value === undefined) {
    return <span className="function-call-readonly-item__empty">(empty)</span>;
  }

  if (typeof value === 'string') {
    if (!value.trim()) {
      return <span className="function-call-readonly-item__empty">(empty)</span>;
    }
    return <MarkdownRenderer className="function-call-readonly-item__markdown">{value}</MarkdownRenderer>;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return <div className="function-call-readonly-item__plain">{String(value)}</div>;
  }

  try {
    return <pre className="function-call-readonly-item__code">{JSON.stringify(value, null, 2)}</pre>;
  } catch {
    return <div className="function-call-readonly-item__plain">{String(value)}</div>;
  }
}

export const ReadOnlyItemDisplay: React.FC<ReadOnlyItemDisplayProps> = ({
  title,
  values,
  mode,
  changedFields,
  imageUrl,
}) => {
  const keys = useMemo(() => {
    const source = mode === 'replace' ? (changedFields ?? []) : Object.keys(values);
    const filtered = source.filter((key) => key in values);
    return sortKeys(filtered);
  }, [mode, changedFields, values]);

  const hasImage = Boolean(imageUrl);

  return (
    <article
      className="story-object-card function-call-readonly-item"
      data-has-image={hasImage}
      data-span={hasImage ? 'vertical' : 'text-only'}
    >
      <div className="story-object-card__content">
        <header className="story-object-card__header">
          <h4 className="story-object-card__title story-object-card__title--no-toggle">{title}</h4>
        </header>

        <div className="story-object-card__description-wrapper">
          <div className="story-object-card__description">
            {mode === 'replace' && keys.length === 0 && (
              <div className="function-call-readonly-item__empty">No effective field changes</div>
            )}

            {keys.map((key) => (
              <div className="function-call-readonly-item__field" key={key}>
                <div className="function-call-readonly-item__label">{humanizeKey(key)}</div>
                {renderValue(values[key])}
              </div>
            ))}
          </div>
        </div>
      </div>

      {hasImage && (
        <div className="story-object-card__image-container">
          <img src={imageUrl || ''} alt={title} className="story-object-card__image" loading="lazy" />
        </div>
      )}
    </article>
  );
};

export default ReadOnlyItemDisplay;
