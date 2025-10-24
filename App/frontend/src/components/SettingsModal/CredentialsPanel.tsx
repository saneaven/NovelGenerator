import React from 'react';
import type { ProviderCredentials } from '../../store/settingsStore';

interface CredentialsPanelProps {
  credentials: ProviderCredentials;
  onChange: (credentials: ProviderCredentials) => void;
}

const CredentialsPanel: React.FC<CredentialsPanelProps> = ({ credentials, onChange }) => {
  return (
    <div className="credentials-panel">
      <div className="panel-description">
        <p>Configure API keys and endpoints. These credentials are shared across all AI functions.</p>
      </div>

      {/* OpenRouter */}
      <div className="credential-card">
        <div className="credential-header">
          <div className="credential-icon">🔗</div>
          <h3>OpenRouter</h3>
        </div>
        <div className="credential-body">
          <div className="form-field">
            <label>API Key</label>
            <input
              type="password"
              value={credentials.openrouter.apiKey}
              onChange={(e) =>
                onChange({
                  ...credentials,
                  openrouter: { apiKey: e.target.value },
                })
              }
              placeholder="sk-or-v1-..."
              className="credential-input"
            />
            <p className="field-hint">
              Get your API key from{' '}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
                openrouter.ai/keys
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* Custom Endpoint */}
      <div className="credential-card">
        <div className="credential-header">
          <div className="credential-icon">⚙️</div>
          <h3>Custom Endpoint</h3>
        </div>
        <div className="credential-body">
          <div className="form-field">
            <label>Base URL</label>
            <input
              type="url"
              value={credentials.custom.baseUrl}
              onChange={(e) =>
                onChange({
                  ...credentials,
                  custom: {
                    ...credentials.custom,
                    baseUrl: e.target.value,
                  },
                })
              }
              placeholder="https://api.openai.com/v1"
              className="credential-input"
            />
            <p className="field-hint">OpenAI-compatible API endpoint</p>
          </div>
          <div className="form-field">
            <label>API Key (Optional)</label>
            <input
              type="password"
              value={credentials.custom.apiKey || ''}
              onChange={(e) =>
                onChange({
                  ...credentials,
                  custom: {
                    ...credentials.custom,
                    apiKey: e.target.value,
                  },
                })
              }
              placeholder="sk-..."
              className="credential-input"
            />
            <p className="field-hint">Required if your endpoint requires authentication</p>
          </div>
        </div>
      </div>

      {/* GitHub Copilot */}
      <div className="credential-card">
        <div className="credential-header">
          <div className="credential-icon">🤖</div>
          <h3>GitHub Copilot</h3>
        </div>
        <div className="credential-body">
          <div className="credential-info-box">
            <p>✓ Authenticated via server configuration</p>
            <p className="credential-info-detail">
              GitHub Copilot is configured server-side. No additional setup required.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CredentialsPanel;
