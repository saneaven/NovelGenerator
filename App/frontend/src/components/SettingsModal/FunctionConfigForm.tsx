import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  FunctionAIConfig,
  ProviderType,
  AIFunctionType,
  ProviderCredentials,
  ThinkingConfig,
  CustomApiFormat,
} from '../../store/settingsStore';
import ModelBrowser from './ModelBrowser';
import { TextButton } from '../TextButton';
import { CustomSelect } from '../ui/CustomSelect';
import { Warning, Settings, Advenced } from '../icons';

interface FunctionConfigFormProps {
  functionType: AIFunctionType;
  config: FunctionAIConfig;
  credentials: ProviderCredentials;
  onChange: (config: FunctionAIConfig) => void;
}

const FunctionConfigForm: React.FC<FunctionConfigFormProps> = ({
  functionType,
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
    <div className="function-config-form">
      {/* Basic Settings */}
      <div className="config-section">
        <h4 className="section-title">{t('settings.functionConfig.basicSettings')}</h4>

        <div className="form-field">
          <label>{t('settings.functionConfig.provider')}</label>
          <CustomSelect
            value={config.provider}
            onChange={(value) => handleProviderChange(value as ProviderType)}
            options={[
              { value: 'openai', label: 'OpenAI' },
              { value: 'gemini', label: 'Gemini' },
              { value: 'claude', label: 'Claude' },
              { value: 'openrouter', label: 'OpenRouter' },
              { value: 'xai', label: 'xAI (Grok)' },
              { value: 'custom', label: t('settings.functionConfig.customEndpoint') },
            ]}
          />
          <p className="field-hint">
            {config.provider === 'openai' && t('settings.functionConfig.providerHints.openai')}
            {config.provider === 'gemini' && t('settings.functionConfig.providerHints.gemini')}
            {config.provider === 'claude' && t('settings.functionConfig.providerHints.claude')}
            {config.provider === 'openrouter' && t('settings.functionConfig.providerHints.openrouter')}
            {config.provider === 'xai' && t('settings.functionConfig.providerHints.xai')}
            {config.provider === 'custom' && t('settings.functionConfig.providerHints.custom')}
          </p>
        </div>

        {/* Custom endpoint - API format selector (always visible for custom provider) */}
        {config.provider === 'custom' && (
          <div className="form-field">
            <label>{t('settings.functionConfig.apiFormat')}</label>
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
              {t('settings.functionConfig.apiFormatHint')}
            </p>
          </div>
        )}

        <div className="form-field">
          <label>{t('settings.functionConfig.aiModel')}</label>
          <div className="model-input-row">
            <input
              type="text"
              value={config.model}
              onChange={(e) => handleModelChange(e.target.value)}
              placeholder={t('settings.functionConfig.modelPlaceholder')}
              className="config-input"
            />
            <TextButton
              variant={showModelBrowser ? 'primary' : 'secondary'}
              size="sm"
              type="button"
              onClick={() => setShowModelBrowser(!showModelBrowser)}
              title={t('settings.functionConfig.browseModels')}
            >
              {showModelBrowser ? t('common.hide') : t('common.browse')}
            </TextButton>
          </div>
          <p className="field-hint">
            {t('settings.functionConfig.modelHint')}
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
            {t('settings.functionConfig.temperature')}: <span className="temperature-value">{config.temperature.toFixed(1)}</span>
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
            <small>{t('settings.functionConfig.temperaturePrecise')}</small>
            <small>{t('settings.functionConfig.temperatureBalanced')}</small>
            <small>{t('settings.functionConfig.temperatureCreative')}</small>
          </div>
          <p className="field-hint">
            {isGpt5
              ? t('settings.functionConfig.temperatureGpt5Hint')
              : t('settings.functionConfig.temperatureHint')}
          </p>
        </div>
      </div>

      {/* Advanced Settings */}
      <div className="config-section advanced-section">
        <span className="advanced-warning-icon"><Warning size="xl" /></span>
        <h4 className="section-title"><Advenced size="lg" />{t('settings.functionConfig.advancedSettings')}</h4>

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
                <span className="checkbox-title">{t('settings.functionConfig.enablePrefill')}</span>
                <span className="checkbox-description">
                  {config.provider === 'openai'
                    ? t('settings.functionConfig.prefillNotSupported')
                    : t('settings.functionConfig.prefillDescription')}
                </span>
              </div>
            </label>
          </div>

          <div className="thinking-mode-field">
            <label className="field-label">{t('settings.functionConfig.thinkingMode')}</label>
            <div className="radio-group">
              <label className={`radio-option ${config.provider === 'gemini' ? 'disabled' : ''}`}>
                <input
                  type="radio"
                  name={`thinking-mode-${functionType}`}
                  value="off"
                  checked={config.advanced.thinkingMode === 'off'}
                  onChange={() => handleThinkingModeChange('off')}
                  disabled={config.provider === 'gemini'}
                />
                <div className="radio-content">
                  <span className="radio-title">{t('settings.functionConfig.thinkingOff')}</span>
                  <span className="radio-description">
                    {config.provider === 'gemini'
                      ? t('settings.functionConfig.geminiThinkingNotSupported')
                      : t('settings.functionConfig.thinkingOffDescription')}
                  </span>
                </div>
              </label>

              <label className="radio-option">
                <input
                  type="radio"
                  name={`thinking-mode-${functionType}`}
                  value="model"
                  checked={config.advanced.thinkingMode === 'model'}
                  onChange={() => handleThinkingModeChange('model')}
                />
                <div className="radio-content">
                  <span className="radio-title">{t('settings.functionConfig.modelThinking')}</span>
                  <span className="radio-description">
                    {t('settings.functionConfig.modelThinkingDescription')}
                  </span>
                </div>
              </label>

              <label className="radio-option">
                <input
                  type="radio"
                  name={`thinking-mode-${functionType}`}
                  value="custom"
                  checked={config.advanced.thinkingMode === 'custom'}
                  onChange={() => handleThinkingModeChange('custom')}
                />
                <div className="radio-content">
                  <span className="radio-title">{t('settings.functionConfig.customThinking')}</span>
                  <span className="radio-description">
                    {t('settings.functionConfig.customThinkingDescription')}
                  </span>
                </div>
              </label>
            </div>

            {/* Thinking Config (only shown for model mode) */}
            {config.advanced.thinkingMode === 'model' && (
              <div className="thinking-config">
                <h5 className="subsection-title"><Settings size="sm" />{t('settings.functionConfig.thinkingConfiguration')}</h5>

                {/* Generic settings for OpenRouter/OpenAI (not custom) */}
                {(config.provider === 'openrouter' || config.provider === 'openai' || config.provider === 'xai') && (
                  <>
                    <div className="form-field">
                      <label>{isGpt5 ? t('settings.functionConfig.reasoningEffortGpt5') : t('settings.functionConfig.effortLevel')}</label>
                      <CustomSelect
                        value={config.advanced.thinkingConfig?.effort || 'medium'}
                        onChange={(value) => handleThinkingConfigChange('effort', value)}
                        options={[
                          ...(isGpt5 ? [{ value: 'none', label: t('settings.functionConfig.effortNone') }] : []),
                          ...(isGpt52Plus ? [{ value: 'minimal', label: t('settings.functionConfig.effortMinimal') }] : []),
                          { value: 'low', label: isGpt5 ? t('settings.functionConfig.effortLowGpt5') : t('settings.functionConfig.effortLow') },
                          { value: 'medium', label: isGpt5 ? t('settings.functionConfig.effortMediumGpt5') : t('settings.functionConfig.effortMedium') },
                          { value: 'high', label: isGpt5 ? t('settings.functionConfig.effortHighGpt5') : t('settings.functionConfig.effortHigh') },
                          ...(isGpt52Plus ? [{ value: 'xhigh', label: t('settings.functionConfig.effortXHigh') }] : []),
                        ]}
                      />
                      <p className="field-hint">
                        {isGpt5
                          ? t('settings.functionConfig.effortHintGpt5')
                          : t('settings.functionConfig.effortHint')}
                      </p>
                    </div>

                    {/* Verbosity dropdown - GPT-5 only */}
                    {isGpt5 && (
                      <div className="form-field">
                        <label>{t('settings.functionConfig.verbosityGpt5')}</label>
                        <CustomSelect
                          value={config.advanced.thinkingConfig?.verbosity || 'medium'}
                          onChange={(value) => handleThinkingConfigChange('verbosity', value)}
                          options={[
                            { value: 'low', label: t('settings.functionConfig.verbosityLow') },
                            { value: 'medium', label: t('settings.functionConfig.verbosityMedium') },
                            { value: 'high', label: t('settings.functionConfig.verbosityHigh') },
                          ]}
                        />
                        <p className="field-hint">
                          {t('settings.functionConfig.verbosityHint')}
                        </p>
                      </div>
                    )}

                    {/* Max tokens - not for GPT-5 (uses max_output_tokens automatically) */}
                    {!isGpt5 && (
                      <div className="form-field">
                        <label>{t('settings.functionConfig.maxThinkingTokens')}</label>
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
                          placeholder={t('settings.functionConfig.autoBasedOnEffort')}
                          className="config-input"
                        />
                        <p className="field-hint">
                          {t('settings.functionConfig.maxThinkingTokensHint')}
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
                          <label>{t('settings.functionConfig.reasoningEffort')}</label>
                          <CustomSelect
                            value={config.advanced.thinkingConfig?.effort || 'medium'}
                            onChange={(value) => handleThinkingConfigChange('effort', value)}
                            options={[
                              { value: 'none', label: t('settings.functionConfig.effortNone') },
                              { value: 'minimal', label: t('settings.functionConfig.effortMinimal') },
                              { value: 'low', label: t('settings.functionConfig.effortLowGpt5') },
                              { value: 'medium', label: t('settings.functionConfig.effortMediumGpt5') },
                              { value: 'high', label: t('settings.functionConfig.effortHighGpt5') },
                              { value: 'xhigh', label: t('settings.functionConfig.effortXHigh') },
                            ]}
                          />
                          <p className="field-hint">{t('settings.functionConfig.reasoningEffortHint')}</p>
                        </div>
                        <div className="form-field">
                          <label>{t('settings.functionConfig.outputVerbosity')}</label>
                          <CustomSelect
                            value={config.advanced.thinkingConfig?.verbosity || 'medium'}
                            onChange={(value) => handleThinkingConfigChange('verbosity', value)}
                            options={[
                              { value: 'low', label: t('settings.functionConfig.verbosityLow') },
                              { value: 'medium', label: t('settings.functionConfig.verbosityMedium') },
                              { value: 'high', label: t('settings.functionConfig.verbosityHigh') },
                            ]}
                          />
                          <p className="field-hint">{t('settings.functionConfig.verbosityHint')}</p>
                        </div>
                      </>
                    )}

                    {/* Claude format options */}
                    {config.advanced.customApiFormat === 'claude' && (
                      <div className="form-field">
                        <label>{t('settings.functionConfig.thinkingBudget')}</label>
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
                          placeholder={t('settings.functionConfig.thinkingBudgetPlaceholder')}
                          className="config-input"
                        />
                        <p className="field-hint">{t('settings.functionConfig.thinkingBudgetHint')}</p>
                      </div>
                    )}

                    {/* Gemini format options */}
                    {config.advanced.customApiFormat === 'gemini' && (
                      <div className="form-field">
                        <label>{t('settings.functionConfig.thinkingLevel')}</label>
                        <CustomSelect
                          value={config.advanced.thinkingConfig?.geminiThinkingLevel || 'high'}
                          onChange={(value) => handleThinkingConfigChange('geminiThinkingLevel', value)}
                          options={[
                            { value: 'minimal', label: t('settings.functionConfig.thinkingLevelMinimal') },
                            { value: 'low', label: t('settings.functionConfig.thinkingLevelLow') },
                            { value: 'medium', label: t('settings.functionConfig.thinkingLevelMedium') },
                            { value: 'high', label: t('settings.functionConfig.thinkingLevelHigh') },
                          ]}
                        />
                        <p className="field-hint">{t('settings.functionConfig.thinkingLevelHint')}</p>
                      </div>
                    )}

                    {/* OpenRouter format options */}
                    {config.advanced.customApiFormat === 'openrouter' && (
                      <>
                        <div className="form-field">
                          <label>{t('settings.functionConfig.effortLevel')}</label>
                          <CustomSelect
                            value={config.advanced.thinkingConfig?.effort || 'medium'}
                            onChange={(value) => handleThinkingConfigChange('effort', value)}
                            options={[
                              { value: 'low', label: t('settings.functionConfig.effortLow') },
                              { value: 'medium', label: t('settings.functionConfig.effortMedium') },
                              { value: 'high', label: t('settings.functionConfig.effortHigh') },
                            ]}
                          />
                          <p className="field-hint">{t('settings.functionConfig.effortHint')}</p>
                        </div>
                        <div className="form-field">
                          <label>{t('settings.functionConfig.maxThinkingTokens')}</label>
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
                            placeholder={t('settings.functionConfig.autoBasedOnEffort')}
                            className="config-input"
                          />
                          <p className="field-hint">{t('settings.functionConfig.maxThinkingTokensHintShort')}</p>
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* Claude-specific */}
                {config.provider === 'claude' && (
                  <div className="form-field">
                    <label>{t('settings.functionConfig.claudeThinkingBudget')}</label>
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
                    <p className="field-hint">{t('settings.functionConfig.claudeThinkingBudgetHint')}</p>
                  </div>
                )}

                {/* Gemini-specific */}
                {config.provider === 'gemini' && (
                  <>
                    {config.model.toLowerCase().includes('gemini-3') && (
                      <div className="form-field">
                        <label>{t('settings.functionConfig.gemini3ThinkingLevel')}</label>
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
                        <p className="field-hint">{t('settings.functionConfig.gemini3ThinkingLevelHint')}</p>
                      </div>
                    )}

                    {config.model.toLowerCase().includes('2.5') && (
                      <div className="form-field">
                        <label>{t('settings.functionConfig.gemini25ThinkingBudget')}</label>
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
                          placeholder={t('settings.functionConfig.gemini25ThinkingBudgetPlaceholder')}
                          className="config-input"
                        />
                        <p className="field-hint">{t('settings.functionConfig.gemini25ThinkingBudgetHint')}</p>
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

export default FunctionConfigForm;
