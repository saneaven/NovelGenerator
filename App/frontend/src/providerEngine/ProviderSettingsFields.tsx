import React from 'react';
import { useTranslation } from 'react-i18next';
import { CustomSelect } from '../components/ui/CustomSelect';
import { NumberInput } from '../components/ui/NumberInput';
import type { PublicFieldSpec, PublicObjectSpec } from './types';
import {
  buildSelectOptions,
  getVisibleSpecEntries,
  isNodeDisabled,
  isObjectSpec,
  translateFieldHelp,
  translateFieldLabel,
} from './utils';
import './ProviderSettingsFields.css';

type ProviderSettingsFieldsProps = {
  spec: PublicObjectSpec;
  draft: Record<string, unknown>;
  setDraft: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  className?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sliderValue(field: PublicFieldSpec, value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof field.default === 'number' && Number.isFinite(field.default)) return field.default;
  if (typeof field.min_value === 'number') return field.min_value;
  return 0;
}

function updateNestedDraft(
  setDraft: React.Dispatch<React.SetStateAction<Record<string, unknown>>>,
  key: string,
  nextValue: Record<string, unknown>
) {
  setDraft((prev) => ({
    ...prev,
    [key]: nextValue,
  }));
}

export const ProviderSettingsFields: React.FC<ProviderSettingsFieldsProps> = ({
  spec,
  draft,
  setDraft,
  className,
}) => {
  const { t } = useTranslation();
  const entries = getVisibleSpecEntries(spec, draft);

  if (entries.length === 0) return null;

  const updateField = (fieldName: string, nextValue: unknown) => {
    setDraft((prev) => ({
      ...prev,
      [fieldName]: nextValue,
    }));
  };

  return (
    <div className={['provider-settings-fields', className].filter(Boolean).join(' ')}>
      {entries.map(([fieldName, node]) => {
        if (isObjectSpec(node)) {
          const childDraft = isPlainObject(draft[fieldName]) ? draft[fieldName] : {};
          return (
            <ProviderSettingsFields
              key={fieldName}
              spec={node}
              draft={childDraft}
              setDraft={(next) => {
                if (typeof next === 'function') {
                  const resolved = next(childDraft);
                  updateNestedDraft(setDraft, fieldName, resolved);
                  return;
                }
                updateNestedDraft(setDraft, fieldName, next);
              }}
            />
          );
        }

        const label = translateFieldLabel(t, node) || fieldName;
        const hint = translateFieldHelp(t, node);
        const disabled = isNodeDisabled(node, draft);
        const value = draft[fieldName];

        if (node.ui?.widget === 'slider') {
          const numericValue = sliderValue(node, value);
          return (
            <div key={fieldName} className="provider-settings-field">
              <label className="provider-settings-label">
                <span className="provider-settings-label-text">{label}</span>
                {hint ? <span className="provider-settings-label-hint">{hint}</span> : null}
              </label>
              <div className="provider-settings-slider-row">
                <input
                  type="range"
                  min={node.min_value ?? 0}
                  max={node.max_value ?? 1}
                  step={node.step ?? 0.05}
                  value={numericValue}
                  onChange={(event) => updateField(fieldName, Number(event.target.value))}
                  disabled={disabled}
                  className="provider-settings-slider"
                />
                <span className="provider-settings-slider-value">{numericValue.toFixed(2)}</span>
              </div>
            </div>
          );
        }

        if (node.ui?.widget === 'number' || node.kind === 'int' || node.kind === 'number') {
          return (
            <div key={fieldName} className="provider-settings-field">
              <label className="provider-settings-label">
                <span className="provider-settings-label-text">{label}</span>
                {hint ? <span className="provider-settings-label-hint">{hint}</span> : null}
              </label>
              <NumberInput
                min={node.min_value ?? undefined}
                max={node.max_value ?? undefined}
                step={node.step ?? undefined}
                integer={node.kind !== 'number'}
                value={typeof value === 'number' ? value : undefined}
                onValueChange={(nextValue) => updateField(fieldName, nextValue ?? node.default ?? null)}
                className="provider-settings-number"
                allowEmpty={!node.required}
                disabled={disabled}
              />
            </div>
          );
        }

        return (
          <div key={fieldName} className="provider-settings-field">
            <label className="provider-settings-label">
              <span className="provider-settings-label-text">{label}</span>
              {hint ? <span className="provider-settings-label-hint">{hint}</span> : null}
            </label>
            <CustomSelect
              value={String(value ?? node.default ?? '')}
              onChange={(nextValue) => updateField(fieldName, nextValue)}
              options={buildSelectOptions(t, node)}
              disabled={disabled}
            />
          </div>
        );
      })}
    </div>
  );
};

export default ProviderSettingsFields;
