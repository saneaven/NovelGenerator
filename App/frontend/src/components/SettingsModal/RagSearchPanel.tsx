import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderCredentials, ProviderType } from '../../store/settingsStore';
import type { EmbeddingProfileConfig } from '../../store/settingsStore';
import ModelBrowser from './ModelBrowser';
import { TextButton } from '../TextButton';
import { CustomSelect } from '../ui/CustomSelect';
import ToggleSwitch from '../common/ToggleSwitch';
import { Toggle } from '../icons';

type RagSubTab = 'ragSearch' | 'agentMemory';

interface RagSearchPanelProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  ragSearchProfile: EmbeddingProfileConfig;
  onRagSearchProfileChange: (next: EmbeddingProfileConfig) => void;
  agentMemoryProfile: EmbeddingProfileConfig;
  onAgentMemoryProfileChange: (next: EmbeddingProfileConfig) => void;
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
  agentMemoryTopKPerQuery: number;
  onAgentMemoryTopKPerQueryChange: (value: number) => void;
  agentMemoryNeighborWindow: number;
  onAgentMemoryNeighborWindowChange: (value: number) => void;
  agentMemoryMaxPrimaryMessages: number;
  onAgentMemoryMaxPrimaryMessagesChange: (value: number) => void;
  agentMemoryMaxTotalMessages: number;
  onAgentMemoryMaxTotalMessagesChange: (value: number) => void;
}

const RagSearchPanel: React.FC<RagSearchPanelProps> = ({
  enabled,
  onEnabledChange,
  ragSearchProfile,
  onRagSearchProfileChange,
  agentMemoryProfile,
  onAgentMemoryProfileChange,
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
  agentMemoryTopKPerQuery,
  onAgentMemoryTopKPerQueryChange,
  agentMemoryNeighborWindow,
  onAgentMemoryNeighborWindowChange,
  agentMemoryMaxPrimaryMessages,
  onAgentMemoryMaxPrimaryMessagesChange,
  agentMemoryMaxTotalMessages,
  onAgentMemoryMaxTotalMessagesChange,
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<RagSubTab>('ragSearch');
  const [showModelBrowser, setShowModelBrowser] = useState(false);
  const [activeModelBrowser, setActiveModelBrowser] = useState<RagSubTab>('ragSearch');

  useEffect(() => {
    if (!enabled) {
      setShowModelBrowser(false);
    }
  }, [enabled]);

  useEffect(() => {
    setShowModelBrowser(false);
  }, [activeTab]);

  const ragDimensions = useMemo(() => {
    return ragSearchProfile.dimensions ?? null;
  }, [ragSearchProfile.dimensions]);

  const memDimensions = useMemo(() => {
    return agentMemoryProfile.dimensions ?? null;
  }, [agentMemoryProfile.dimensions]);

  const handleRagProviderChange = (provider: ProviderType) => {
    if (!enabled) return;
    setShowModelBrowser(false);
    onRagSearchProfileChange({ provider, model: '', dimensions: null });
  };

  const handleRagModelChange = (model: string) => {
    if (!enabled) return;
    onRagSearchProfileChange({ ...ragSearchProfile, model, dimensions: null });
  };

  const handleMemProviderChange = (provider: ProviderType) => {
    setShowModelBrowser(false);
    onAgentMemoryProfileChange({ provider, model: '', dimensions: null });
  };

  const handleMemModelChange = (model: string) => {
    onAgentMemoryProfileChange({ ...agentMemoryProfile, model, dimensions: null });
  };

  const clampInt = (value: number, min: number, max: number): number => {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.trunc(value)));
  };

  return (
    <div className="rag-search-panel">
      <div className="panel-header">
        <h3>{activeTab === 'ragSearch' ? t('settings.ragSearch.title') : t('settings.agentMemory.title')}</h3>
        <p className="panel-description">
          {activeTab === 'ragSearch' ? t('settings.ragSearch.description') : t('settings.agentMemory.description')}
        </p>
      </div>

      <div className="settings-panel-card">
        <div className="form-field">
          <ToggleSwitch
            checked={enabled}
            onChange={onEnabledChange}
            label={t('settings.embeddings.enableLabel')}
            icon={<Toggle size="sm" />}
          />
          <p className="field-hint">{t('settings.embeddings.enableHint')}</p>
        </div>
      </div>

      <div className="task-selector">
        <button
          className={`task-tab ${activeTab === 'ragSearch' ? 'active' : ''}`}
          onClick={() => setActiveTab('ragSearch')}
          type="button"
        >
          {t('settings.tabs.ragSearch')}
        </button>
        <button
          className={`task-tab ${activeTab === 'agentMemory' ? 'active' : ''}`}
          onClick={() => setActiveTab('agentMemory')}
          type="button"
        >
          {t('settings.tabs.agentMemory')}
        </button>
      </div>

      {activeTab === 'ragSearch' && (
      <>
      <div className="settings-panel-card">
        <div className="form-field">
          <label>{t('settings.ragSearch.provider')}</label>
          <CustomSelect
            value={ragSearchProfile.provider}
            onChange={(value) => handleRagProviderChange(value as ProviderType)}
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
              value={ragSearchProfile.model}
              onChange={(e) => handleRagModelChange(e.target.value)}
              placeholder={t('settings.ragSearch.modelPlaceholder')}
              className="config-input"
              disabled={!enabled}
            />
            <TextButton
              variant={showModelBrowser ? 'primary' : 'secondary'}
              size="sm"
              type="button"
              onClick={() => {
                setActiveModelBrowser('ragSearch');
                setShowModelBrowser(!showModelBrowser);
              }}
              title={t('settings.ragSearch.browse')}
              disabled={!enabled}
            >
              {showModelBrowser ? t('common.hide') : t('common.browse')}
            </TextButton>
          </div>
          <p className="field-hint">{t('settings.ragSearch.modelHint')}</p>

          {enabled && showModelBrowser && activeModelBrowser === 'ragSearch' && (
            <ModelBrowser
              key={`ragSearch:${ragSearchProfile.provider}`}
              autoExpand={true}
              provider={ragSearchProfile.provider}
              mode="embedding"
              currentModel={ragSearchProfile.model}
              credentials={credentials}
              onSelectModel={(m) => {
                handleRagModelChange(m);
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
            value={ragDimensions != null ? String(ragDimensions) : t('settings.ragSearch.dimensionsUnknown')}
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
      </>
      )}

      {activeTab === 'agentMemory' && (
        <div className="settings-panel-card">
          <div className="form-field">
            <label>{t('settings.agentMemory.provider')}</label>
            <CustomSelect
              value={agentMemoryProfile.provider}
              onChange={(value) => handleMemProviderChange(value as ProviderType)}
              options={[
                { value: 'openai', label: 'OpenAI' },
                { value: 'gemini', label: 'Gemini' },
                { value: 'openrouter', label: 'OpenRouter' },
                { value: 'custom', label: t('settings.credentials.custom.title') },
              ]}
              disabled={!enabled}
            />
            <p className="field-hint">{t('settings.agentMemory.providerHint')}</p>
          </div>

          <div className="form-field">
            <label>{t('settings.agentMemory.model')}</label>
            <div className="model-input-row">
              <input
                type="text"
                value={agentMemoryProfile.model}
                onChange={(e) => handleMemModelChange(e.target.value)}
                placeholder={t('settings.agentMemory.modelPlaceholder')}
                className="config-input"
                disabled={!enabled}
              />
              <TextButton
                variant={showModelBrowser && activeModelBrowser === 'agentMemory' ? 'primary' : 'secondary'}
                size="sm"
                type="button"
                onClick={() => {
                  setActiveModelBrowser('agentMemory');
                  setShowModelBrowser(!showModelBrowser);
                }}
                title={t('settings.agentMemory.browse')}
                disabled={!enabled}
              >
                {showModelBrowser && activeModelBrowser === 'agentMemory' ? t('common.hide') : t('common.browse')}
              </TextButton>
            </div>
            <p className="field-hint">{t('settings.agentMemory.modelHint')}</p>

            {showModelBrowser && activeModelBrowser === 'agentMemory' && (
              <ModelBrowser
                key={`agentMemory:${agentMemoryProfile.provider}`}
                autoExpand={true}
                provider={agentMemoryProfile.provider}
                mode="embedding"
                currentModel={agentMemoryProfile.model}
                credentials={credentials}
                onSelectModel={(m) => {
                  handleMemModelChange(m);
                  setShowModelBrowser(false);
                }}
                onUpdateProviderPreference={() => {
                  // not used for embedding profile
                }}
              />
            )}
          </div>

          <div className="form-field">
            <label>{t('settings.agentMemory.dimensions')}</label>
            <input
              type="text"
              value={memDimensions != null ? String(memDimensions) : t('settings.agentMemory.dimensionsUnknown')}
              disabled
            />
            <p className="field-hint">{t('settings.agentMemory.dimensionsHint')}</p>
          </div>

          <div className="form-field">
            <label>{t('settings.agentMemory.topKPerQuery')}</label>
            <input
              type="number"
              value={agentMemoryTopKPerQuery}
              min={1}
              max={200}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (Number.isNaN(n)) return;
                onAgentMemoryTopKPerQueryChange(clampInt(n, 1, 200));
              }}
              className="config-input"
            />
            <p className="field-hint">{t('settings.agentMemory.topKPerQueryHint')}</p>
          </div>

          <div className="form-field">
            <label>{t('settings.agentMemory.neighborWindow')}</label>
            <input
              type="number"
              value={agentMemoryNeighborWindow}
              min={0}
              max={20}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (Number.isNaN(n)) return;
                onAgentMemoryNeighborWindowChange(clampInt(n, 0, 20));
              }}
              className="config-input"
            />
            <p className="field-hint">{t('settings.agentMemory.neighborWindowHint')}</p>
          </div>

          <div className="form-field">
            <label>{t('settings.agentMemory.maxPrimaryMessages')}</label>
            <input
              type="number"
              value={agentMemoryMaxPrimaryMessages}
              min={1}
              max={200}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (Number.isNaN(n)) return;
                onAgentMemoryMaxPrimaryMessagesChange(clampInt(n, 1, 200));
              }}
              className="config-input"
            />
            <p className="field-hint">{t('settings.agentMemory.maxPrimaryMessagesHint')}</p>
          </div>

          <div className="form-field">
            <label>{t('settings.agentMemory.maxTotalMessages')}</label>
            <input
              type="number"
              value={agentMemoryMaxTotalMessages}
              min={1}
              max={500}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (Number.isNaN(n)) return;
                onAgentMemoryMaxTotalMessagesChange(clampInt(n, 1, 500));
              }}
              className="config-input"
            />
            <p className="field-hint">{t('settings.agentMemory.maxTotalMessagesHint')}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default RagSearchPanel;
