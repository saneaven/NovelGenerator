import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderCredentials, ProviderType } from '../../store/settingsStore';
import type { RagEmbeddingProfile } from '../../api/ragService';
import ModelBrowser from './ModelBrowser';
import { TextButton } from '../TextButton';
import { CustomSelect } from '../ui/CustomSelect';

interface RagSearchPanelProps {
  profile: { provider: ProviderType; model: string };
  savedProfile: RagEmbeddingProfile | null;
  credentials: ProviderCredentials;
  mainLanguage: string;
  loading?: boolean;
  loadError?: string | null;
  onChange: (next: { provider: ProviderType; model: string }) => void;
}

const RagSearchPanel: React.FC<RagSearchPanelProps> = ({
  profile,
  savedProfile,
  credentials,
  mainLanguage,
  loading,
  loadError,
  onChange,
}) => {
  const { t } = useTranslation();
  const [showModelBrowser, setShowModelBrowser] = useState(false);

  const dimensions = useMemo(() => {
    if (!savedProfile) return null;
    if (savedProfile.provider !== profile.provider) return null;
    if (savedProfile.model !== profile.model) return null;
    return savedProfile.dimensions ?? null;
  }, [profile.model, profile.provider, savedProfile]);

  const handleProviderChange = (provider: ProviderType) => {
    setShowModelBrowser(false);
    onChange({ provider, model: '' });
  };

  const handleModelChange = (model: string) => {
    onChange({ ...profile, model });
  };

  if (loading) {
    return <div className="loading-state">{t('common.loading')}</div>;
  }

  if (loadError) {
    return (
      <div className="settings-panel-card">
        <div className="validation-warning validation-error">
          <div className="validation-warning-icon">!</div>
          <div>
            <div>{t('settings.ragSearch.loadErrorTitle')}</div>
            <div className="field-hint">{loadError}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rag-search-panel">
      <div className="panel-header">
        <h3>{t('settings.ragSearch.title')}</h3>
        <p className="panel-description">{t('settings.ragSearch.description')}</p>
      </div>

      <div className="settings-panel-card">
        <div className="form-field">
          <label>{t('settings.ragSearch.provider')}</label>
          <CustomSelect
            value={profile.provider}
            onChange={(value) => handleProviderChange(value as ProviderType)}
            options={[
              { value: 'openai', label: 'OpenAI' },
              { value: 'openrouter', label: 'OpenRouter' },
              { value: 'custom', label: t('settings.credentials.custom.title') },
            ]}
          />
          <p className="field-hint">{t('settings.ragSearch.providerHint')}</p>
        </div>

        <div className="form-field">
          <label>{t('settings.ragSearch.model')}</label>
          <div className="model-input-row">
            <input
              type="text"
              value={profile.model}
              onChange={(e) => handleModelChange(e.target.value)}
              placeholder={t('settings.ragSearch.modelPlaceholder')}
              className="config-input"
            />
            <TextButton
              variant={showModelBrowser ? 'primary' : 'secondary'}
              size="sm"
              type="button"
              onClick={() => setShowModelBrowser(!showModelBrowser)}
              title={t('settings.ragSearch.browse')}
            >
              {showModelBrowser ? t('common.hide') : t('common.browse')}
            </TextButton>
          </div>
          <p className="field-hint">{t('settings.ragSearch.modelHint')}</p>

          {showModelBrowser && (
            <ModelBrowser
              key={profile.provider}
              autoExpand={true}
              provider={profile.provider}
              currentModel={profile.model}
              credentials={credentials}
              onSelectModel={(m) => {
                handleModelChange(m);
                setShowModelBrowser(false);
              }}
              onUpdateProviderPreference={() => {
                // not used for embedding profile
              }}
            />
          )}
        </div>

        <div className="form-field">
          <label>{t('settings.ragSearch.indexLanguage')}</label>
          <input type="text" value={mainLanguage} disabled />
          <p className="field-hint">{t('settings.ragSearch.indexLanguageHint')}</p>
        </div>

        <div className="form-field">
          <label>{t('settings.ragSearch.dimensions')}</label>
          <input
            type="text"
            value={dimensions != null ? String(dimensions) : t('settings.ragSearch.dimensionsUnknown')}
            disabled
          />
          <p className="field-hint">{t('settings.ragSearch.dimensionsHint')}</p>
        </div>

      </div>

      <div className="info-box">
        <h4>{t('settings.ragSearch.rulesTitle')}</h4>
        <ul>
          <li>{t('settings.ragSearch.rules.mainLanguageOnly')}</li>
          <li>{t('settings.ragSearch.rules.excludesMarkdownAssets')}</li>
          <li>{t('settings.ragSearch.rules.orderedResults')}</li>
          <li>{t('settings.ragSearch.rules.reindexRequired')}</li>
        </ul>
      </div>
    </div>
  );
};

export default RagSearchPanel;

