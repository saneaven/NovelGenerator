import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CustomSelect } from '../components/ui/CustomSelect';
import { NumberInput } from '../components/ui/NumberInput';
import ToggleSwitch from '../components/common/ToggleSwitch';
import type { PublicFieldSpec, PublicObjectSpec } from './types';
import {
  buildSelectOptions,
  getVisibleSpecEntries,
  isNodeDisabled,
  isObjectSpec,
  translateFieldHelp,
  translateFieldLabel,
  translateFieldPlaceholder,
} from './utils';
import './ProviderSettingsFields.css';

type ProviderSettingsFieldsProps = {
  spec: PublicObjectSpec;
  draft: Record<string, unknown>;
  setDraft: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  className?: string;
  flags?: Record<string, unknown>;
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
  setDraft((prev) => ({ ...prev, [key]: nextValue }));
}

const UNSET_SENTINEL = '__unset__';

function formatSectionTitle(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/* ---- JSON field sub-component ---- */

type JsonFieldProps = {
  fieldName: string;
  label: string;
  hint: string;
  disabled: boolean;
  value: unknown;
  onChange: (fieldName: string, value: unknown) => void;
};

const JsonField: React.FC<JsonFieldProps> = ({ fieldName, label, hint, disabled, value, onChange }) => {
  const serialize = (v: unknown) =>
    isPlainObject(v) && Object.keys(v).length > 0 ? JSON.stringify(v, null, 2) : '';

  const [text, setText] = useState(() => serialize(value));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(serialize(value));
    setError(null);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setText(next);
    const trimmed = next.trim();
    if (!trimmed) {
      setError(null);
      onChange(fieldName, undefined);
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!isPlainObject(parsed)) {
        setError('Must be a JSON object.');
        return;
      }
      setError(null);
      onChange(fieldName, Object.keys(parsed).length > 0 ? parsed : undefined);
    } catch {
      setError('Invalid JSON.');
    }
  };

  return (
    <div className="provider-settings-field provider-settings-field--wide">
      <label className="provider-settings-label">
        <span className="provider-settings-label-text">{label}</span>
        {hint ? <span className="provider-settings-label-hint">{hint}</span> : null}
      </label>
      <textarea
        className="provider-settings-json-textarea"
        value={text}
        onChange={handleChange}
        disabled={disabled}
        rows={6}
        placeholder={`{\n  "key": "value"\n}`}
      />
      {error ? <p className="provider-settings-json-error">{error}</p> : null}
    </div>
  );
};

/* ---- Main component ---- */

export const ProviderSettingsFields: React.FC<ProviderSettingsFieldsProps> = ({
  spec,
  draft,
  setDraft,
  className,
  flags = {},
}) => {
  const { t } = useTranslation();
  const entries = getVisibleSpecEntries(spec, draft, flags);

  if (entries.length === 0) return null;

  /** Set a field value, or remove it from the draft when `undefined`. */
  const updateField = (fieldName: string, nextValue: unknown) => {
    setDraft((prev) => {
      if (nextValue === undefined) {
        const { [fieldName]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [fieldName]: nextValue };
    });
  };

  const renderChildSpec = (fieldName: string, node: PublicObjectSpec) => {
    const childDraft = isPlainObject(draft[fieldName]) ? draft[fieldName] : {};
    return (
      <ProviderSettingsFields
        key={fieldName}
        spec={node}
        draft={childDraft}
        flags={flags}
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
  };

  const renderField = (fieldName: string, node: PublicFieldSpec) => {
    const label = translateFieldLabel(t, node) || fieldName;
    const hint = translateFieldHelp(t, node);
    const disabled = isNodeDisabled(node, draft, flags);
    const value = draft[fieldName];
    const isSet = Object.prototype.hasOwnProperty.call(draft, fieldName);

    /* Bool / Toggle — ON = true in draft, OFF = remove key */
    if (node.kind === 'bool' || node.ui?.widget === 'toggle') {
      return (
        <div key={fieldName} className="provider-settings-field">
          <label className="provider-settings-label">
            <span className="provider-settings-label-text">{label}</span>
            {hint ? <span className="provider-settings-label-hint">{hint}</span> : null}
          </label>
          <ToggleSwitch
            checked={value === true}
            onChange={(checked) => updateField(fieldName, checked || undefined)}
            label={value === true ? 'Enabled' : 'Disabled'}
            mode="bare"
            disabled={disabled}
          />
        </div>
      );
    }

    /* JSON textarea */
    if (node.ui?.widget === 'json') {
      return (
        <JsonField
          key={fieldName}
          fieldName={fieldName}
          label={label}
          hint={hint}
          disabled={disabled}
          value={value}
          onChange={updateField}
        />
      );
    }

    /* Slider */
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

    /* Number input — empty = key removed from draft */
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
            onValueChange={(nextValue) => updateField(fieldName, nextValue ?? undefined)}
            className="provider-settings-number"
            allowEmpty={!node.required}
            disabled={disabled}
          />
        </div>
      );
    }

    /* Text input — empty = key removed from draft */
    if (node.kind === 'string') {
      const placeholder = translateFieldPlaceholder(t, node);
      return (
        <div key={fieldName} className="provider-settings-field">
          <label className="provider-settings-label">
            <span className="provider-settings-label-text">{label}</span>
            {hint ? <span className="provider-settings-label-hint">{hint}</span> : null}
          </label>
          <input
            type="text"
            className="provider-settings-text-input"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => {
              const trimmed = e.target.value;
              updateField(fieldName, trimmed || undefined);
            }}
            placeholder={placeholder}
            disabled={disabled}
          />
        </div>
      );
    }

    /* Select (enum) — "Default" option for non-required fields removes key from draft */
    const options = buildSelectOptions(t, node);
    if (!node.required) {
      options.unshift({ value: UNSET_SENTINEL, label: t('common.default', 'Default') });
    }

    return (
      <div key={fieldName} className="provider-settings-field">
        <label className="provider-settings-label">
          <span className="provider-settings-label-text">{label}</span>
          {hint ? <span className="provider-settings-label-hint">{hint}</span> : null}
        </label>
        <CustomSelect
          value={isSet ? String(value ?? '') : UNSET_SENTINEL}
          onChange={(nextValue) => {
            if (nextValue === UNSET_SENTINEL) {
              updateField(fieldName, undefined);
            } else {
              updateField(fieldName, nextValue);
            }
          }}
          options={options}
          disabled={disabled}
        />
      </div>
    );
  };

  /* --- Sectioned layout when nested ObjectSpecs exist --- */
  const hasSections = entries.some(([, node]) => isObjectSpec(node));

  if (hasSections) {
    return (
      <div className={['provider-settings-sections', className].filter(Boolean).join(' ')}>
        {/* Render ObjectSpec sections first, then standalone fields */}
        {[...entries].sort(([, a], [, b]) => {
          const aIsObj = isObjectSpec(a) ? 0 : 1;
          const bIsObj = isObjectSpec(b) ? 0 : 1;
          return aIsObj - bIsObj;
        }).map(([fieldName, node]) => {
          if (!isObjectSpec(node)) {
            return renderField(fieldName, node as PublicFieldSpec);
          }

          const childDraft = isPlainObject(draft[fieldName]) ? draft[fieldName] : {};

          /* ObjectSpec with group_toggle → section header toggle + collapsible children */
          if (node.group_toggle) {
            const toggleFieldName = node.group_toggle;
            const toggleNode = node.fields[toggleFieldName];
            const toggleLabel = (!isObjectSpec(toggleNode) && translateFieldLabel(t, toggleNode)) || formatSectionTitle(fieldName);
            const isToggleOn = childDraft[toggleFieldName] === true;

            const childSpecWithoutToggle: PublicObjectSpec = {
              ...node,
              fields: Object.fromEntries(
                Object.entries(node.fields).filter(([k]) => k !== toggleFieldName)
              ),
            };

            return (
              <div key={fieldName} className="provider-settings-section">
                <div className="provider-settings-section__header">
                  <h5 className="provider-settings-section__title">{toggleLabel}</h5>
                  <ToggleSwitch
                    checked={isToggleOn}
                    onChange={(checked) => {
                      updateNestedDraft(setDraft, fieldName, checked
                        ? { ...childDraft, [toggleFieldName]: true }
                        : {}
                      );
                    }}
                    label={isToggleOn ? 'Enabled' : 'Disabled'}
                    mode="bare"
                  />
                </div>
                {isToggleOn ? (
                  <ProviderSettingsFields
                    spec={childSpecWithoutToggle}
                    draft={childDraft}
                    flags={flags}
                    setDraft={(next) => {
                      if (typeof next === 'function') {
                        const resolved = next(childDraft);
                        updateNestedDraft(setDraft, fieldName, resolved);
                        return;
                      }
                      updateNestedDraft(setDraft, fieldName, next);
                    }}
                  />
                ) : null}
              </div>
            );
          }

          /* Single-bool ObjectSpec (e.g. scraping, youtube) → full-width toggle with label inside */
          {
            const childEntries = getVisibleSpecEntries(node, childDraft, flags);
            if (
              childEntries.length === 1
              && !isObjectSpec(childEntries[0][1])
              && (childEntries[0][1] as PublicFieldSpec).kind === 'bool'
            ) {
              const [boolName, boolNode] = childEntries[0] as [string, PublicFieldSpec];
              const boolLabel = translateFieldLabel(t, boolNode) || formatSectionTitle(fieldName);
              const boolValue = childDraft[boolName];
              return (
                <div key={fieldName} className="provider-settings-section">
                  <ToggleSwitch
                    checked={boolValue === true}
                    onChange={(checked) => {
                      updateNestedDraft(setDraft, fieldName, checked ? { [boolName]: true } : {});
                    }}
                    label={boolLabel}
                  />
                </div>
              );
            }
          }

          /* Normal section */
          return (
            <div key={fieldName} className="provider-settings-section">
              <h5 className="provider-settings-section__title">{formatSectionTitle(fieldName)}</h5>
              {renderChildSpec(fieldName, node)}
            </div>
          );
        })}
      </div>
    );
  }

  /* --- Flat grid layout (no sections, e.g. image provider settings) --- */
  return (
    <div className={['provider-settings-fields', className].filter(Boolean).join(' ')}>
      {entries.map(([fieldName, node]) => {
        if (isObjectSpec(node)) return renderChildSpec(fieldName, node as PublicObjectSpec);
        return renderField(fieldName, node as PublicFieldSpec);
      })}
    </div>
  );
};

export default ProviderSettingsFields;
