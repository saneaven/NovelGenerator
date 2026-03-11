import React, { useMemo, useState } from 'react';
import { Close } from '../icons';
import { normalizeStringList } from '../../utils/basicInfo';
import './StringChipInput.css';

interface StringChipInputProps {
  values: string[];
  onChange: (nextValues: string[]) => void;
  placeholder?: string;
  ariaLabel: string;
}

const SPLIT_RE = /[,\n\r\t]+/;

export const StringChipInput: React.FC<StringChipInputProps> = ({
  values,
  onChange,
  placeholder,
  ariaLabel,
}) => {
  const [draft, setDraft] = useState('');
  const normalizedValues = useMemo(() => normalizeStringList(values), [values]);

  const commitDraft = (rawValue: string) => {
    const nextValues = normalizeStringList([
      ...normalizedValues,
      ...rawValue.split(SPLIT_RE),
    ]);
    if (nextValues.length !== normalizedValues.length || rawValue.trim()) {
      onChange(nextValues);
    }
    setDraft('');
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
      if (draft.trim()) {
        event.preventDefault();
        commitDraft(draft);
      }
      return;
    }

    if (event.key === 'Backspace' && !draft) {
      onChange(normalizedValues.slice(0, -1));
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text');
    if (!pasted || !SPLIT_RE.test(pasted)) {
      return;
    }
    event.preventDefault();
    commitDraft(`${draft}${pasted}`);
  };

  const removeValue = (value: string) => {
    onChange(normalizedValues.filter((entry) => entry !== value));
  };

  return (
    <div className="string-chip-input">
      <div className="string-chip-input__chips">
        {normalizedValues.map((value) => (
          <span key={value} className="string-chip-input__chip">
            <span>{value}</span>
            <button
              type="button"
              className="string-chip-input__chip-remove"
              onClick={() => removeValue(value)}
              aria-label={`Remove ${value}`}
            >
              <Close size="xs" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (draft.trim()) {
              commitDraft(draft);
            }
          }}
          onPaste={handlePaste}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="string-chip-input__field"
        />
      </div>
    </div>
  );
};

export default StringChipInput;
