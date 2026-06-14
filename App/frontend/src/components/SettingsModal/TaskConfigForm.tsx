import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  TaskAIConfig,
  ProviderType,
  AITaskType,
  ThinkingConfig,
  CustomKind,
  TokenizerOverride,
  CustomThinkingTemplate,
} from '../../store/settingsStore';
import { normalizeEffectiveTaskConfig } from '../../store/taskConfigSettings';
import ModelBrowser from './ModelBrowser';
import ThinkingTemplateEditor from './ThinkingTemplateEditor';
import ProviderSettingsFields from '../../providerEngine/ProviderSettingsFields';
import { TextButton } from '../TextButton';
import { CustomSelect } from '../ui/CustomSelect';
import { Warning, Settings, Advenced, Close } from '../icons';
import { useProviderSpecStore } from '../../providerEngine/store';
import {
  buildSelectOptions,
  getVisibleSpecEntries,
  isObjectSpec,
  resolveEffectiveLlmTaskSpec,
} from '../../providerEngine/utils';
import type { PublicFieldSpec } from '../../providerEngine/types';

interface TaskConfigFormProps {
  taskType: AITaskType;
  formKey?: string;
  config: TaskAIConfig;
  onChange: (config: TaskAIConfig) => void;
  customThinkingTemplates?: CustomThinkingTemplate[];
  onTemplatesChange?: (templates: CustomThinkingTemplate[]) => void;
}

const TaskConfigForm: React.FC<TaskConfigFormProps> = ({
  taskType,
  formKey,
  config,
  onChange,
  customThinkingTemplates = [],
  onTemplatesChange,
}) => {
  const { t } = useTranslation();
  const radioNameKey = formKey ?? taskType;
  const [showModelBrowser, setShowModelBrowser] = useState(false);
  const loadProviderSpecs = useProviderSpecStore((state) => state.load);
  const providerSpecs = useProviderSpecStore((state) => state.specs);
  const providerSpec = providerSpecs[config.provider];

  useEffect(() => {
    void loadProviderSpecs();
  }, [loadProviderSpecs]);

  const llmProviders = useMemo(() => {
    const providers = Object.values(providerSpecs).filter((provider) => Boolean(provider.llm));
    providers.sort((a, b) => {
      const left = a.ui.llm_order ?? 999;
      const right = b.ui.llm_order ?? 999;
      return left - right || a.id.localeCompare(b.id);
    });
    return providers;
  }, [providerSpecs]);

  const emitChange = (nextConfig: TaskAIConfig) => {
    onChange(normalizeEffectiveTaskConfig(nextConfig));
  };

  const effectiveSpec = useMemo(
    () => resolveEffectiveLlmTaskSpec(providerSpec, config as unknown as Record<string, unknown>),
    [providerSpec, config]
  );

  const advancedSpec = useMemo(() => {
    const advancedNode = effectiveSpec?.fields.advanced;
    return advancedNode && isObjectSpec(advancedNode) ? advancedNode : null;
  }, [effectiveSpec]);

  const advancedEntries = useMemo(
    () => getVisibleSpecEntries(advancedSpec, config as unknown as Record<string, unknown>),
    [advancedSpec, config]
  );

  const visibleAdvancedFields = useMemo(() => {
    return Object.fromEntries(advancedEntries.filter(([, node]) => !isObjectSpec(node))) as Record<string, PublicFieldSpec>;
  }, [advancedEntries]);

  const providerSettingsSpec = useMemo(() => {
    const node = advancedSpec?.fields.provider_settings;
    return node && isObjectSpec(node) && node.expose !== false ? node : null;
  }, [advancedSpec]);

  const thinkingConfigSpec = useMemo(() => {
    const node = advancedSpec?.fields.thinking_config;
    if (!node || !isObjectSpec(node)) return null;
    const visible = getVisibleSpecEntries(node, config as unknown as Record<string, unknown>);
    return visible.length > 0 ? node : null;
  }, [advancedSpec, config]);

  const thinkingConfigFields = useMemo(
    () => getVisibleSpecEntries(thinkingConfigSpec, config as unknown as Record<string, unknown>)
      .filter(([, node]) => !isObjectSpec(node)) as Array<[string, PublicFieldSpec]>,
    [thinkingConfigSpec, config]
  );

  const providerOptions = useMemo(() => {
    const options = llmProviders.map((provider) => ({
      value: provider.id,
      label: t(provider.ui.display_name_key),
    }));
    if (options.some((option) => option.value === config.provider)) return options;
    return [{ value: config.provider, label: config.provider }, ...options];
  }, [config.provider, llmProviders, t]);

  const customKindField = visibleAdvancedFields.custom_kind;
  const tokenizerField = visibleAdvancedFields.tokenizer_override;
  const thinkingModeField = visibleAdvancedFields.thinking_mode;
  const verbosityField = visibleAdvancedFields.verbosity;
  const templateField = visibleAdvancedFields.custom_thinking_template_id;
  const temperatureValue = Number.isFinite(config.temperature) ? config.temperature : 0.7;
  const contextWindowTokens = (
    typeof config.context_window_tokens === 'number'
    && Number.isFinite(config.context_window_tokens)
    && config.context_window_tokens > 0
  )
    ? config.context_window_tokens
    : null;
  const configuredMaxOutputTokens = (
    typeof config.max_output_tokens === 'number'
    && Number.isFinite(config.max_output_tokens)
  )
    ? config.max_output_tokens
    : null;
  const reservedOutputTokens = configuredMaxOutputTokens ?? 0;
  const finalInputBudget = contextWindowTokens === null
    ? null
    : contextWindowTokens - reservedOutputTokens;

  const formatTokenCount = (value: number) => Math.trunc(value).toLocaleString();

  const handleProviderChange = (provider: ProviderType) => {
    setShowModelBrowser(false);
    emitChange({
      ...config,
      provider,
      model: '',
    });
  };

  const handleThinkingConfigChange = (key: keyof ThinkingConfig, value: unknown) => {
    emitChange({
      ...config,
      advanced: {
        ...config.advanced,
        thinking_config: {
          ...(config.advanced.thinking_config ?? {}),
          [key]: value,
        },
      },
    });
  };

  const renderSelectField = (
    field: PublicFieldSpec,
    value: string,
    onFieldChange: (value: string) => void
  ) => (
    <CustomSelect
      value={value}
      onChange={onFieldChange}
      options={buildSelectOptions(t, field).map((option) => ({
        value: option.value,
        label: option.label,
        disabled: option.disabled,
      }))}
    />
  );

  const renderThinkingField = (fieldName: string, field: PublicFieldSpec) => {
    const label = field.ui?.label_key ? t(field.ui.label_key) : fieldName;
    const hint = field.ui?.help_key ? t(field.ui.help_key) : '';

    if (field.ui?.widget === 'template_select') {
      return (
        <div key={fieldName} className="form-field">
          <label>{label}</label>
          <CustomSelect
            value={config.advanced.custom_thinking_template_id || ''}
            onChange={(value) =>
              emitChange({
                ...config,
                advanced: {
                  ...config.advanced,
                  custom_thinking_template_id: value || undefined,
                },
              })
            }
            options={[
              { value: '', label: t('common.none') },
              ...customThinkingTemplates
                .filter((template) => template.id)
                .map((template) => ({
                  value: template.id!,
                  label: template.name,
                })),
            ]}
          />
          {hint ? <p className="field-hint">{hint}</p> : null}
        </div>
      );
    }

    if (field.ui?.widget === 'number' || field.kind === 'int' || field.kind === 'number') {
      const numericValue = (config.advanced.thinking_config?.[fieldName as keyof ThinkingConfig] as number | null | undefined) ?? '';
      return (
        <div key={fieldName} className="form-field">
          <label>{label}</label>
          <input
            type="number"
            min={field.min_value ?? undefined}
            max={field.max_value ?? undefined}
            step={field.step ?? undefined}
            value={numericValue}
            onChange={(event) =>
              handleThinkingConfigChange(
                fieldName as keyof ThinkingConfig,
                event.target.value === '' ? undefined : (field.kind === 'number' ? parseFloat(event.target.value) : parseInt(event.target.value, 10))
              )
            }
            placeholder={field.ui?.placeholder_key ? t(field.ui.placeholder_key) : undefined}
            className="config-input"
          />
          {hint ? <p className="field-hint">{hint}</p> : null}
        </div>
      );
    }

    const currentValue = String(
      config.advanced.thinking_config?.[fieldName as keyof ThinkingConfig]
      ?? field.default
      ?? field.options[0]
      ?? ''
    );

    return (
      <div key={fieldName} className="form-field">
        <label>{label}</label>
        {renderSelectField(field, currentValue, (value) =>
          handleThinkingConfigChange(fieldName as keyof ThinkingConfig, value)
        )}
        {hint ? <p className="field-hint">{hint}</p> : null}
      </div>
    );
  };

  return (
    <div className="task-config-form">
      <div className="config-section">
        <h4 className="section-title">{t('settings.taskConfig.basicSettings')}</h4>

        <div className="form-field">
          <label>{t('settings.taskConfig.provider')}</label>
          <CustomSelect
            value={config.provider}
            onChange={(value) => handleProviderChange(value as ProviderType)}
            options={providerOptions}
          />
          {providerSpec?.ui.description_key ? (
            <p className="field-hint">{t(providerSpec.ui.description_key)}</p>
          ) : null}
        </div>

        {customKindField ? (
          <div className="form-field">
            <label>{customKindField.ui?.label_key ? t(customKindField.ui.label_key) : 'custom_kind'}</label>
            {renderSelectField(
              customKindField,
              String(config.advanced.custom_kind ?? customKindField.default ?? customKindField.options[0] ?? ''),
              (value) =>
                emitChange({
                  ...config,
                  advanced: {
                    ...config.advanced,
                    custom_kind: value as CustomKind,
                  },
                })
            )}
            {customKindField.ui?.help_key ? <p className="field-hint">{t(customKindField.ui.help_key)}</p> : null}
          </div>
        ) : null}

        {tokenizerField ? (
          <div className="form-field">
            <label>{tokenizerField.ui?.label_key ? t(tokenizerField.ui.label_key) : 'tokenizer_override'}</label>
            {renderSelectField(
              tokenizerField,
              String(config.advanced.tokenizer_override ?? tokenizerField.default ?? tokenizerField.options[0] ?? ''),
              (value) =>
                emitChange({
                  ...config,
                  advanced: {
                    ...config.advanced,
                    tokenizer_override: value as TokenizerOverride,
                  },
                })
            )}
            {tokenizerField.ui?.help_key ? <p className="field-hint">{t(tokenizerField.ui.help_key)}</p> : null}
          </div>
        ) : null}

        <div className="form-field">
          <label>{t('settings.taskConfig.aiModel')}</label>
          <div className="model-input-row">
            <div className="model-input-control">
              <input
                type="text"
                value={config.model}
                onChange={(event) => emitChange({ ...config, model: event.target.value })}
                placeholder={t('settings.taskConfig.modelPlaceholder')}
                className="config-input"
              />
              {config.model ? (
                <button
                  type="button"
                  className="model-input-clear"
                  onClick={() => emitChange({ ...config, model: '' })}
                  aria-label={t('common.clear')}
                >
                  <Close size="xs" />
                </button>
              ) : null}
            </div>
            <TextButton
              variant={showModelBrowser ? 'primary' : 'secondary'}
              size="sm"
              type="button"
              onClick={() => setShowModelBrowser(!showModelBrowser)}
              title={t('settings.taskConfig.browse')}
            >
              {showModelBrowser ? t('common.hide') : t('common.browse')}
            </TextButton>
          </div>
          <p className="field-hint">{t('settings.taskConfig.modelHint')}</p>
          {showModelBrowser ? (
            <ModelBrowser
              key={config.provider}
              autoExpand={true}
              provider={config.provider}
              custom_kind={providerSpec?.llm?.variant_path ? (config.advanced.custom_kind ?? undefined) : undefined}
              currentModel={config.model}
              provider_preference={config.provider_preference ?? undefined}
              onSelectModel={(model) => emitChange({ ...config, model })}
              onUpdateProviderPreference={(pref) => emitChange({ ...config, provider_preference: pref })}
            />
          ) : null}
        </div>

        {verbosityField ? (
          <div className="form-field">
            <label>{verbosityField.ui?.label_key ? t(verbosityField.ui.label_key) : 'verbosity'}</label>
            {renderSelectField(
              verbosityField,
              String(config.advanced.verbosity ?? verbosityField.default ?? verbosityField.options[0] ?? ''),
              (value) =>
                emitChange({
                  ...config,
                  advanced: {
                    ...config.advanced,
                    verbosity: value as 'low' | 'medium' | 'high',
                  },
                })
            )}
            {verbosityField.ui?.help_key ? <p className="field-hint">{t(verbosityField.ui.help_key)}</p> : null}
          </div>
        ) : (
          <div className="form-field">
            <label>
              {t('settings.taskConfig.temperature')}: <span className="temperature-value">{temperatureValue.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={temperatureValue}
              onChange={(event) => emitChange({ ...config, temperature: parseFloat(event.target.value) })}
              className="temperature-slider"
            />
            <div className="temperature-labels">
              <small>{t('settings.taskConfig.temperatureLabels.precise')}</small>
              <small>{t('settings.taskConfig.temperatureLabels.balanced')}</small>
              <small>{t('settings.taskConfig.temperatureLabels.creative')}</small>
            </div>
            <p className="field-hint">{t('settings.taskConfig.temperatureHint')}</p>
          </div>
        )}

        <div className="form-field">
          <label>{t('settings.taskConfig.tokenLimits.context_window_tokens')}</label>
          <input
            type="number"
            min="1024"
            max="1000000"
            value={config.context_window_tokens ?? ''}
            onChange={(event) =>
              emitChange({
                ...config,
                context_window_tokens: event.target.value ? parseInt(event.target.value, 10) : undefined,
              })
            }
            placeholder="32000"
            className="config-input"
          />
          <p className="field-hint">{t('settings.taskConfig.tokenLimits.context_window_tokensHint')}</p>
        </div>

        <div className="form-field">
          <label>{t('settings.taskConfig.tokenLimits.max_output_tokens')}</label>
          <input
            type="number"
            min="1"
            max="1000000"
            value={config.max_output_tokens ?? ''}
            onChange={(event) =>
              emitChange({
                ...config,
                max_output_tokens: event.target.value ? parseInt(event.target.value, 10) : undefined,
              })
            }
            placeholder={t('settings.taskConfig.tokenLimits.max_output_tokensPlaceholder')}
            className="config-input"
          />
          <p className="field-hint">{t('settings.taskConfig.tokenLimits.max_output_tokensHint')}</p>
          <p className={`field-hint input-token-budget ${finalInputBudget !== null && finalInputBudget <= 0 ? 'input-token-budget--warning' : ''}`}>
            {finalInputBudget === null
              ? t('settings.taskConfig.tokenLimits.input_budget_no_limit')
              : t(
                finalInputBudget <= 0
                  ? 'settings.taskConfig.tokenLimits.input_budget_warning'
                  : 'settings.taskConfig.tokenLimits.input_budget_inline',
                { tokens: formatTokenCount(finalInputBudget) }
              )}
          </p>
        </div>
      </div>

      <div className="config-section advanced-section">
        <span className="advanced-warning-icon"><Warning size="xl" /></span>
        <h4 className="section-title"><Advenced size="lg" />{t('settings.taskConfig.advancedSettings')}</h4>

        <div className="advanced-options">
          <div className="thinking-mode-field">
            {thinkingModeField ? (
              <>
                <label className="field-label">
                  {thinkingModeField.ui?.label_key ? t(thinkingModeField.ui.label_key) : t('settings.taskConfig.thinking_mode')}
                </label>
                <div className="radio-group">
                  {thinkingModeField.options.map((option) => {
                    const value = String(option);
                    const disabled = thinkingModeField.disabled_options.includes(option);
                    const titleKey = `settings.taskConfig.thinking_modes.${value}`;
                    const descriptionKey = disabled && value === 'off'
                      ? 'settings.taskConfig.thinking_modes.offGeminiDisabled'
                      : `settings.taskConfig.thinking_modes.${value}Description`;
                    return (
                      <label key={value} className={`radio-option ${disabled ? 'disabled' : ''}`}>
                        <input
                          type="radio"
                          name={`thinking-mode-${radioNameKey}`}
                          value={value}
                          checked={config.advanced.thinking_mode === value}
                          onChange={() =>
                            emitChange({
                              ...config,
                              advanced: {
                                ...config.advanced,
                                thinking_mode: value as TaskAIConfig['advanced']['thinking_mode'],
                              },
                            })
                          }
                          disabled={disabled}
                        />
                        <div className="radio-content">
                          <span className="radio-title">{t(titleKey)}</span>
                          <span className="radio-description">{t(descriptionKey)}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </>
            ) : null}

            {config.advanced.thinking_mode === 'model' && (thinkingConfigFields.length > 0 || templateField) ? (
              <div className="thinking-config">
                <h5 className="subsection-title"><Settings size="sm" />{t('settings.taskConfig.thinking_config.title')}</h5>
                {thinkingConfigFields.map(([fieldName, field]) => renderThinkingField(fieldName, field))}
                {templateField ? renderThinkingField('custom_thinking_template_id', templateField) : null}
                {templateField && onTemplatesChange ? (
                  <>
                    <h4 className="section-title">{t('settings.taskConfig.templateManager.title')}</h4>
                    <ThinkingTemplateEditor
                      templates={customThinkingTemplates}
                      onChange={onTemplatesChange}
                    />
                  </>
                ) : null}
              </div>
            ) : null}

            {providerSettingsSpec ? (
              <ProviderSettingsFields
                spec={providerSettingsSpec}
                draft={
                  config.advanced.provider_settings &&
                  typeof config.advanced.provider_settings === 'object' &&
                  !Array.isArray(config.advanced.provider_settings)
                    ? (config.advanced.provider_settings as Record<string, unknown>)
                    : {}
                }
                rootDraft={config as unknown as Record<string, unknown>}
                setDraft={(next) => {
                  const prev =
                    config.advanced.provider_settings &&
                    typeof config.advanced.provider_settings === 'object' &&
                    !Array.isArray(config.advanced.provider_settings)
                      ? (config.advanced.provider_settings as Record<string, unknown>)
                      : {};
                  const resolved = typeof next === 'function' ? next(prev) : next;
                  emitChange({
                    ...config,
                    advanced: { ...config.advanced, provider_settings: resolved },
                  });
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaskConfigForm;
