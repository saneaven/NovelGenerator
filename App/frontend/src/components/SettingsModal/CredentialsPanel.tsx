import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderCredentials } from '../../store/settingsStore';
import { OpenAI, Gemini, Claude, OpenRouter, XAI, NovelAI, CustomProvider } from '../icons';
import './CredentialsPanel.css';

interface CredentialsPanelProps {
  credentials: ProviderCredentials;
  storedProviders?: string[];
  isSyncing?: boolean;
  onChange: (credentials: ProviderCredentials) => void;
}

const CredentialsPanel: React.FC<CredentialsPanelProps> = ({
  credentials,
  storedProviders = [],
  isSyncing = false,
  onChange,
}) => {
  const { t } = useTranslation();
  const storedSet = new Set(storedProviders);

  return (
    <div className="credentials-panel">
      <div className="panel-header">
        <h3>{t('settings.credentials.title')}</h3>
        <p className="panel-description">{t('settings.credentials.description')}</p>
        <p className="panel-description">
          {isSyncing
            ? 'Syncing credential changes...'
            : `Stored providers: ${storedProviders.length > 0 ? storedProviders.join(', ') : 'none'}`}
        </p>
      </div>

      {/* OpenAI */}
      <div className="credential-card">
        <div className="credential-header">
          <div className="credential-icon"><OpenAI size="md" /></div>
          <h3>{t('settings.credentials.openai.title')}</h3>
          {storedSet.has('openai') && <span className="field-hint">Saved</span>}
        </div>
        <div className="credential-body">
          <div className="form-field">
            <label>{t('settings.credentials.apiKey')}</label>
            <input
              type="password"
              value={credentials.openai?.apiKey || ''}
              onChange={(e) =>
                onChange({
                  ...credentials,
                  openai: { apiKey: e.target.value },
                })
              }
              placeholder={t('settings.credentials.openai.placeholder')}
              className="credential-input"
            />
            <p className="field-hint">
              {t('settings.credentials.getApiKeyFrom')}{' '}
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
          <div className="credential-icon"><Gemini size="md" /></div>
          <h3>{t('settings.credentials.gemini.title')}</h3>
          {storedSet.has('gemini') && <span className="field-hint">Saved</span>}
        </div>
        <div className="credential-body">
          <div className="form-field">
            <label>{t('settings.credentials.apiKey')}</label>
            <input
              type="password"
              value={credentials.gemini.apiKey}
              onChange={(e) =>
                onChange({
                  ...credentials,
                  gemini: { apiKey: e.target.value },
                })
              }
              placeholder={t('settings.credentials.gemini.placeholder')}
              className="credential-input"
            />
            <p className="field-hint">
              {t('settings.credentials.getApiKeyFrom')}{' '}
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
          <div className="credential-icon"><Claude size="md" /></div>
          <h3>{t('settings.credentials.claude.title')}</h3>
          {storedSet.has('claude') && <span className="field-hint">Saved</span>}
        </div>
        <div className="credential-body">
          <div className="form-field">
            <label>{t('settings.credentials.apiKey')}</label>
            <input
              type="password"
              value={credentials.claude.apiKey}
              onChange={(e) =>
                onChange({
                  ...credentials,
                  claude: { apiKey: e.target.value },
                })
              }
              placeholder={t('settings.credentials.claude.placeholder')}
              className="credential-input"
            />
            <p className="field-hint">
              {t('settings.credentials.getApiKeyFrom')}{' '}
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
          <div className="credential-icon"><OpenRouter size="md" /></div>
          <h3>{t('settings.credentials.openrouter.title')}</h3>
          {storedSet.has('openrouter') && <span className="field-hint">Saved</span>}
        </div>
        <div className="credential-body">
          <div className="form-field">
            <label>{t('settings.credentials.apiKey')}</label>
            <input
              type="password"
              value={credentials.openrouter.apiKey}
              onChange={(e) =>
                onChange({
                  ...credentials,
                  openrouter: { apiKey: e.target.value },
                })
              }
              placeholder={t('settings.credentials.openrouter.placeholder')}
              className="credential-input"
            />
            <p className="field-hint">
              {t('settings.credentials.getApiKeyFrom')}{' '}
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
          <div className="credential-icon"><XAI size="md" /></div>
          <h3>{t('settings.credentials.xai.title')}</h3>
          {storedSet.has('xai') && <span className="field-hint">Saved</span>}
        </div>
        <div className="credential-body">
          <div className="form-field">
            <label>{t('settings.credentials.apiKey')}</label>
            <input
              type="password"
              value={credentials.xai?.apiKey || ''}
              onChange={(e) =>
                onChange({
                  ...credentials,
                  xai: { apiKey: e.target.value },
                })
              }
              placeholder={t('settings.credentials.xai.placeholder')}
              className="credential-input"
            />
            <p className="field-hint">
              {t('settings.credentials.getApiKeyFrom')}{' '}
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
          <div className="credential-icon"><NovelAI size="md" /></div>
          <h3>{t('settings.credentials.novelai.title')}</h3>
          {storedSet.has('novelai') && <span className="field-hint">Saved</span>}
        </div>
        <div className="credential-body">
          <div className="form-field">
            <label>{t('settings.credentials.accessToken')}</label>
            <input
              type="password"
              value={credentials.novelai?.apiKey || ''}
              onChange={(e) =>
                onChange({
                  ...credentials,
                  novelai: { apiKey: e.target.value },
                })
              }
              placeholder={t('settings.credentials.novelai.placeholder')}
              className="credential-input"
            />
            <p className="field-hint">{t('settings.credentials.novelai.hint')}</p>
          </div>
        </div>
      </div>

      {/* Custom Endpoint */}
      <div className="credential-card">
        <div className="credential-header">
          <div className="credential-icon"><CustomProvider size="md" /></div>
          <h3>{t('settings.credentials.custom.title')}</h3>
          {storedSet.has('custom') && <span className="field-hint">Saved</span>}
        </div>
        <div className="credential-body">
          <div className="form-field">
            <label>{t('settings.credentials.baseUrl')}</label>
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
              placeholder={t('settings.credentials.custom.baseUrlPlaceholder')}
              className="credential-input"
            />
            <p className="field-hint">{t('settings.credentials.custom.baseUrlHint')}</p>
          </div>
          <div className="form-field">
            <label>{t('settings.credentials.apiKeyOptional')}</label>
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
              placeholder={t('settings.credentials.custom.apiKeyPlaceholder')}
              className="credential-input"
            />
            <p className="field-hint">{t('settings.credentials.custom.apiKeyHint')}</p>
          </div>
          <div className="form-field">
            <label>{t('settings.credentials.custom.additionalHeaders')}</label>
            <textarea
              value={credentials.custom.additionalHeadersJson || '{}'}
              onChange={(e) =>
                onChange({
                  ...credentials,
                  custom: {
                    ...credentials.custom,
                    additionalHeadersJson: e.target.value,
                  },
                })
              }
              placeholder={t('settings.credentials.custom.additionalHeadersPlaceholder')}
              className="credential-textarea"
              spellCheck={false}
            />
            <p className="field-hint">{t('settings.credentials.custom.additionalHeadersHint')}</p>
          </div>
          <div className="form-field">
            <label>{t('settings.credentials.custom.additionalBody')}</label>
            <textarea
              value={credentials.custom.additionalBodyJson || '{}'}
              onChange={(e) =>
                onChange({
                  ...credentials,
                  custom: {
                    ...credentials.custom,
                    additionalBodyJson: e.target.value,
                  },
                })
              }
              placeholder={t('settings.credentials.custom.additionalBodyPlaceholder')}
              className="credential-textarea"
              spellCheck={false}
            />
            <p className="field-hint">{t('settings.credentials.custom.additionalBodyHint')}</p>
          </div>
        </div>
      </div>

    </div>
  );
};

export default CredentialsPanel;
