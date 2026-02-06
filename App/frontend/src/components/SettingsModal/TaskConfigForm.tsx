import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  TaskAIConfig,
  ProviderType,
  AITaskType,
  ProviderCredentials,
  ThinkingConfig,
  CustomApiFormat,
  TokenizerOverride,
} from '../../store/settingsStore';
import ModelBrowser from './ModelBrowser';
import { TextButton } from '../TextButton';
import { CustomSelect } from '../ui/CustomSelect';
import { Warning, Settings, Advenced } from '../icons';

interface TaskConfigFormProps {
  taskType: AITaskType;
  config: TaskAIConfig;
  credentials: ProviderCredentials;
  onChange: (config: TaskAIConfig) => void;
}

const TaskConfigForm: React.FC<TaskConfigFormProps> = ({
  taskType,
  config,
  credentials,
  onChange,
}) => {
  const { t } = useTranslation();
  const [showModelBrowser, setShowModelBrowser] = useState(false);

  // Detect if model is GPT-5 family (gpt-5, gpt-5-mini, gpt-5.1, etc.)
  const isGpt5 = config.provider === 'openai' && /gpt-?5/i.test(config.model);
  // GPT-5.2+ supports additional effort levels (minimal, xhigh)
  const isGpt52Plus = config.provider === 'openai' && /gpt-?5\.[2-9]/i.test(config.model);

  const handleProviderChange = (provider: ProviderType) => {
    // If switching to Gemini and thinking mode is 'off', change to 'model'
    // because Gemini doesn't support disabling thinking
    const newThinkingMode =
      provider === 'gemini' && config.advanced.thinkingMode === 'off'
        ? 'model'
        : config.advanced.thinkingMode;

    // Close model browser when provider changes
    setShowModelBrowser(false);

    onChange({
      ...config,
      provider,
      model: '',  // Clear model when provider changes
      providerPreference: provider === 'openrouter' ? config.providerPreference : undefined,
      advanced: {
        ...config.advanced,
        thinkingMode: newThinkingMode,
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
    onChange({ ...config, maxOutputTokens: value });
  };

  const handleContextWindowTokensChange = (value: number | undefined) => {
    onChange({ ...config, contextWindowTokens: value });
  };

  const handleAdvancedChange = (key: 'enablePrefill', value: boolean) => {
    onChange({
      ...config,
      advanced: {
        ...config.advanced,
        [key]: value,
      },
    });
  };

  const handleThinkingModeChange = (mode: 'off' | 'model' | 'custom') => {
    onChange({
      ...config,
      advanced: {
        ...config.advanced,
        thinkingMode: mode,
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
        thinkingConfig: {
          ...config.advanced.thinkingConfig,
          [key]: value,
        },
      },
    });
  };

  const handleCustomApiFormatChange = (format: CustomApiFormat | undefined) => {
    onChange({
      ...config,
      advanced: {
        ...config.advanced,
        customApiFormat: format,
      },
    });
  };

  const handleTokenizerOverrideChange = (tokenizer: TokenizerOverride | undefined) => {
    onChange({
      ...config,
      advanced: {
        ...config.advanced,
        tokenizerOverride: tokenizer,
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
            {config.provider === 'custom' && t('settings.taskConfig.providerDescriptions.custom')}
          </p>
        </div>

        {/* Tokenizer selector for OpenRouter and Custom providers */}
        {(config.provider === 'openrouter' || config.provider === 'custom') && (
          <div className="form-field">
            <label>{t('settings.taskConfig.tokenizer')}</label>
            <CustomSelect
              value={config.advanced.tokenizerOverride || 'openai'}
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
              currentModel={config.model}
              providerPreference={config.providerPreference}
              credentials={credentials}
              onSelectModel={handleModelChange}
              onUpdateProviderPreference={(pref) =>
                onChange({ ...config, providerPreference: pref })
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
          <label>{t('settings.taskConfig.tokenLimits.contextWindowTokens')}</label>
          <input
            type="number"
            min="1024"
            max="1000000"
            value={config.contextWindowTokens ?? ''}
            onChange={(e) =>
              handleContextWindowTokensChange(
                e.target.value ? parseInt(e.target.value) : undefined
              )
            }
            placeholder="32000"
            className="config-input"
          />
          <p className="field-hint">{t('settings.taskConfig.tokenLimits.contextWindowTokensHint')}</p>
        </div>

        <div className="form-field">
          <label>{t('settings.taskConfig.tokenLimits.maxOutputTokens')}</label>
          <input
            type="number"
            min="1"
            max="1000000"
            value={config.maxOutputTokens ?? ''}
            onChange={(e) =>
              handleMaxOutputTokensChange(
                e.target.value ? parseInt(e.target.value) : undefined
              )
            }
            placeholder={t('settings.taskConfig.tokenLimits.maxOutputTokensPlaceholder')}
            className="config-input"
          />
          <p className="field-hint">{t('settings.taskConfig.tokenLimits.maxOutputTokensHint')}</p>
        </div>
      </div>

      {/* Advanced Settings */}
      <div className="config-section advanced-section">
        <span className="advanced-warning-icon"><Warning size="xl" /></span>
        <h4 className="section-title"><Advenced size="lg" />{t('settings.taskConfig.advancedSettings')}</h4>

        <div className="advanced-options">
          {/* Custom endpoint - thinking format selector */}
          {config.provider === 'custom' && (
            <div className="form-field">
              <label>{t('settings.taskConfig.apiFormat')}</label>
              <CustomSelect
                value={config.advanced.customApiFormat || 'openai'}
                onChange={(value) =>
                  handleCustomApiFormatChange(value as CustomApiFormat)
                }
                options={[
                  { value: 'openai', label: 'OpenAI' },
                  { value: 'claude', label: 'Claude' },
                  { value: 'gemini', label: 'Gemini' },
                ]}
              />
              <p className="field-hint">{t('settings.taskConfig.apiFormatHint')}</p>
            </div>
          )}

          <div className={`checkbox-field prefill-field ${config.provider === 'openai' ? 'disabled' : ''}`}>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.advanced.enablePrefill}
                onChange={(e) => handleAdvancedChange('enablePrefill', e.target.checked)}
                disabled={config.provider === 'openai'}
              />
              <div className="checkbox-content">
                <span className="checkbox-title">{t('settings.taskConfig.enablePrefill')}</span>
                <span className="checkbox-description">
                  {config.provider === 'openai'
                    ? t('settings.taskConfig.prefillDisabled')
                    : t('settings.taskConfig.prefillHint')}
                </span>
              </div>
            </label>
          </div>

          <div className="thinking-mode-field">
            <label className="field-label">{t('settings.taskConfig.thinkingMode')}</label>
            <div className="radio-group">
              <label className={`radio-option ${config.provider === 'gemini' ? 'disabled' : ''}`}>
                <input
                  type="radio"
                  name={`thinking-mode-${taskType}`}
                  value="off"
                  checked={config.advanced.thinkingMode === 'off'}
                  onChange={() => handleThinkingModeChange('off')}
                  disabled={config.provider === 'gemini'}
                />
                <div className="radio-content">
                  <span className="radio-title">{t('settings.taskConfig.thinkingModes.off')}</span>
                  <span className="radio-description">
                    {config.provider === 'gemini'
                      ? t('settings.taskConfig.thinkingModes.offGeminiDisabled')
                      : t('settings.taskConfig.thinkingModes.offDescription')}
                  </span>
                </div>
              </label>

              <label className="radio-option">
                <input
                  type="radio"
                  name={`thinking-mode-${taskType}`}
                  value="model"
                  checked={config.advanced.thinkingMode === 'model'}
                  onChange={() => handleThinkingModeChange('model')}
                />
                <div className="radio-content">
                  <span className="radio-title">{t('settings.taskConfig.thinkingModes.model')}</span>
                  <span className="radio-description">
                    {t('settings.taskConfig.thinkingModes.modelDescription')}
                  </span>
                </div>
              </label>

              <label className="radio-option">
                <input
                  type="radio"
                  name={`thinking-mode-${taskType}`}
                  value="custom"
                  checked={config.advanced.thinkingMode === 'custom'}
                  onChange={() => handleThinkingModeChange('custom')}
                />
                <div className="radio-content">
                  <span className="radio-title">{t('settings.taskConfig.thinkingModes.custom')}</span>
                  <span className="radio-description">
                    {t('settings.taskConfig.thinkingModes.customDescription')}
                  </span>
                </div>
              </label>
            </div>

            {/* Thinking Config (only shown for model mode) */}
            {config.advanced.thinkingMode === 'model' && (
              <div className="thinking-config">
                <h5 className="subsection-title"><Settings size="sm" />{t('settings.taskConfig.thinkingConfig.title')}</h5>

                {/* Generic settings for OpenRouter/OpenAI (not custom) */}
                {(config.provider === 'openrouter' || config.provider === 'openai' || config.provider === 'xai') && (
                  <>
                    <div className="form-field">
                      <label>{isGpt5 ? t('settings.taskConfig.thinkingConfig.reasoningEffort') : t('settings.taskConfig.thinkingConfig.effortLevel')}</label>
                      <CustomSelect
                        value={config.advanced.thinkingConfig?.effort || 'medium'}
                        onChange={(value) => handleThinkingConfigChange('effort', value)}
                        options={[
                          ...(isGpt5 ? [{ value: 'none', label: t('settings.taskConfig.thinkingConfig.effortOptions.none') }] : []),
                          ...(isGpt52Plus ? [{ value: 'minimal', label: t('settings.taskConfig.thinkingConfig.effortOptions.minimal') }] : []),
                          { value: 'low', label: isGpt5 ? t('settings.taskConfig.thinkingConfig.effortOptions.lowPercent') : t('settings.taskConfig.thinkingConfig.effortOptions.low') },
                          { value: 'medium', label: isGpt5 ? t('settings.taskConfig.thinkingConfig.effortOptions.mediumPercent') : t('settings.taskConfig.thinkingConfig.effortOptions.medium') },
                          { value: 'high', label: isGpt5 ? t('settings.taskConfig.thinkingConfig.effortOptions.highPercent') : t('settings.taskConfig.thinkingConfig.effortOptions.high') },
                          ...(isGpt52Plus ? [{ value: 'xhigh', label: t('settings.taskConfig.thinkingConfig.effortOptions.xhigh') }] : []),
                        ]}
                      />
                      <p className="field-hint">
                        {isGpt5
                          ? t('settings.taskConfig.thinkingConfig.effortHint')
                          : t('settings.taskConfig.thinkingConfig.effortHintGeneric')}
                      </p>
                    </div>

                    {/* Verbosity dropdown - GPT-5 only */}
                    {isGpt5 && (
                      <div className="form-field">
                        <label>{t('settings.taskConfig.thinkingConfig.verbosity')}</label>
                        <CustomSelect
                          value={config.advanced.thinkingConfig?.verbosity || 'medium'}
                          onChange={(value) => handleThinkingConfigChange('verbosity', value)}
                          options={[
                            { value: 'low', label: t('settings.taskConfig.thinkingConfig.verbosityOptions.low') },
                            { value: 'medium', label: t('settings.taskConfig.thinkingConfig.verbosityOptions.medium') },
                            { value: 'high', label: t('settings.taskConfig.thinkingConfig.verbosityOptions.high') },
                          ]}
                        />
                        <p className="field-hint">
                          {t('settings.taskConfig.thinkingConfig.verbosityHint')}
                        </p>
                      </div>
                    )}

                    {/* Max tokens - not for GPT-5 (uses max_output_tokens automatically) */}
                    {!isGpt5 && (
                      <div className="form-field">
                        <label>{t('settings.taskConfig.thinkingConfig.maxThinkingTokens')}</label>
                        <input
                          type="number"
                          min="1024"
                          max="32000"
                          value={config.advanced.thinkingConfig?.maxTokens || ''}
                          onChange={(e) =>
                            handleThinkingConfigChange(
                              'maxTokens',
                              e.target.value ? parseInt(e.target.value) : undefined
                            )
                          }
                          placeholder={t('settings.taskConfig.thinkingConfig.maxThinkingTokensPlaceholder')}
                          className="config-input"
                        />
                        <p className="field-hint">
                          {t('settings.taskConfig.thinkingConfig.maxThinkingTokensHint')}
                        </p>
                      </div>
                    )}
                  </>
                )}

                {/* Custom endpoint - format-specific thinking options */}
                {config.provider === 'custom' && (
                  <>
                    {/* OpenAI format options */}
                    {config.advanced.customApiFormat === 'openai' && (
                      <>
                        <div className="form-field">
                          <label>{t('settings.taskConfig.thinkingConfig.reasoningEffort')}</label>
                          <CustomSelect
                            value={config.advanced.thinkingConfig?.effort || 'medium'}
                            onChange={(value) => handleThinkingConfigChange('effort', value)}
                            options={[
                              { value: 'none', label: t('settings.taskConfig.thinkingConfig.effortOptions.none') },
                              { value: 'minimal', label: t('settings.taskConfig.thinkingConfig.effortOptions.minimal') },
                              { value: 'low', label: t('settings.taskConfig.thinkingConfig.effortOptions.lowPercent') },
                              { value: 'medium', label: t('settings.taskConfig.thinkingConfig.effortOptions.mediumPercent') },
                              { value: 'high', label: t('settings.taskConfig.thinkingConfig.effortOptions.highPercent') },
                              { value: 'xhigh', label: t('settings.taskConfig.thinkingConfig.effortOptions.xhigh') },
                            ]}
                          />
                          <p className="field-hint">{t('settings.taskConfig.thinkingConfig.effortHint')}</p>
                        </div>
                        <div className="form-field">
                          <label>{t('settings.taskConfig.thinkingConfig.verbosity')}</label>
                          <CustomSelect
                            value={config.advanced.thinkingConfig?.verbosity || 'medium'}
                            onChange={(value) => handleThinkingConfigChange('verbosity', value)}
                            options={[
                              { value: 'low', label: t('settings.taskConfig.thinkingConfig.verbosityOptions.low') },
                              { value: 'medium', label: t('settings.taskConfig.thinkingConfig.verbosityOptions.medium') },
                              { value: 'high', label: t('settings.taskConfig.thinkingConfig.verbosityOptions.high') },
                            ]}
                          />
                          <p className="field-hint">{t('settings.taskConfig.thinkingConfig.verbosityHint')}</p>
                        </div>
                      </>
                    )}

                    {/* Claude format options */}
                    {config.advanced.customApiFormat === 'claude' && (
                      <div className="form-field">
                        <label>{t('settings.taskConfig.thinkingConfig.thinkingBudget')}</label>
                        <input
                          type="number"
                          min="1024"
                          value={config.advanced.thinkingConfig?.claudeBudgetTokens || ''}
                          onChange={(e) =>
                            handleThinkingConfigChange(
                              'claudeBudgetTokens',
                              e.target.value ? parseInt(e.target.value) : undefined
                            )
                          }
                          placeholder={t('settings.taskConfig.thinkingConfig.claudeBudgetTokensPlaceholder')}
                          className="config-input"
                        />
                        <p className="field-hint">{t('settings.taskConfig.thinkingConfig.thinkingBudgetHint')}</p>
                      </div>
                    )}

                    {/* Gemini format options */}
                    {config.advanced.customApiFormat === 'gemini' && (
                      <>
                        <div className="form-field">
                          <label>{t('settings.taskConfig.thinkingConfig.reasoningEffort')}</label>
                          <CustomSelect
                            value={config.advanced.thinkingConfig?.effort || ''}
                            onChange={(value) =>
                              handleThinkingConfigChange(
                                'effort',
                                value === '' ? undefined : value
                              )
                            }
                            options={[
                              { value: '', label: t('common.auto') },
                              { value: 'none', label: t('settings.taskConfig.thinkingConfig.effortOptions.none') },
                              { value: 'low', label: t('settings.taskConfig.thinkingConfig.effortOptions.low') },
                              { value: 'medium', label: t('settings.taskConfig.thinkingConfig.effortOptions.medium') },
                              { value: 'high', label: t('settings.taskConfig.thinkingConfig.effortOptions.high') },
                            ]}
                          />
                          <p className="field-hint">{t('settings.taskConfig.thinkingConfig.geminiCompatEffortHint')}</p>
                        </div>

                        <div className="form-field">
                          <label>{t('settings.taskConfig.thinkingConfig.thinkingLevel')}</label>
                          <CustomSelect
                            value={config.advanced.thinkingConfig?.geminiThinkingLevel || ''}
                            onChange={(value) =>
                              handleThinkingConfigChange(
                                'geminiThinkingLevel',
                                value === '' ? undefined : value
                              )
                            }
                            options={[
                              { value: '', label: t('common.auto') },
                              { value: 'minimal', label: t('settings.taskConfig.thinkingConfig.effortOptions.minimal') },
                              { value: 'low', label: t('settings.taskConfig.thinkingConfig.effortOptions.low') },
                              { value: 'medium', label: t('settings.taskConfig.thinkingConfig.effortOptions.medium') },
                              { value: 'high', label: t('settings.taskConfig.thinkingConfig.effortOptions.high') },
                            ]}
                          />
                          <p className="field-hint">{t('settings.taskConfig.thinkingConfig.thinkingLevelHint')}</p>
                        </div>

                        <div className="form-field">
                          <label>{t('settings.taskConfig.thinkingConfig.thinkingBudget25')}</label>
                          <input
                            type="number"
                            min="0"
                            value={config.advanced.thinkingConfig?.geminiBudgetTokens ?? ''}
                            onChange={(e) =>
                              handleThinkingConfigChange(
                                'geminiBudgetTokens',
                                e.target.value === '' ? undefined : parseInt(e.target.value)
                              )
                            }
                            placeholder={t('settings.taskConfig.thinkingConfig.thinkingBudget25Placeholder')}
                            className="config-input"
                          />
                          <p className="field-hint">{t('settings.taskConfig.thinkingConfig.thinkingBudget25Hint')}</p>
                        </div>

                        <p className="field-hint">{t('settings.taskConfig.thinkingConfig.geminiCompatConflictHint')}</p>
                      </>
                    )}

                  </>
                )}

                {/* Claude-specific */}
                {config.provider === 'claude' && (
                  <div className="form-field">
                    <label>{t('settings.taskConfig.thinkingConfig.claudeBudgetTokens')}</label>
                    <input
                      type="number"
                      min="256"
                      value={config.advanced.thinkingConfig?.claudeBudgetTokens || ''}
                      onChange={(e) =>
                        handleThinkingConfigChange(
                          'claudeBudgetTokens',
                          e.target.value ? parseInt(e.target.value) : undefined
                        )
                      }
                      placeholder={t('common.auto')}
                      className="config-input"
                    />
                    <p className="field-hint">{t('settings.taskConfig.thinkingConfig.claudeBudgetTokensHint')}</p>
                  </div>
                )}

                {/* Gemini-specific */}
                {config.provider === 'gemini' && (
                  <>
                    {config.model.toLowerCase().includes('gemini-3') && (
                      <div className="form-field">
                        <label>{t('settings.taskConfig.thinkingConfig.thinkingLevelGemini3')}</label>
                        {/*
                          Gemini 3 supports only 'low' | 'high'. Default to 'high' if legacy value exists.
                        */}
                        {(() => {
                          const lvl = config.advanced.thinkingConfig?.geminiThinkingLevel === 'low' ? 'low' : 'high';
                          if (config.advanced.thinkingConfig?.geminiThinkingLevel !== lvl) {
                            handleThinkingConfigChange('geminiThinkingLevel', lvl);
                          }
                          return null;
                        })()}
                        <CustomSelect
                          value={
                            config.advanced.thinkingConfig?.geminiThinkingLevel === 'low'
                              ? 'low'
                              : 'high'
                          }
                          onChange={(value) =>
                            handleThinkingConfigChange(
                              'geminiThinkingLevel',
                              value as ThinkingConfig['geminiThinkingLevel']
                            )
                          }
                          options={[
                            { value: 'low', label: t('common.low') },
                            { value: 'high', label: t('common.high') },
                          ]}
                        />
                        <p className="field-hint">{t('settings.taskConfig.thinkingConfig.thinkingLevelGemini3Hint')}</p>
                      </div>
                    )}

                    {config.model.toLowerCase().includes('2.5') && (
                      <div className="form-field">
                        <label>{t('settings.taskConfig.thinkingConfig.thinkingBudget25')}</label>
                        <input
                          type="number"
                          min="0"
                          value={config.advanced.thinkingConfig?.geminiBudgetTokens ?? ''}
                          onChange={(e) =>
                            handleThinkingConfigChange(
                              'geminiBudgetTokens',
                              e.target.value === '' ? undefined : parseInt(e.target.value)
                            )
                          }
                          placeholder={t('settings.taskConfig.thinkingConfig.thinkingBudget25Placeholder')}
                          className="config-input"
                        />
                        <p className="field-hint">{t('settings.taskConfig.thinkingConfig.thinkingBudget25Hint')}</p>
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
