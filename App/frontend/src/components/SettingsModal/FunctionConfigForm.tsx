import React from 'react';
import type {
  FunctionAIConfig,
  ProviderType,
  AIFunctionType,
  ProviderCredentials,
} from '../../store/settingsStore';
import ModelBrowser from './ModelBrowser';

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
  const handleProviderChange = (provider: ProviderType) => {
    onChange({
      ...config,
      provider,
      providerPreference: provider === 'openrouter' ? config.providerPreference : undefined,
    });
  };

  const handleModelChange = (model: string) => {
    onChange({ ...config, model });
  };

  const handleTemperatureChange = (temperature: number) => {
    onChange({ ...config, temperature });
  };

  const handleAdvancedChange = (key: 'enablePrefill' | 'enableThinking', value: boolean) => {
    onChange({
      ...config,
      advanced: {
        ...config.advanced,
        [key]: value,
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
          <select
            value={config.provider}
            onChange={(e) => handleProviderChange(e.target.value as ProviderType)}
            className="config-select"
          >
            <option value="copilot">GitHub Copilot</option>
            <option value="openrouter">OpenRouter</option>
            <option value="custom">Custom Endpoint</option>
          </select>
          <p className="field-hint">
            {config.provider === 'copilot' && 'Server-authenticated GitHub Copilot access'}
            {config.provider === 'openrouter' && 'Access to 100+ AI models via OpenRouter'}
            {config.provider === 'custom' && 'Use your own OpenAI-compatible endpoint'}
          </p>
        </div>

        <div className="form-field">
          <label>AI Model</label>
          <input
            type="text"
            value={config.model}
            onChange={(e) => handleModelChange(e.target.value)}
            placeholder="e.g., gpt-4o, anthropic/claude-3.5-sonnet"
            className="config-input"
          />
          <p className="field-hint">
            Model identifier for this function
          </p>
        </div>

        <div className="form-field">
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
          />
          <div className="temperature-labels">
            <small>Precise (0.0)</small>
            <small>Balanced (1.0)</small>
            <small>Creative (2.0)</small>
          </div>
          <p className="field-hint">
            Lower values produce more focused and deterministic outputs. Higher values increase creativity and randomness.
          </p>
        </div>
      </div>

      {/* Advanced Settings */}
      <div className="config-section advanced-section">
        <h4 className="section-title">Advanced Settings</h4>

        <div className="advanced-options">
          <div className="checkbox-field">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.advanced.enablePrefill}
                onChange={(e) => handleAdvancedChange('enablePrefill', e.target.checked)}
              />
              <div className="checkbox-content">
                <span className="checkbox-title">Enable Assistant Prefill</span>
                <span className="checkbox-description">
                  Pre-fill the assistant's response to guide output format (Anthropic models only)
                </span>
              </div>
            </label>
          </div>

          <div className="checkbox-field">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.advanced.enableThinking}
                onChange={(e) => handleAdvancedChange('enableThinking', e.target.checked)}
              />
              <div className="checkbox-content">
                <span className="checkbox-title">Enable Extended Thinking</span>
                <span className="checkbox-description">
                  Allow the model to show internal reasoning process before responding
                </span>
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* Model Browser */}
      <div className="config-section">
        <ModelBrowser
          functionType={functionType}
          provider={config.provider}
          currentModel={config.model}
          providerPreference={config.providerPreference}
          credentials={credentials}
          onSelectModel={handleModelChange}
          onUpdateProviderPreference={(pref) =>
            onChange({ ...config, providerPreference: pref })
          }
        />
      </div>
    </div>
  );
};

export default FunctionConfigForm;
