import React from 'react';
import type { ProviderCredentials } from '../../store/settingsStore';
import { Settings, Shuffle } from '../icons';
import './CredentialsPanel.css';

interface CredentialsPanelProps {
  credentials: ProviderCredentials;
  onChange: (credentials: ProviderCredentials) => void;
}

const CredentialsPanel: React.FC<CredentialsPanelProps> = ({
  credentials,
  onChange,
}) => {
  return (
    <div className="credentials-panel">
      <div className="panel-description">
        <p>Configure API keys and endpoints. These credentials are shared across all AI functions.</p>
      </div>

      {/* OpenAI */}
      <div className="credential-card">
        <div className="credential-header">
          <div className="credential-icon">◯</div>
          <h3>OpenAI</h3>
        </div>
        <div className="credential-body">
          <div className="form-field">
            <label>API Key</label>
            <input
              type="password"
              value={credentials.openai?.apiKey || ''}
              onChange={(e) =>
                onChange({
                  ...credentials,
                  openai: { apiKey: e.target.value },
                })
              }
              placeholder="sk-..."
              className="credential-input"
            />
            <p className="field-hint">
              Get your API key from{' '}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">
                platform.openai.com/api-keys
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* Gemini */}
      <div className="credential-card">
        <div className="credential-header">
          <div className="credential-icon">✦</div>
          <h3>Gemini</h3>
        </div>
        <div className="credential-body">
          <div className="form-field">
            <label>API Key</label>
            <input
              type="password"
              value={credentials.gemini.apiKey}
              onChange={(e) =>
                onChange({
                  ...credentials,
                  gemini: { apiKey: e.target.value },
                })
              }
              placeholder="AIz..."
              className="credential-input"
            />
            <p className="field-hint">
              Get your API key from{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
                aistudio.google.com/apikey
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* Claude */}
      <div className="credential-card">
        <div className="credential-header">
          <div className="credential-icon">◎</div>
          <h3>Claude (Anthropic)</h3>
        </div>
        <div className="credential-body">
          <div className="form-field">
            <label>API Key</label>
            <input
              type="password"
              value={credentials.claude.apiKey}
              onChange={(e) =>
                onChange({
                  ...credentials,
                  claude: { apiKey: e.target.value },
                })
              }
              placeholder="sk-ant-..."
              className="credential-input"
            />
            <p className="field-hint">
              Get your API key from{' '}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
                console.anthropic.com
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* OpenRouter */}
      <div className="credential-card">
        <div className="credential-header">
          <div className="credential-icon"><Shuffle size="md" /></div>
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

      {/* xAI (Grok) */}
      <div className="credential-card">
        <div className="credential-header">
          <div className="credential-icon">𝕏</div>
          <h3>xAI (Grok)</h3>
        </div>
        <div className="credential-body">
          <div className="form-field">
            <label>API Key</label>
            <input
              type="password"
              value={credentials.xai?.apiKey || ''}
              onChange={(e) =>
                onChange({
                  ...credentials,
                  xai: { apiKey: e.target.value },
                })
              }
              placeholder="xai-..."
              className="credential-input"
            />
            <p className="field-hint">
              Get your API key from{' '}
              <a href="https://console.x.ai/" target="_blank" rel="noopener noreferrer">
                console.x.ai
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* NovelAI */}
      <div className="credential-card">
        <div className="credential-header">
          <div className="credential-icon">N</div>
          <h3>NovelAI</h3>
        </div>
        <div className="credential-body">
          <div className="form-field">
            <label>Access Token</label>
            <input
              type="password"
              value={credentials.novelai?.apiKey || ''}
              onChange={(e) =>
                onChange({
                  ...credentials,
                  novelai: { apiKey: e.target.value },
                })
              }
              placeholder="eyJ..."
              className="credential-input"
            />
            <p className="field-hint">
              Your NovelAI JWT access token. Get it from your browser's developer tools
              while logged in to NovelAI (look for 'auth_token' in local storage).
            </p>
          </div>
        </div>
      </div>

      {/* Custom Endpoint */}
      <div className="credential-card">
        <div className="credential-header">
          <div className="credential-icon"><Settings size="md" /></div>
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

    </div>
  );
};

export default CredentialsPanel;
