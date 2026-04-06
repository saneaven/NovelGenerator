import React, { useEffect, useState } from 'react';
import { NumberInput } from '../ui/NumberInput';
import ToggleSwitch from '../common/ToggleSwitch';
import { cloneValue } from '../../providerEngine/utils';
import './NanoGptImageSettings.css';

type Props = {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  showStrength: boolean;
  showKontextMaxMode: boolean;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

type NumberFieldKey = 'strength' | 'guidance_scale' | 'num_inference_steps' | 'seed';
type NumberDraft = {
  overridden: boolean;
  value: number | undefined;
};

const NanoGptImageSettings: React.FC<Props> = ({
  value,
  onChange,
  showStrength,
  showKontextMaxMode,
}) => {
  const current = isObject(value) ? value : {};
  const [numberDrafts, setNumberDrafts] = useState<Record<NumberFieldKey, NumberDraft>>(() => ({
    strength: {
      overridden: Object.prototype.hasOwnProperty.call(current, 'strength'),
      value: typeof current.strength === 'number' ? current.strength : undefined,
    },
    guidance_scale: {
      overridden: Object.prototype.hasOwnProperty.call(current, 'guidance_scale'),
      value: typeof current.guidance_scale === 'number' ? current.guidance_scale : undefined,
    },
    num_inference_steps: {
      overridden: Object.prototype.hasOwnProperty.call(current, 'num_inference_steps'),
      value: typeof current.num_inference_steps === 'number' ? current.num_inference_steps : undefined,
    },
    seed: {
      overridden: Object.prototype.hasOwnProperty.call(current, 'seed'),
      value: typeof current.seed === 'number' ? current.seed : undefined,
    },
  }));

  useEffect(() => {
    setNumberDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      (['strength', 'guidance_scale', 'num_inference_steps', 'seed'] as const).forEach((key) => {
        const storedOverridden = Object.prototype.hasOwnProperty.call(current, key);
        const storedValue = typeof current[key] === 'number' ? current[key] : undefined;
        if (!storedOverridden && prev[key].overridden && prev[key].value === undefined) return;
        if (prev[key].overridden === storedOverridden && prev[key].value === storedValue) return;
        next[key] = { overridden: storedOverridden, value: storedValue };
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [current]);

  const pruneEmptyBranches = (node: Record<string, unknown>): Record<string, unknown> => {
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) {
      if (Array.isArray(child)) {
        if (child.length > 0) next[key] = child;
        continue;
      }
      if (isObject(child)) {
        const pruned = pruneEmptyBranches(child);
        if (Object.keys(pruned).length > 0) next[key] = pruned;
        continue;
      }
      if (child !== undefined && child !== null && child !== '') {
        next[key] = child;
      }
    }
    return next;
  };

  const commit = (mutator: (next: Record<string, unknown>) => void) => {
    const next = cloneValue(current) as Record<string, unknown>;
    mutator(next);
    onChange(pruneEmptyBranches(next));
  };

  const renderNumberField = (
    key: NumberFieldKey,
    label: string,
    options: { min?: number; max?: number; integer?: boolean } = {}
  ) => (
    <div className="nanogpt-image-settings__field">
      <div className="nanogpt-image-settings__label">
        <span>{label}</span>
      </div>
      <div className="nanogpt-image-settings__control">
        <NumberInput
          value={numberDrafts[key].value}
          min={options.min}
          max={options.max}
          integer={options.integer ?? false}
          allowEmpty={true}
          onValueChange={(nextValue) => {
            setNumberDrafts((prev) => ({
              ...prev,
              [key]: {
                ...prev[key],
                value: nextValue ?? undefined,
              },
            }));
            commit((next) => {
              if (nextValue == null) delete next[key];
              else next[key] = nextValue;
            });
          }}
          disabled={!numberDrafts[key].overridden}
          className="config-input"
        />
        <label className="nanogpt-image-settings__override">
          <input
            type="checkbox"
            checked={numberDrafts[key].overridden}
            onChange={(event) => {
              setNumberDrafts((prev) => ({
                ...prev,
                [key]: {
                  ...prev[key],
                  overridden: event.target.checked,
                },
              }));
              commit((next) => {
                if (!event.target.checked) {
                  delete next[key];
                }
              });
            }}
          />
          <span>Override</span>
        </label>
      </div>
    </div>
  );

  return (
    <div className="nanogpt-image-settings">
      {showStrength ? renderNumberField('strength', 'Strength', { min: 0, max: 1, integer: false }) : null}
      {renderNumberField('guidance_scale', 'Guidance Scale', { min: 0, max: 100, integer: false })}
      {renderNumberField('num_inference_steps', 'Inference Steps', { min: 1, max: 1000, integer: true })}
      {renderNumberField('seed', 'Seed', { min: 0, integer: true })}
      {showKontextMaxMode ? (
        <div className="nanogpt-image-settings__field">
          <div className="nanogpt-image-settings__label">
            <span>Kontext Max Mode</span>
          </div>
          <div className="nanogpt-image-settings__control">
            <ToggleSwitch
              checked={current.kontext_max_mode === true}
              onChange={(checked) => {
                commit((next) => {
                  next.kontext_max_mode = checked;
                });
              }}
              disabled={!Object.prototype.hasOwnProperty.call(current, 'kontext_max_mode')}
              label={current.kontext_max_mode === true ? 'Enabled' : 'Disabled'}
              mode="bare"
            />
            <label className="nanogpt-image-settings__override">
              <input
                type="checkbox"
                checked={Object.prototype.hasOwnProperty.call(current, 'kontext_max_mode')}
                onChange={(event) => {
                  commit((next) => {
                    if (!event.target.checked) {
                      delete next.kontext_max_mode;
                      return;
                    }
                    next.kontext_max_mode = Boolean(current.kontext_max_mode);
                  });
                }}
              />
              <span>Override</span>
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default NanoGptImageSettings;
