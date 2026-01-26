import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderCredentials, ProviderType } from '../../store/settingsStore';
import type { RagEmbeddingProfile } from '../../api/ragService';
import ModelBrowser from './ModelBrowser';
import { TextButton } from '../TextButton';
import { CustomSelect } from '../ui/CustomSelect';
import ToggleSwitch from '../common/ToggleSwitch';
import { Toggle } from '../icons';

interface RagSearchPanelProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  profile: { provider: ProviderType; model: string };
  savedProfile: RagEmbeddingProfile | null;
  credentials: ProviderCredentials;
  mainLanguage: string;
  topKPerQuery: number;
  onTopKPerQueryChange: (value: number) => void;
  neighborWindow: number;
  onNeighborWindowChange: (value: number) => void;
  maxPrimaryChunks: number;
  onMaxPrimaryChunksChange: (value: number) => void;
  maxTotalChunks: number;
  onMaxTotalChunksChange: (value: number) => void;
  loading?: boolean;
  loadError?: string | null;
  onChange: (next: { provider: ProviderType; model: string }) => void;
}

const RagSearchPanel: React.FC<RagSearchPanelProps> = ({
  enabled,
  onEnabledChange,
  profile,
  savedProfile,
  credentials,
  mainLanguage,
  topKPerQuery,
  onTopKPerQueryChange,
  neighborWindow,
  onNeighborWindowChange,
  maxPrimaryChunks,
  onMaxPrimaryChunksChange,
  maxTotalChunks,
  onMaxTotalChunksChange,
  loading,
  loadError,
  onChange,
}) => {
  const { t } = useTranslation();
  const [showModelBrowser, setShowModelBrowser] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setShowModelBrowser(false);
    }
  }, [enabled]);

  const dimensions = useMemo(() => {
    if (!savedProfile) return null;
    if (savedProfile.provider !== profile.provider) return null;
    if (savedProfile.model !== profile.model) return null;
    return savedProfile.dimensions ?? null;
  }, [profile.model, profile.provider, savedProfile]);

  const handleProviderChange = (provider: ProviderType) => {
    if (!enabled) return;
    setShowModelBrowser(false);
    onChange({ provider, model: '' });
  };

  const handleModelChange = (model: string) => {
    if (!enabled) return;
    onChange({ ...profile, model });
  };

  const clampInt = (value: number, min: number, max: number): number => {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.trunc(value)));
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
          <ToggleSwitch
            checked={enabled}
            onChange={onEnabledChange}
            label={t('settings.ragSearch.enableLabel')}
            icon={<Toggle size="sm" />}
          />
          <p className="field-hint">{t('settings.ragSearch.enableHint')}</p>
        </div>

        <div className="form-field">
          <label>{t('settings.ragSearch.provider')}</label>
          <CustomSelect
            value={profile.provider}
            onChange={(value) => handleProviderChange(value as ProviderType)}
            options={[
              { value: 'openai', label: 'OpenAI' },
              { value: 'gemini', label: 'Gemini' },
              { value: 'openrouter', label: 'OpenRouter' },
              { value: 'custom', label: t('settings.credentials.custom.title') },
            ]}
            disabled={!enabled}
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
              disabled={!enabled}
            />
            <TextButton
              variant={showModelBrowser ? 'primary' : 'secondary'}
              size="sm"
              type="button"
              onClick={() => setShowModelBrowser(!showModelBrowser)}
              title={t('settings.ragSearch.browse')}
              disabled={!enabled}
            >
              {showModelBrowser ? t('common.hide') : t('common.browse')}
            </TextButton>
          </div>
          <p className="field-hint">{t('settings.ragSearch.modelHint')}</p>

          {enabled && showModelBrowser && (
            <ModelBrowser
              key={profile.provider}
              autoExpand={true}
              provider={profile.provider}
              mode="embedding"
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

        <div className="form-field">
          <label>{t('settings.ragSearch.topKPerQuery')}</label>
          <input
            type="number"
            value={topKPerQuery}
            min={1}
            max={200}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isNaN(n)) return;
              onTopKPerQueryChange(clampInt(n, 1, 200));
            }}
            className="config-input"
          />
          <p className="field-hint">{t('settings.ragSearch.topKPerQueryHint')}</p>
        </div>

        <div className="form-field">
          <label>{t('settings.ragSearch.neighborWindow')}</label>
          <input
            type="number"
            value={neighborWindow}
            min={0}
            max={20}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isNaN(n)) return;
              onNeighborWindowChange(clampInt(n, 0, 20));
            }}
            className="config-input"
          />
          <p className="field-hint">{t('settings.ragSearch.neighborWindowHint')}</p>
        </div>

        <div className="form-field">
          <label>{t('settings.ragSearch.maxPrimaryChunks')}</label>
          <input
            type="number"
            value={maxPrimaryChunks}
            min={1}
            max={200}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isNaN(n)) return;
              onMaxPrimaryChunksChange(clampInt(n, 1, 200));
            }}
            className="config-input"
          />
          <p className="field-hint">{t('settings.ragSearch.maxPrimaryChunksHint')}</p>
        </div>

        <div className="form-field">
          <label>{t('settings.ragSearch.maxTotalChunks')}</label>
          <input
            type="number"
            value={maxTotalChunks}
            min={1}
            max={500}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isNaN(n)) return;
              onMaxTotalChunksChange(clampInt(n, 1, 500));
            }}
            className="config-input"
          />
          <p className="field-hint">{t('settings.ragSearch.maxTotalChunksHint')}</p>
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
