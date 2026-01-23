import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  TaskAIConfig,
  ProviderType,
  AITaskType,
  ProviderCredentials,
  ThinkingConfig,
  CustomApiFormat,
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
              { value: 'custom', label: t('settings.taskConfig.customEndpoint') },
            ]}
          />
          <p className="field-hint">
            {config.provider === 'openai' && t('settings.taskConfig.providerHints.openai')}
            {config.provider === 'gemini' && t('settings.taskConfig.providerHints.gemini')}
            {config.provider === 'claude' && t('settings.taskConfig.providerHints.claude')}
            {config.provider === 'openrouter' && t('settings.taskConfig.providerHints.openrouter')}
            {config.provider === 'xai' && t('settings.taskConfig.providerHints.xai')}
            {config.provider === 'custom' && t('settings.taskConfig.providerHints.custom')}
          </p>
        </div>

        {/* Custom endpoint - API format selector (always visible for custom provider) */}
        {config.provider === 'custom' && (
          <div className="form-field">
            <label>{t('settings.taskConfig.apiFormat')}</label>
            <CustomSelect
              value={config.advanced.customApiFormat || 'openai'}
              onChange={(value) => handleCustomApiFormatChange(value as CustomApiFormat)}
              options={[
                { value: 'openai', label: 'OpenAI' },
                { value: 'claude', label: 'Claude' },
                { value: 'gemini', label: 'Gemini' },
                { value: 'openrouter', label: 'OpenRouter' },
              ]}
            />
            <p className="field-hint">
              {t('settings.taskConfig.apiFormatHint')}
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
              title={t('settings.taskConfig.browseModels')}
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
            <small>{t('settings.taskConfig.temperaturePrecise')}</small>
            <small>{t('settings.taskConfig.temperatureBalanced')}</small>
            <small>{t('settings.taskConfig.temperatureCreative')}</small>
          </div>
          <p className="field-hint">
            {isGpt5
              ? t('settings.taskConfig.temperatureGpt5Hint')
              : t('settings.taskConfig.temperatureHint')}
          </p>
        </div>
      </div>

      {/* Advanced Settings */}
      <div className="config-section advanced-section">
        <span className="advanced-warning-icon"><Warning size="xl" /></span>
        <h4 className="section-title"><Advenced size="lg" />{t('settings.taskConfig.advancedSettings')}</h4>

        <div className="advanced-options">
          <div className={`checkbox-field ${config.provider === 'openai' ? 'disabled' : ''}`}>
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
                    ? t('settings.taskConfig.prefillNotSupported')
                    : t('settings.taskConfig.prefillDescription')}
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
                  <span className="radio-title">{t('settings.taskConfig.thinkingOff')}</span>
                  <span className="radio-description">
                    {config.provider === 'gemini'
                      ? t('settings.taskConfig.geminiThinkingNotSupported')
                      : t('settings.taskConfig.thinkingOffDescription')}
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
                  <span className="radio-title">{t('settings.taskConfig.modelThinking')}</span>
                  <span className="radio-description">
                    {t('settings.taskConfig.modelThinkingDescription')}
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
                  <span className="radio-title">{t('settings.taskConfig.customThinking')}</span>
                  <span className="radio-description">
                    {t('settings.taskConfig.customThinkingDescription')}
                  </span>
                </div>
              </label>
            </div>

            {/* Thinking Config (only shown for model mode) */}
            {config.advanced.thinkingMode === 'model' && (
              <div className="thinking-config">
                <h5 className="subsection-title"><Settings size="sm" />{t('settings.taskConfig.thinkingConfiguration')}</h5>

                {/* Generic settings for OpenRouter/OpenAI (not custom) */}
                {(config.provider === 'openrouter' || config.provider === 'openai' || config.provider === 'xai') && (
                  <>
                    <div className="form-field">
                      <label>{isGpt5 ? t('settings.taskConfig.reasoningEffortGpt5') : t('settings.taskConfig.effortLevel')}</label>
                      <CustomSelect
                        value={config.advanced.thinkingConfig?.effort || 'medium'}
                        onChange={(value) => handleThinkingConfigChange('effort', value)}
                        options={[
                          ...(isGpt5 ? [{ value: 'none', label: t('settings.taskConfig.effortNone') }] : []),
                          ...(isGpt52Plus ? [{ value: 'minimal', label: t('settings.taskConfig.effortMinimal') }] : []),
                          { value: 'low', label: isGpt5 ? t('settings.taskConfig.effortLowGpt5') : t('settings.taskConfig.effortLow') },
                          { value: 'medium', label: isGpt5 ? t('settings.taskConfig.effortMediumGpt5') : t('settings.taskConfig.effortMedium') },
                          { value: 'high', label: isGpt5 ? t('settings.taskConfig.effortHighGpt5') : t('settings.taskConfig.effortHigh') },
                          ...(isGpt52Plus ? [{ value: 'xhigh', label: t('settings.taskConfig.effortXHigh') }] : []),
                        ]}
                      />
                      <p className="field-hint">
                        {isGpt5
                          ? t('settings.taskConfig.effortHintGpt5')
                          : t('settings.taskConfig.effortHint')}
                      </p>
                    </div>

                    {/* Verbosity dropdown - GPT-5 only */}
                    {isGpt5 && (
                      <div className="form-field">
                        <label>{t('settings.taskConfig.verbosityGpt5')}</label>
                        <CustomSelect
                          value={config.advanced.thinkingConfig?.verbosity || 'medium'}
                          onChange={(value) => handleThinkingConfigChange('verbosity', value)}
                          options={[
                            { value: 'low', label: t('settings.taskConfig.verbosityLow') },
                            { value: 'medium', label: t('settings.taskConfig.verbosityMedium') },
                            { value: 'high', label: t('settings.taskConfig.verbosityHigh') },
                          ]}
                        />
                        <p className="field-hint">
                          {t('settings.taskConfig.verbosityHint')}
                        </p>
                      </div>
                    )}

                    {/* Max tokens - not for GPT-5 (uses max_output_tokens automatically) */}
                    {!isGpt5 && (
                      <div className="form-field">
                        <label>{t('settings.taskConfig.maxThinkingTokens')}</label>
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
                          placeholder={t('settings.taskConfig.autoBasedOnEffort')}
                          className="config-input"
                        />
                        <p className="field-hint">
                          {t('settings.taskConfig.maxThinkingTokensHint')}
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
                          <label>{t('settings.taskConfig.reasoningEffort')}</label>
                          <CustomSelect
                            value={config.advanced.thinkingConfig?.effort || 'medium'}
                            onChange={(value) => handleThinkingConfigChange('effort', value)}
                            options={[
                              { value: 'none', label: t('settings.taskConfig.effortNone') },
                              { value: 'minimal', label: t('settings.taskConfig.effortMinimal') },
                              { value: 'low', label: t('settings.taskConfig.effortLowGpt5') },
                              { value: 'medium', label: t('settings.taskConfig.effortMediumGpt5') },
                              { value: 'high', label: t('settings.taskConfig.effortHighGpt5') },
                              { value: 'xhigh', label: t('settings.taskConfig.effortXHigh') },
                            ]}
                          />
                          <p className="field-hint">{t('settings.taskConfig.reasoningEffortHint')}</p>
                        </div>
                        <div className="form-field">
                          <label>{t('settings.taskConfig.outputVerbosity')}</label>
                          <CustomSelect
                            value={config.advanced.thinkingConfig?.verbosity || 'medium'}
                            onChange={(value) => handleThinkingConfigChange('verbosity', value)}
                            options={[
                              { value: 'low', label: t('settings.taskConfig.verbosityLow') },
                              { value: 'medium', label: t('settings.taskConfig.verbosityMedium') },
                              { value: 'high', label: t('settings.taskConfig.verbosityHigh') },
                            ]}
                          />
                          <p className="field-hint">{t('settings.taskConfig.verbosityHint')}</p>
                        </div>
                      </>
                    )}

                    {/* Claude format options */}
                    {config.advanced.customApiFormat === 'claude' && (
                      <div className="form-field">
                        <label>{t('settings.taskConfig.thinkingBudget')}</label>
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
                          placeholder={t('settings.taskConfig.thinkingBudgetPlaceholder')}
                          className="config-input"
                        />
                        <p className="field-hint">{t('settings.taskConfig.thinkingBudgetHint')}</p>
                      </div>
                    )}

                    {/* Gemini format options */}
                    {config.advanced.customApiFormat === 'gemini' && (
                      <div className="form-field">
                        <label>{t('settings.taskConfig.thinkingLevel')}</label>
                        <CustomSelect
                          value={config.advanced.thinkingConfig?.geminiThinkingLevel || 'high'}
                          onChange={(value) => handleThinkingConfigChange('geminiThinkingLevel', value)}
                          options={[
                            { value: 'minimal', label: t('settings.taskConfig.thinkingLevelMinimal') },
                            { value: 'low', label: t('settings.taskConfig.thinkingLevelLow') },
                            { value: 'medium', label: t('settings.taskConfig.thinkingLevelMedium') },
                            { value: 'high', label: t('settings.taskConfig.thinkingLevelHigh') },
                          ]}
                        />
                        <p className="field-hint">{t('settings.taskConfig.thinkingLevelHint')}</p>
                      </div>
                    )}

                    {/* OpenRouter format options */}
                    {config.advanced.customApiFormat === 'openrouter' && (
                      <>
                        <div className="form-field">
                          <label>{t('settings.taskConfig.effortLevel')}</label>
                          <CustomSelect
                            value={config.advanced.thinkingConfig?.effort || 'medium'}
                            onChange={(value) => handleThinkingConfigChange('effort', value)}
                            options={[
                              { value: 'low', label: t('settings.taskConfig.effortLow') },
                              { value: 'medium', label: t('settings.taskConfig.effortMedium') },
                              { value: 'high', label: t('settings.taskConfig.effortHigh') },
                            ]}
                          />
                          <p className="field-hint">{t('settings.taskConfig.effortHint')}</p>
                        </div>
                        <div className="form-field">
                          <label>{t('settings.taskConfig.maxThinkingTokens')}</label>
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
                            placeholder={t('settings.taskConfig.autoBasedOnEffort')}
                            className="config-input"
                          />
                          <p className="field-hint">{t('settings.taskConfig.maxThinkingTokensHintShort')}</p>
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* Claude-specific */}
                {config.provider === 'claude' && (
                  <div className="form-field">
                    <label>{t('settings.taskConfig.claudeThinkingBudget')}</label>
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
                    <p className="field-hint">{t('settings.taskConfig.claudeThinkingBudgetHint')}</p>
                  </div>
                )}

                {/* Gemini-specific */}
                {config.provider === 'gemini' && (
                  <>
                    {config.model.toLowerCase().includes('gemini-3') && (
                      <div className="form-field">
                        <label>{t('settings.taskConfig.gemini3ThinkingLevel')}</label>
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
                        <p className="field-hint">{t('settings.taskConfig.gemini3ThinkingLevelHint')}</p>
                      </div>
                    )}

                    {config.model.toLowerCase().includes('2.5') && (
                      <div className="form-field">
                        <label>{t('settings.taskConfig.gemini25ThinkingBudget')}</label>
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
                          placeholder={t('settings.taskConfig.gemini25ThinkingBudgetPlaceholder')}
                          className="config-input"
                        />
                        <p className="field-hint">{t('settings.taskConfig.gemini25ThinkingBudgetHint')}</p>
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
