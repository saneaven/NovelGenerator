import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderType } from '../../store/settingsStore';
import type { EmbeddingProfileConfig } from '../../store/settingsStore';
import ModelBrowser from './ModelBrowser';
import { TextButton } from '../TextButton';
import { CustomSelect } from '../ui/CustomSelect';
import ToggleSwitch from '../common/ToggleSwitch';
import { NumberInput } from '../ui/NumberInput';
import { Toggle } from '../icons';

type SearchSubTab = 'keywordSearch' | 'ragSearch' | 'agentMemory';
type ModelBrowserTarget = 'ragSearch' | 'agentMemory';

interface SearchMemoryPanelProps {
  vectorStorageEnabled: boolean;
  onVectorStorageEnabledChange: (enabled: boolean) => void;
  ragSearchProfile: EmbeddingProfileConfig;
  onRagSearchProfileChange: (next: EmbeddingProfileConfig) => void;
  agentMemoryProfile: EmbeddingProfileConfig;
  onAgentMemoryProfileChange: (next: EmbeddingProfileConfig) => void;
  keywordPageSize: number;
  onKeywordPageSizeChange: (value: number) => void;
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

const SearchMemoryPanel: React.FC<SearchMemoryPanelProps> = ({
  vectorStorageEnabled,
  onVectorStorageEnabledChange,
  ragSearchProfile,
  onRagSearchProfileChange,
  agentMemoryProfile,
  onAgentMemoryProfileChange,
  keywordPageSize,
  onKeywordPageSizeChange,
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
  const [activeTab, setActiveTab] = useState<SearchSubTab>('keywordSearch');
  const [showModelBrowser, setShowModelBrowser] = useState(false);
  const [activeModelBrowser, setActiveModelBrowser] = useState<ModelBrowserTarget>('ragSearch');

  useEffect(() => {
    if (!vectorStorageEnabled) {
      setShowModelBrowser(false);
    }
  }, [vectorStorageEnabled]);

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
    if (!vectorStorageEnabled) return;
    setShowModelBrowser(false);
    onRagSearchProfileChange({ provider, model: '', dimensions: null });
  };

  const handleRagModelChange = (model: string) => {
    if (!vectorStorageEnabled) return;
    onRagSearchProfileChange({ ...ragSearchProfile, model, dimensions: null });
  };

  const handleMemProviderChange = (provider: ProviderType) => {
    if (!vectorStorageEnabled) return;
    setShowModelBrowser(false);
    onAgentMemoryProfileChange({ provider, model: '', dimensions: null });
  };

  const handleMemModelChange = (model: string) => {
    if (!vectorStorageEnabled) return;
    onAgentMemoryProfileChange({ ...agentMemoryProfile, model, dimensions: null });
  };


  const title = useMemo(() => {
    if (activeTab === 'keywordSearch') return t('settings.keywordSearch.title');
    if (activeTab === 'ragSearch') return t('settings.ragSearch.title');
    return t('settings.agentMemory.title');
  }, [activeTab, t]);

  const description = useMemo(() => {
    if (activeTab === 'keywordSearch') return t('settings.keywordSearch.description');
    if (activeTab === 'ragSearch') return t('settings.ragSearch.description');
    return t('settings.agentMemory.description');
  }, [activeTab, t]);

  return (
    <div className="rag-search-panel">
      <div className="panel-header">
        <h3>{title}</h3>
        <p className="panel-description">{description}</p>
      </div>

      <div className="settings-panel-card">
        <div className="form-field">
          <ToggleSwitch
            checked={vectorStorageEnabled}
            onChange={onVectorStorageEnabledChange}
            label={t('settings.embeddings.enableLabel')}
            icon={<Toggle size="sm" />}
          />
          <p className="field-hint">{t('settings.embeddings.enableHint')}</p>
        </div>
      </div>

      <div className="task-selector">
        <button
          className={`task-tab ${activeTab === 'keywordSearch' ? 'active' : ''}`}
          onClick={() => setActiveTab('keywordSearch')}
          type="button"
        >
          {t('settings.tabs.keywordSearch')}
        </button>

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

      {activeTab === 'keywordSearch' && (
        <div className="settings-panel-card">
          <div className="form-field">
            <label>{t('settings.keywordSearch.pageSize')}</label>
            <NumberInput
              value={keywordPageSize}
              min={1}
              max={200}
              onValueChange={(v) => onKeywordPageSizeChange(v!)}
              className="config-input"
              disabled={!vectorStorageEnabled}
            />
            <p className="field-hint">{t('settings.keywordSearch.pageSizeHint')}</p>
          </div>
        </div>
      )}

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
                disabled={!vectorStorageEnabled}
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
                  disabled={!vectorStorageEnabled}
                />
                <TextButton
                  variant={showModelBrowser && activeModelBrowser === 'ragSearch' ? 'primary' : 'secondary'}
                  size="sm"
                  type="button"
                  onClick={() => {
                    setActiveModelBrowser('ragSearch');
                    setShowModelBrowser(!showModelBrowser);
                  }}
                  title={t('settings.ragSearch.browse')}
                  disabled={!vectorStorageEnabled}
                >
                  {showModelBrowser && activeModelBrowser === 'ragSearch' ? t('common.hide') : t('common.browse')}
                </TextButton>
              </div>
              <p className="field-hint">{t('settings.ragSearch.modelHint')}</p>

              {vectorStorageEnabled && showModelBrowser && activeModelBrowser === 'ragSearch' && (
                <ModelBrowser
                  key={`ragSearch:${ragSearchProfile.provider}`}
                  autoExpand={true}
                  provider={ragSearchProfile.provider}
                  mode="embedding"
                  currentModel={ragSearchProfile.model}
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
              <NumberInput
                value={topKPerQuery}
                min={1}
                max={200}
                onValueChange={(v) => onTopKPerQueryChange(v!)}
                className="config-input"
                disabled={!vectorStorageEnabled}
              />
              <p className="field-hint">{t('settings.ragSearch.topKPerQueryHint')}</p>
            </div>

            <div className="form-field">
              <label>{t('settings.ragSearch.neighborWindow')}</label>
              <NumberInput
                value={neighborWindow}
                min={0}
                max={20}
                onValueChange={(v) => onNeighborWindowChange(v!)}
                className="config-input"
                disabled={!vectorStorageEnabled}
              />
              <p className="field-hint">{t('settings.ragSearch.neighborWindowHint')}</p>
            </div>

            <div className="form-field">
              <label>{t('settings.ragSearch.maxPrimaryChunks')}</label>
              <NumberInput
                value={maxPrimaryChunks}
                min={1}
                max={200}
                onValueChange={(v) => onMaxPrimaryChunksChange(v!)}
                className="config-input"
                disabled={!vectorStorageEnabled}
              />
              <p className="field-hint">{t('settings.ragSearch.maxPrimaryChunksHint')}</p>
            </div>

            <div className="form-field">
              <label>{t('settings.ragSearch.maxTotalChunks')}</label>
              <NumberInput
                value={maxTotalChunks}
                min={1}
                max={500}
                onValueChange={(v) => onMaxTotalChunksChange(v!)}
                className="config-input"
                disabled={!vectorStorageEnabled}
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
                disabled={!vectorStorageEnabled}
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
                disabled={!vectorStorageEnabled}
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
                disabled={!vectorStorageEnabled}
              >
                {showModelBrowser && activeModelBrowser === 'agentMemory' ? t('common.hide') : t('common.browse')}
              </TextButton>
            </div>
            <p className="field-hint">{t('settings.agentMemory.modelHint')}</p>

            {vectorStorageEnabled && showModelBrowser && activeModelBrowser === 'agentMemory' && (
                <ModelBrowser
                  key={`agentMemory:${agentMemoryProfile.provider}`}
                  autoExpand={true}
                  provider={agentMemoryProfile.provider}
                  mode="embedding"
                  currentModel={agentMemoryProfile.model}
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
            <NumberInput
              value={agentMemoryTopKPerQuery}
              min={1}
              max={200}
              onValueChange={(v) => onAgentMemoryTopKPerQueryChange(v!)}
              className="config-input"
              disabled={!vectorStorageEnabled}
            />
            <p className="field-hint">{t('settings.agentMemory.topKPerQueryHint')}</p>
          </div>

          <div className="form-field">
            <label>{t('settings.agentMemory.neighborWindow')}</label>
            <NumberInput
              value={agentMemoryNeighborWindow}
              min={0}
              max={20}
              onValueChange={(v) => onAgentMemoryNeighborWindowChange(v!)}
              className="config-input"
              disabled={!vectorStorageEnabled}
            />
            <p className="field-hint">{t('settings.agentMemory.neighborWindowHint')}</p>
          </div>

          <div className="form-field">
            <label>{t('settings.agentMemory.maxPrimaryMessages')}</label>
            <NumberInput
              value={agentMemoryMaxPrimaryMessages}
              min={1}
              max={200}
              onValueChange={(v) => onAgentMemoryMaxPrimaryMessagesChange(v!)}
              className="config-input"
              disabled={!vectorStorageEnabled}
            />
            <p className="field-hint">{t('settings.agentMemory.maxPrimaryMessagesHint')}</p>
          </div>

          <div className="form-field">
            <label>{t('settings.agentMemory.maxTotalMessages')}</label>
            <NumberInput
              value={agentMemoryMaxTotalMessages}
              min={1}
              max={500}
              onValueChange={(v) => onAgentMemoryMaxTotalMessagesChange(v!)}
              className="config-input"
              disabled={!vectorStorageEnabled}
            />
            <p className="field-hint">{t('settings.agentMemory.maxTotalMessagesHint')}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchMemoryPanel;
