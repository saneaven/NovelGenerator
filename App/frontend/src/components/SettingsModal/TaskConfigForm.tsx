import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  TaskAIConfig,
  ProviderType,
  AITaskType,
  ThinkingConfig,
  RequestFormat,
  TokenizerOverride,
  CustomThinkingTemplate,
} from '../../store/settingsStore';
import ModelBrowser from './ModelBrowser';
import { TextButton } from '../TextButton';
import { CustomSelect } from '../ui/CustomSelect';
import { Warning, Settings, Advenced } from '../icons';

interface TaskConfigFormProps {
  taskType: AITaskType;
  config: TaskAIConfig;
  onChange: (config: TaskAIConfig) => void;
  customThinkingTemplates?: CustomThinkingTemplate[];
}

const TaskConfigForm: React.FC<TaskConfigFormProps> = ({
  taskType,
  config,
  onChange,
  customThinkingTemplates = [],
}) => {
  const { t } = useTranslation();
  const [showModelBrowser, setShowModelBrowser] = useState(false);

  // Detect if model is GPT-5 family (gpt-5, gpt-5-mini, gpt-5.1, etc.)
  const isGpt5 = config.provider === 'openai' && /gpt-?5/i.test(config.model);
  // GPT-5.2+ supports additional effort levels (minimal, xhigh)
  const isGpt52Plus = config.provider === 'openai' && /gpt-?5\.[2-9]/i.test(config.model);
  const isCustomProvider = config.provider === 'custom';
  const customRequestFormat: RequestFormat = config.advanced.request_format ?? 'openai_sdk';
  const isCustomClaudeSdk = isCustomProvider && customRequestFormat === 'claude_sdk';
  const hasThinkingTemplate = isCustomProvider && customRequestFormat === 'openai_sdk' && !!config.advanced.custom_thinking_template_id;

  const getDefaultThinkingConfig = (
    provider: ProviderType,
  ): ThinkingConfig | undefined => {
    switch (provider) {
      case 'openrouter':
      case 'openai':
      case 'xai':
      case 'custom':
        return { effort: 'medium' };
      case 'claude':
        return { effort: 'high' };
      case 'gemini':
        return undefined;
      default:
        return { effort: 'medium' };
    }
  };

  const handleProviderChange = (provider: ProviderType) => {
    // If switching to Gemini and thinking mode is 'off', change to 'model'
    // because Gemini doesn't support disabling thinking
    const newThinkingMode =
      provider === 'gemini' && config.advanced.thinking_mode === 'off'
        ? 'model'
        : config.advanced.thinking_mode;

    // Close model browser when provider changes
    setShowModelBrowser(false);

    onChange({
      ...config,
      provider,
      model: '',  // Clear model when provider changes
      provider_preference: provider === 'openrouter' ? config.provider_preference : undefined,
      advanced: {
        ...config.advanced,
        thinking_mode: newThinkingMode,
        thinking_config: getDefaultThinkingConfig(provider),
      },
    });
  };

  const handleModelChange = (model: string) => {
    onChange({ ...config, model });
  };

  const handleTemperatureChange = (temperature: number) => {
    onChange({ ...config, temperature });
  };

  const handleMaxOutputTokensChange = (value: number | undefined) => {
    onChange({ ...config, max_output_tokens: value });
  };

  const handleContextWindowTokensChange = (value: number | undefined) => {
    onChange({ ...config, context_window_tokens: value });
  };

  const handleThinkingModeChange = (mode: 'off' | 'model' | 'custom') => {
    onChange({
      ...config,
      advanced: {
        ...config.advanced,
        thinking_mode: mode,
      },
    });
  };

  const handleThinkingConfigChange = (
    key: keyof ThinkingConfig,
    value: any
  ) => {
    onChange({
      ...config,
      advanced: {
        ...config.advanced,
        thinking_config: {
          ...config.advanced.thinking_config,
          [key]: value,
        },
      },
    });
  };

  const handleThinkingTemplateChange = (templateId: string | undefined) => {
    onChange({
      ...config,
      advanced: {
        ...config.advanced,
        custom_thinking_template_id: templateId,
      },
    });
  };

  const handleRequestFormatChange = (format: RequestFormat) => {
    onChange({
      ...config,
      advanced: {
        ...config.advanced,
        request_format: format,
      },
    });
  };

  const handleTokenizerOverrideChange = (tokenizer: TokenizerOverride | undefined) => {
    onChange({
      ...config,
      advanced: {
        ...config.advanced,
        tokenizer_override: tokenizer,
      },
    });
  };

  return (
    <div className="task-config-form">
      {/* Basic Settings */}
      <div className="config-section">
        <h4 className="section-title">{t('settings.taskConfig.basicSettings')}</h4>

        <div className="form-field">
          <label>{t('settings.taskConfig.provider')}</label>
          <CustomSelect
            value={config.provider}
            onChange={(value) => handleProviderChange(value as ProviderType)}
            options={[
              { value: 'openai', label: 'OpenAI' },
              { value: 'gemini', label: 'Gemini' },
              { value: 'claude', label: 'Claude' },
              { value: 'openrouter', label: 'OpenRouter' },
              { value: 'xai', label: 'xAI (Grok)' },
              { value: 'custom', label: t('settings.credentials.custom.title') },
            ]}
          />
          <p className="field-hint">
            {config.provider === 'openai' && t('settings.taskConfig.providerDescriptions.openai')}
            {config.provider === 'gemini' && t('settings.taskConfig.providerDescriptions.gemini')}
            {config.provider === 'claude' && t('settings.taskConfig.providerDescriptions.claude')}
            {config.provider === 'openrouter' && t('settings.taskConfig.providerDescriptions.openrouter')}
            {config.provider === 'xai' && t('settings.taskConfig.providerDescriptions.xai')}
            {isCustomProvider && t('settings.taskConfig.providerDescriptions.custom')}
          </p>
        </div>

        {isCustomProvider && (
          <div className="form-field">
            <label>{t('settings.taskConfig.requestFormat')}</label>
            <CustomSelect
              value={customRequestFormat}
              onChange={(value) =>
                handleRequestFormatChange(value as RequestFormat)
              }
              options={[
                { value: 'openai_sdk', label: 'OpenAI SDK' },
                { value: 'claude_sdk', label: 'Claude SDK' },
              ]}
            />
            <p className="field-hint">{t('settings.taskConfig.requestFormatHint')}</p>
          </div>
        )}

        {/* Tokenizer selector for OpenRouter and Custom providers */}
        {(config.provider === 'openrouter' || isCustomProvider) && (
          <div className="form-field">
            <label>{t('settings.taskConfig.tokenizer')}</label>
            <CustomSelect
              value={config.advanced.tokenizer_override || 'openai'}
              onChange={(value) => handleTokenizerOverrideChange(value as TokenizerOverride)}
              options={[
                { value: 'openai', label: 'OpenAI (tiktoken)' },
                { value: 'claude', label: 'Claude' },
                { value: 'gemini', label: 'Gemini' },
              ]}
            />
            <p className="field-hint">
              {t('settings.taskConfig.tokenizerHint')}
            </p>
          </div>
        )}

        <div className="form-field">
          <label>{t('settings.taskConfig.aiModel')}</label>
          <div className="model-input-row">
            <input
              type="text"
              value={config.model}
              onChange={(e) => handleModelChange(e.target.value)}
              placeholder={t('settings.taskConfig.modelPlaceholder')}
              className="config-input"
            />
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
          <p className="field-hint">
            {t('settings.taskConfig.modelHint')}
          </p>
          {/* Model Browser */}
          {showModelBrowser && (
            <ModelBrowser
              key={config.provider}  // Remount when provider changes
              autoExpand={true}
              provider={config.provider}
              request_format={config.provider === 'custom' ? customRequestFormat : undefined}
              currentModel={config.model}
              provider_preference={config.provider_preference}
              onSelectModel={handleModelChange}
              onUpdateProviderPreference={(pref) =>
                onChange({ ...config, provider_preference: pref })
              }
            />
          )}
        </div>

        <div className={`form-field ${isGpt5 ? 'disabled' : ''}`}>
          <label>
            {t('settings.taskConfig.temperature')}: <span className="temperature-value">{config.temperature.toFixed(1)}</span>
          </label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={config.temperature}
            onChange={(e) => handleTemperatureChange(parseFloat(e.target.value))}
            className="temperature-slider"
            disabled={isGpt5}
          />
          <div className="temperature-labels">
            <small>{t('settings.taskConfig.temperatureLabels.precise')}</small>
            <small>{t('settings.taskConfig.temperatureLabels.balanced')}</small>
            <small>{t('settings.taskConfig.temperatureLabels.creative')}</small>
          </div>
          <p className="field-hint">
            {isGpt5
              ? t('settings.taskConfig.temperatureGpt5Hint')
              : t('settings.taskConfig.temperatureHint')}
          </p>
        </div>

        <div className="form-field">
          <label>{t('settings.taskConfig.tokenLimits.context_window_tokens')}</label>
          <input
            type="number"
            min="1024"
            max="1000000"
            value={config.context_window_tokens ?? ''}
            onChange={(e) =>
              handleContextWindowTokensChange(
                e.target.value ? parseInt(e.target.value) : undefined
              )
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
            onChange={(e) =>
              handleMaxOutputTokensChange(
                e.target.value ? parseInt(e.target.value) : undefined
              )
            }
            placeholder={t('settings.taskConfig.tokenLimits.max_output_tokensPlaceholder')}
            className="config-input"
          />
          <p className="field-hint">{t('settings.taskConfig.tokenLimits.max_output_tokensHint')}</p>
        </div>
      </div>

      {/* Advanced Settings */}
      <div className="config-section advanced-section">
        <span className="advanced-warning-icon"><Warning size="xl" /></span>
        <h4 className="section-title"><Advenced size="lg" />{t('settings.taskConfig.advancedSettings')}</h4>

        <div className="advanced-options">
          {/* Custom endpoint - thinking template selector (OpenAI SDK transport only) */}
          {isCustomProvider && customRequestFormat === 'openai_sdk' && customThinkingTemplates.length > 0 && (
            <div className="form-field">
              <label>{t('settings.taskConfig.thinkingTemplate')}</label>
              <CustomSelect
                value={config.advanced.custom_thinking_template_id || ''}
                onChange={(value) =>
                  handleThinkingTemplateChange(value || undefined)
                }
                options={[
                  { value: '', label: t('common.none') },
                  ...customThinkingTemplates
                    .filter((tpl) => tpl.id)
                    .map((tpl) => ({
                      value: tpl.id!,
                      label: tpl.name,
                    })),
                ]}
              />
              <p className="field-hint">{t('settings.taskConfig.thinkingTemplateHint')}</p>
            </div>
          )}

          <div className="thinking-mode-field">
            <label className="field-label">{t('settings.taskConfig.thinking_mode')}</label>
            <div className="radio-group">
              <label className={`radio-option ${config.provider === 'gemini' ? 'disabled' : ''}`}>
                <input
                  type="radio"
                  name={`thinking-mode-${taskType}`}
                  value="off"
                  checked={config.advanced.thinking_mode === 'off'}
                  onChange={() => handleThinkingModeChange('off')}
                  disabled={config.provider === 'gemini'}
                />
                <div className="radio-content">
                  <span className="radio-title">{t('settings.taskConfig.thinking_modes.off')}</span>
                  <span className="radio-description">
                    {config.provider === 'gemini'
                      ? t('settings.taskConfig.thinking_modes.offGeminiDisabled')
                      : t('settings.taskConfig.thinking_modes.offDescription')}
                  </span>
                </div>
              </label>

              <label className="radio-option">
                <input
                  type="radio"
                  name={`thinking-mode-${taskType}`}
                  value="model"
                  checked={config.advanced.thinking_mode === 'model'}
                  onChange={() => handleThinkingModeChange('model')}
                />
                <div className="radio-content">
                  <span className="radio-title">{t('settings.taskConfig.thinking_modes.model')}</span>
                  <span className="radio-description">
                    {t('settings.taskConfig.thinking_modes.modelDescription')}
                  </span>
                </div>
              </label>

              <label className="radio-option">
                <input
                  type="radio"
                  name={`thinking-mode-${taskType}`}
                  value="custom"
                  checked={config.advanced.thinking_mode === 'custom'}
                  onChange={() => handleThinkingModeChange('custom')}
                />
                <div className="radio-content">
                  <span className="radio-title">{t('settings.taskConfig.thinking_modes.custom')}</span>
                  <span className="radio-description">
                    {t('settings.taskConfig.thinking_modes.customDescription')}
                  </span>
                </div>
              </label>
            </div>

            {/* Thinking Config (only shown for model mode) */}
            {config.advanced.thinking_mode === 'model' && (
              <div className="thinking-config">
                <h5 className="subsection-title"><Settings size="sm" />{t('settings.taskConfig.thinking_config.title')}</h5>

                {/* Generic settings for OpenRouter/OpenAI (not custom) */}
                {(config.provider === 'openrouter' || config.provider === 'openai' || config.provider === 'xai') && (
                  <>
                    <div className="form-field">
                      <label>{isGpt5 ? t('settings.taskConfig.thinking_config.reasoningEffort') : t('settings.taskConfig.thinking_config.effortLevel')}</label>
                      <CustomSelect
                        value={config.advanced.thinking_config?.effort || 'medium'}
                        onChange={(value) => handleThinkingConfigChange('effort', value)}
                        options={[
                          ...(isGpt5 ? [{ value: 'none', label: t('settings.taskConfig.thinking_config.effortOptions.none') }] : []),
                          ...(isGpt52Plus ? [{ value: 'minimal', label: t('settings.taskConfig.thinking_config.effortOptions.minimal') }] : []),
                          { value: 'low', label: isGpt5 ? t('settings.taskConfig.thinking_config.effortOptions.lowPercent') : t('settings.taskConfig.thinking_config.effortOptions.low') },
                          { value: 'medium', label: isGpt5 ? t('settings.taskConfig.thinking_config.effortOptions.mediumPercent') : t('settings.taskConfig.thinking_config.effortOptions.medium') },
                          { value: 'high', label: isGpt5 ? t('settings.taskConfig.thinking_config.effortOptions.highPercent') : t('settings.taskConfig.thinking_config.effortOptions.high') },
                          ...(isGpt52Plus ? [{ value: 'xhigh', label: t('settings.taskConfig.thinking_config.effortOptions.xhigh') }] : []),
                        ]}
                      />
                      <p className="field-hint">
                        {isGpt5
                          ? t('settings.taskConfig.thinking_config.effortHint')
                          : t('settings.taskConfig.thinking_config.effortHintGeneric')}
                      </p>
                    </div>

                    {/* Verbosity dropdown - GPT-5 only */}
                    {isGpt5 && (
                      <div className="form-field">
                        <label>{t('settings.taskConfig.thinking_config.verbosity')}</label>
                        <CustomSelect
                          value={config.advanced.thinking_config?.verbosity || 'medium'}
                          onChange={(value) => handleThinkingConfigChange('verbosity', value)}
                          options={[
                            { value: 'low', label: t('settings.taskConfig.thinking_config.verbosityOptions.low') },
                            { value: 'medium', label: t('settings.taskConfig.thinking_config.verbosityOptions.medium') },
                            { value: 'high', label: t('settings.taskConfig.thinking_config.verbosityOptions.high') },
                          ]}
                        />
                        <p className="field-hint">
                          {t('settings.taskConfig.thinking_config.verbosityHint')}
                        </p>
                      </div>
                    )}

                    {/* Max tokens - not for GPT-5 (uses max_output_tokens automatically) */}
                    {!isGpt5 && (
                      <div className="form-field">
                        <label>{t('settings.taskConfig.thinking_config.maxThinkingTokens')}</label>
                        <input
                          type="number"
                          min="1024"
                          max="32000"
                          value={config.advanced.thinking_config?.max_tokens || ''}
                          onChange={(e) =>
                            handleThinkingConfigChange(
                              'max_tokens',
                              e.target.value ? parseInt(e.target.value) : undefined
                            )
                          }
                          placeholder={t('settings.taskConfig.thinking_config.maxThinkingTokensPlaceholder')}
                          className="config-input"
                        />
                        <p className="field-hint">
                          {t('settings.taskConfig.thinking_config.maxThinkingTokensHint')}
                        </p>
                      </div>
                    )}
                  </>
                )}

                {/* Custom endpoint - thinking config (hidden when template is selected) */}
                {config.provider === 'custom' && !hasThinkingTemplate && !isCustomClaudeSdk && (
                  <div className="form-field">
                    <label>{t('settings.taskConfig.thinking_config.reasoningEffort')}</label>
                    <CustomSelect
                      value={config.advanced.thinking_config?.effort || 'medium'}
                      onChange={(value) => handleThinkingConfigChange('effort', value)}
                      options={[
                        { value: 'none', label: t('settings.taskConfig.thinking_config.effortOptions.none') },
                        { value: 'low', label: t('settings.taskConfig.thinking_config.effortOptions.low') },
                        { value: 'medium', label: t('settings.taskConfig.thinking_config.effortOptions.medium') },
                        { value: 'high', label: t('settings.taskConfig.thinking_config.effortOptions.high') },
                      ]}
                    />
                    <p className="field-hint">{t('settings.taskConfig.thinking_config.effortHint')}</p>
                  </div>
                )}
                {config.provider === 'custom' && !hasThinkingTemplate && isCustomClaudeSdk && (
                  <div className="form-field">
                    <label>{t('settings.taskConfig.thinking_config.effortLevel')}</label>
                    <CustomSelect
                      value={config.advanced.thinking_config?.effort || 'high'}
                      onChange={(value) => handleThinkingConfigChange('effort', value)}
                      options={[
                        { value: 'low', label: t('settings.taskConfig.thinking_config.effortOptions.low') },
                        { value: 'medium', label: t('settings.taskConfig.thinking_config.effortOptions.medium') },
                        { value: 'high', label: t('settings.taskConfig.thinking_config.effortOptions.high') },
                        { value: 'max', label: t('settings.taskConfig.thinking_config.effortOptions.max') },
                      ]}
                    />
                    <p className="field-hint">{t('settings.taskConfig.thinking_config.effortHintGeneric')}</p>
                  </div>
                )}

                {/* Claude-specific */}
                {config.provider === 'claude' && (
                  <div className="form-field">
                    <label>{t('settings.taskConfig.thinking_config.effortLevel')}</label>
                    <CustomSelect
                      value={config.advanced.thinking_config?.effort || 'high'}
                      onChange={(value) => handleThinkingConfigChange('effort', value)}
                      options={[
                        { value: 'low', label: t('settings.taskConfig.thinking_config.effortOptions.low') },
                        { value: 'medium', label: t('settings.taskConfig.thinking_config.effortOptions.medium') },
                        { value: 'high', label: t('settings.taskConfig.thinking_config.effortOptions.high') },
                        { value: 'max', label: t('settings.taskConfig.thinking_config.effortOptions.max') },
                      ]}
                    />
                    <p className="field-hint">{t('settings.taskConfig.thinking_config.effortHintGeneric')}</p>
                  </div>
                )}

                {/* Gemini-specific */}
                {config.provider === 'gemini' && (
                  <>
                    {config.model.toLowerCase().includes('gemini-3') && (
                      <div className="form-field">
                        <label>{t('settings.taskConfig.thinking_config.thinkingLevelGemini3')}</label>
                        {/*
                          Gemini 3 supports only 'low' | 'high'. Default to 'high' if legacy value exists.
                        */}
                        {(() => {
                          const lvl = config.advanced.thinking_config?.gemini_thinking_level === 'low' ? 'low' : 'high';
                          if (config.advanced.thinking_config?.gemini_thinking_level !== lvl) {
                            handleThinkingConfigChange('gemini_thinking_level', lvl);
                          }
                          return null;
                        })()}
                        <CustomSelect
                          value={
                            config.advanced.thinking_config?.gemini_thinking_level === 'low'
                              ? 'low'
                              : 'high'
                          }
                          onChange={(value) =>
                            handleThinkingConfigChange(
                              'gemini_thinking_level',
                              value as ThinkingConfig['gemini_thinking_level']
                            )
                          }
                          options={[
                            { value: 'low', label: t('common.low') },
                            { value: 'high', label: t('common.high') },
                          ]}
                        />
                        <p className="field-hint">{t('settings.taskConfig.thinking_config.thinkingLevelGemini3Hint')}</p>
                      </div>
                    )}

                    {config.model.toLowerCase().includes('2.5') && (
                      <div className="form-field">
                        <label>{t('settings.taskConfig.thinking_config.thinkingBudget25')}</label>
                        <input
                          type="number"
                          min="0"
                          value={config.advanced.thinking_config?.gemini_budget_tokens ?? ''}
                          onChange={(e) =>
                            handleThinkingConfigChange(
                              'gemini_budget_tokens',
                              e.target.value === '' ? undefined : parseInt(e.target.value)
                            )
                          }
                          placeholder={t('settings.taskConfig.thinking_config.thinkingBudget25Placeholder')}
                          className="config-input"
                        />
                        <p className="field-hint">{t('settings.taskConfig.thinking_config.thinkingBudget25Hint')}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
};

export default TaskConfigForm;
