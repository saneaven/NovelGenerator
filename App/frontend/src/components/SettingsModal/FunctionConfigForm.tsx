import React, { useState } from 'react';
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
  serverVaultEnabled: boolean;
  onChange: (config: FunctionAIConfig) => void;
}

const FunctionConfigForm: React.FC<FunctionConfigFormProps> = ({
  functionType,
  config,
  credentials,
  serverVaultEnabled,
  onChange,
}) => {
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
        <h4 className="section-title">Basic Settings</h4>

        <div className="form-field">
          <label>Provider</label>
          <CustomSelect
            value={config.provider}
            onChange={(value) => handleProviderChange(value as ProviderType)}
            options={[
              { value: 'openai', label: 'OpenAI' },
              { value: 'gemini', label: 'Gemini' },
              { value: 'claude', label: 'Claude' },
              { value: 'openrouter', label: 'OpenRouter' },
              { value: 'xai', label: 'xAI (Grok)' },
              { value: 'custom', label: 'Custom Endpoint' },
            ]}
          />
          <p className="field-hint">
            {config.provider === 'openai' && 'Direct OpenAI API access (GPT-4o, o1, etc.)'}
            {config.provider === 'gemini' && 'Google Gemini with thought summaries'}
            {config.provider === 'claude' && 'Anthropic Claude with extended thinking'}
            {config.provider === 'openrouter' && 'Access to 100+ AI models via OpenRouter'}
            {config.provider === 'xai' && 'xAI Grok models for text generation'}
            {config.provider === 'custom' && 'Use your own OpenAI-compatible endpoint'}
          </p>
        </div>

        {/* Custom endpoint - API format selector (always visible for custom provider) */}
        {config.provider === 'custom' && (
          <div className="form-field">
            <label>API Format</label>
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
              Select the API format - uses native SDK for each provider
            </p>
          </div>
        )}

        <div className="form-field">
          <label>AI Model</label>
          <div className="model-input-row">
            <input
              type="text"
              value={config.model}
              onChange={(e) => handleModelChange(e.target.value)}
              placeholder="e.g., gpt-4o, anthropic/claude-3.5-sonnet"
              className="config-input"
            />
            <TextButton
              variant={showModelBrowser ? 'primary' : 'secondary'}
              size="sm"
              type="button"
              onClick={() => setShowModelBrowser(!showModelBrowser)}
              title="Browse available models"
            >
              {showModelBrowser ? 'Hide' : 'Browse'}
            </TextButton>
          </div>
          <p className="field-hint">
            Model identifier for this function
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
              serverVaultEnabled={serverVaultEnabled}
              onSelectModel={handleModelChange}
              onUpdateProviderPreference={(pref) =>
                onChange({ ...config, providerPreference: pref })
              }
            />
          )}
        </div>

        <div className={`form-field ${isGpt5 ? 'disabled' : ''}`}>
          <label>
            Temperature: <span className="temperature-value">{config.temperature.toFixed(1)}</span>
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
            <small>Precise (0.0)</small>
            <small>Balanced (1.0)</small>
            <small>Creative (2.0)</small>
          </div>
          <p className="field-hint">
            {isGpt5
              ? 'Temperature is not supported for GPT-5 models. Use Reasoning Effort instead.'
              : 'Lower values produce more focused and deterministic outputs. Higher values increase creativity and randomness.'}
          </p>
        </div>
      </div>

      {/* Advanced Settings */}
      <div className="config-section advanced-section">
        <span className="advanced-warning-icon"><Warning size="xl" /></span>
        <h4 className="section-title"><Advenced size="lg" />Advanced Settings</h4>

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
                <span className="checkbox-title">Enable Assistant Prefill</span>
                <span className="checkbox-description">
                  {config.provider === 'openai'
                    ? 'OpenAI does not support assistant prefill'
                    : 'Pre-fill the assistant\'s response to guide output format'}
                </span>
              </div>
            </label>
          </div>

          <div className="thinking-mode-field">
            <label className="field-label">Thinking Mode</label>
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
                  <span className="radio-title">Off</span>
                  <span className="radio-description">
                    {config.provider === 'gemini'
                      ? 'Gemini does not support disabling thinking'
                      : 'No thinking shown'}
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
                  <span className="radio-title">Model Thinking</span>
                  <span className="radio-description">
                    Use model's native thinking tokens (if the model supports it)
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
                  <span className="radio-title">Custom Thinking</span>
                  <span className="radio-description">
                    Prompt-based Chain-of-Thought with &lt;thinking&gt; tags
                  </span>
                </div>
              </label>
            </div>

            {/* Thinking Config (only shown for model mode) */}
            {config.advanced.thinkingMode === 'model' && (
              <div className="thinking-config">
                <h5 className="subsection-title"><Settings size="sm" />Thinking Configuration</h5>

                {/* Generic settings for OpenRouter/OpenAI (not custom) */}
                {(config.provider === 'openrouter' || config.provider === 'openai' || config.provider === 'xai') && (
                  <>
                    <div className="form-field">
                      <label>{isGpt5 ? 'Reasoning Effort (GPT-5)' : 'Effort Level'}</label>
                      <CustomSelect
                        value={config.advanced.thinkingConfig?.effort || 'medium'}
                        onChange={(value) => handleThinkingConfigChange('effort', value)}
                        options={[
                          ...(isGpt5 ? [{ value: 'none', label: 'None - No reasoning (fastest)' }] : []),
                          ...(isGpt52Plus ? [{ value: 'minimal', label: 'Minimal - Very light reasoning' }] : []),
                          { value: 'low', label: isGpt5 ? 'Low - Quick reasoning' : 'Low (~20% of max tokens)' },
                          { value: 'medium', label: isGpt5 ? 'Medium - Balanced' : 'Medium (~50% of max tokens)' },
                          { value: 'high', label: isGpt5 ? 'High - Deep reasoning' : 'High (~80% of max tokens)' },
                          ...(isGpt52Plus ? [{ value: 'xhigh', label: 'Extra High - Maximum reasoning' }] : []),
                        ]}
                      />
                      <p className="field-hint">
                        {isGpt5
                          ? 'Controls how much reasoning GPT-5 performs before responding'
                          : 'Controls how much thinking the model performs internally'}
                      </p>
                    </div>

                    {/* Verbosity dropdown - GPT-5 only */}
                    {isGpt5 && (
                      <div className="form-field">
                        <label>Output Verbosity (GPT-5)</label>
                        <CustomSelect
                          value={config.advanced.thinkingConfig?.verbosity || 'medium'}
                          onChange={(value) => handleThinkingConfigChange('verbosity', value)}
                          options={[
                            { value: 'low', label: 'Low - Concise output' },
                            { value: 'medium', label: 'Medium - Standard' },
                            { value: 'high', label: 'High - Detailed output' },
                          ]}
                        />
                        <p className="field-hint">
                          Controls the length and detail of the model's output
                        </p>
                      </div>
                    )}

                    {/* Max tokens - not for GPT-5 (uses max_output_tokens automatically) */}
                    {!isGpt5 && (
                      <div className="form-field">
                        <label>Max Thinking Tokens (optional)</label>
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
                          placeholder="Auto (based on effort)"
                          className="config-input"
                        />
                        <p className="field-hint">
                          Directly specify thinking token budget. Leave empty to use effort-based allocation.
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
                          <label>Reasoning Effort</label>
                          <CustomSelect
                            value={config.advanced.thinkingConfig?.effort || 'medium'}
                            onChange={(value) => handleThinkingConfigChange('effort', value)}
                            options={[
                              { value: 'none', label: 'None - No reasoning (fastest)' },
                              { value: 'minimal', label: 'Minimal - Very light reasoning' },
                              { value: 'low', label: 'Low - Quick reasoning' },
                              { value: 'medium', label: 'Medium - Balanced' },
                              { value: 'high', label: 'High - Deep reasoning' },
                              { value: 'xhigh', label: 'Extra High - Maximum reasoning' },
                            ]}
                          />
                          <p className="field-hint">Controls reasoning depth (summary is auto-enabled)</p>
                        </div>
                        <div className="form-field">
                          <label>Output Verbosity</label>
                          <CustomSelect
                            value={config.advanced.thinkingConfig?.verbosity || 'medium'}
                            onChange={(value) => handleThinkingConfigChange('verbosity', value)}
                            options={[
                              { value: 'low', label: 'Low - Concise output' },
                              { value: 'medium', label: 'Medium - Standard' },
                              { value: 'high', label: 'High - Detailed output' },
                            ]}
                          />
                          <p className="field-hint">Controls the length and detail of the output</p>
                        </div>
                      </>
                    )}

                    {/* Claude format options */}
                    {config.advanced.customApiFormat === 'claude' && (
                      <div className="form-field">
                        <label>Thinking Budget (tokens)</label>
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
                          placeholder="e.g., 10000"
                          className="config-input"
                        />
                        <p className="field-hint">Minimum 1024 tokens. Leave blank for model default.</p>
                      </div>
                    )}

                    {/* Gemini format options */}
                    {config.advanced.customApiFormat === 'gemini' && (
                      <div className="form-field">
                        <label>Thinking Level</label>
                        <CustomSelect
                          value={config.advanced.thinkingConfig?.geminiThinkingLevel || 'high'}
                          onChange={(value) => handleThinkingConfigChange('geminiThinkingLevel', value)}
                          options={[
                            { value: 'minimal', label: 'Minimal - Lowest latency' },
                            { value: 'low', label: 'Low - Quick thinking' },
                            { value: 'medium', label: 'Medium - Balanced' },
                            { value: 'high', label: 'High - Deep thinking' },
                          ]}
                        />
                        <p className="field-hint">Controls thinking depth for Gemini-compatible endpoints</p>
                      </div>
                    )}

                    {/* OpenRouter format options */}
                    {config.advanced.customApiFormat === 'openrouter' && (
                      <>
                        <div className="form-field">
                          <label>Effort Level</label>
                          <CustomSelect
                            value={config.advanced.thinkingConfig?.effort || 'medium'}
                            onChange={(value) => handleThinkingConfigChange('effort', value)}
                            options={[
                              { value: 'low', label: 'Low (~20% of max tokens)' },
                              { value: 'medium', label: 'Medium (~50% of max tokens)' },
                              { value: 'high', label: 'High (~80% of max tokens)' },
                            ]}
                          />
                          <p className="field-hint">Controls how much thinking the model performs</p>
                        </div>
                        <div className="form-field">
                          <label>Max Thinking Tokens (optional)</label>
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
                            placeholder="Auto (based on effort)"
                            className="config-input"
                          />
                          <p className="field-hint">Directly specify thinking token budget</p>
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* Claude-specific */}
                {config.provider === 'claude' && (
                  <div className="form-field">
                    <label>Claude Thinking Budget (tokens)</label>
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
                      placeholder="Auto"
                      className="config-input"
                    />
                    <p className="field-hint">Leave blank to use the model default budget.</p>
                  </div>
                )}

                {/* Gemini-specific */}
                {config.provider === 'gemini' && (
                  <>
                    {config.model.toLowerCase().includes('gemini-3') && (
                      <div className="form-field">
                        <label>Thinking Level (Gemini 3)</label>
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
                            { value: 'low', label: 'Low' },
                            { value: 'high', label: 'High' },
                          ]}
                        />
                        <p className="field-hint">Controls depth of reasoning for Gemini 3 models.</p>
                      </div>
                    )}

                    {config.model.toLowerCase().includes('2.5') && (
                      <div className="form-field">
                        <label>Thinking Budget (tokens) for 2.5</label>
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
                          placeholder="Set 0 to disable"
                          className="config-input"
                        />
                        <p className="field-hint">Set 0 to effectively disable thinking where supported.</p>
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
