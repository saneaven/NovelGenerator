import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  EmbeddingProviderType,
  MemoryConfig,
  SearchGeneralConfig,
  SearchMemorySettings,
  SearchMemoryTarget,
} from '../../store/settingsStore';
import {
  hasSearchMemoryOverride,
  makeMemoryOverrideSeed,
  makeSearchOverrideSeed,
  resolveMemorySettings,
  resolveSearchSettings,
} from '../../store/searchMemorySettings';
import ModelBrowser from './ModelBrowser';
import { TextButton } from '../TextButton';
import ToggleSwitch from '../common/ToggleSwitch';
import { CustomSelect } from '../ui/CustomSelect';
import { NumberInput } from '../ui/NumberInput';
import { IconButton } from '../IconButton';
import { ChevronLeft, ChevronRight, Scroll, Search, Settings as SettingsIcon, Toggle } from '../icons';
import { useProviderSpecStore } from '../../providerEngine/store';
import './SearchMemoryPanel.css';

type SearchMemoryConfigTarget = 'general' | SearchMemoryTarget;
type ModelBrowserTarget = SearchMemoryConfigTarget;

interface SearchMemoryPanelProps {
  settings: SearchMemorySettings;
  activeTarget: SearchMemoryConfigTarget;
  onTargetChange: (target: SearchMemoryConfigTarget) => void;
  onChange: (settings: SearchMemorySettings) => void;
  mainLanguage: string;
}

const TARGET_ICONS: Record<SearchMemoryConfigTarget, React.ReactNode> = {
  general: <SettingsIcon size="sm" />,
  search: <Search size="sm" />,
  memory: <Scroll size="sm" />,
};

const isMobileViewport = () =>
  typeof window !== 'undefined' && window.innerWidth <= 768;

const SearchMemoryPanel: React.FC<SearchMemoryPanelProps> = ({
  settings,
  activeTarget,
  onTargetChange,
  onChange,
  mainLanguage,
}) => {
  const { t } = useTranslation();
  const specs = useProviderSpecStore((state) => state.specs);
  const loadProviderSpecs = useProviderSpecStore((state) => state.load);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => isMobileViewport());
  const [showModelBrowser, setShowModelBrowser] = useState(false);
  const [activeModelBrowser, setActiveModelBrowser] = useState<ModelBrowserTarget>('general');

  useEffect(() => {
    void loadProviderSpecs();
  }, [loadProviderSpecs]);

  const providerSpecs = useMemo(() => {
    const providers = Object.values(specs).filter((provider) => Boolean(provider.embedding));
    providers.sort((a, b) => {
      const left = a.ui.embedding_order ?? 999;
      const right = b.ui.embedding_order ?? 999;
      return left - right || a.id.localeCompare(b.id);
    });
    return providers;
  }, [specs]);

  const providerOptions = useMemo(
    () => providerSpecs.map((provider) => ({
      value: provider.id,
      label: t(provider.ui.display_name_key),
    })),
    [providerSpecs, t]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let lastIsMobile = isMobileViewport();
    const handleResize = () => {
      const nextIsMobile = isMobileViewport();
      if (nextIsMobile !== lastIsMobile) {
        setIsSidebarCollapsed(nextIsMobile);
        lastIsMobile = nextIsMobile;
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    setShowModelBrowser(false);
  }, [activeTarget]);

  useEffect(() => {
    if (!settings.enabled && activeTarget !== 'general') {
      onTargetChange('general');
    }
  }, [activeTarget, onTargetChange, settings.enabled]);

  const resolvedSearchSettings = useMemo(() => resolveSearchSettings(settings), [settings]);
  const resolvedMemorySettings = useMemo(() => resolveMemorySettings(settings), [settings]);
  const searchOverrideEnabled = useMemo(() => hasSearchMemoryOverride(settings, 'search'), [settings]);
  const memoryOverrideEnabled = useMemo(() => hasSearchMemoryOverride(settings, 'memory'), [settings]);

  const updateSettings = (next: SearchMemorySettings) => {
    onChange(next);
  };

  const updateGeneral = (nextGeneral: SearchGeneralConfig) => {
    updateSettings({
      ...settings,
      general: nextGeneral,
    });
  };

  const updateSearchOverride = (nextSearch: SearchGeneralConfig) => {
    updateSettings({
      ...settings,
      overrides: {
        ...settings.overrides,
        search: nextSearch,
      },
    });
  };

  const updateMemoryOverride = (nextMemory: MemoryConfig) => {
    updateSettings({
      ...settings,
      overrides: {
        ...settings.overrides,
        memory: nextMemory,
      },
    });
  };

  const handleTargetSelect = (target: SearchMemoryConfigTarget) => {
    onTargetChange(target);
    if (isMobileViewport()) {
      setIsSidebarCollapsed(true);
    }
  };

  const handleOverrideToggle = (target: SearchMemoryTarget, enabled: boolean) => {
    const nextOverrides = { ...settings.overrides };
    if (enabled) {
      if (target === 'search') {
        nextOverrides.search = makeSearchOverrideSeed(settings);
      } else {
        nextOverrides.memory = makeMemoryOverrideSeed(settings);
      }
    } else {
      if (target === 'search') {
        delete nextOverrides.search;
      } else {
        delete nextOverrides.memory;
      }
    }
    updateSettings({
      ...settings,
      overrides: nextOverrides,
    });
  };

  const handleResetOverride = (target: SearchMemoryTarget) => {
    const nextOverrides = { ...settings.overrides };
    if (target === 'search') {
      delete nextOverrides.search;
    } else {
      delete nextOverrides.memory;
    }
    updateSettings({
      ...settings,
      overrides: nextOverrides,
    });
  };

  const openModelBrowser = (target: ModelBrowserTarget) => {
    setActiveModelBrowser(target);
    setShowModelBrowser((prev) => (activeModelBrowser === target ? !prev : true));
  };

  const renderEmbeddingFields = (
    target: ModelBrowserTarget,
    config: Pick<SearchGeneralConfig, 'embedding' | 'retrieval'> | MemoryConfig,
    onConfigChange: (next: typeof config) => void,
    options?: { includeKeyword?: boolean; keywordPageSize?: number; onKeywordPageSizeChange?: (value: number) => void; showIndexLanguage?: boolean; }
  ) => {
    const dimensions = config.embedding.dimensions;
    const isSearchLike = options?.includeKeyword ?? false;

    const handleProviderChange = (provider: EmbeddingProviderType) => {
      onConfigChange({
        ...config,
        embedding: {
          provider,
          model: '',
          dimensions: null,
        },
      });
    };

    const handleModelChange = (model: string) => {
      onConfigChange({
        ...config,
        embedding: {
          ...config.embedding,
          model,
          dimensions: null,
        },
      });
    };

    return (
      <>
        <div className="settings-panel-card">
          <div className="form-field">
            <label>{t('settings.searchMemory.fields.provider')}</label>
            <CustomSelect
              value={config.embedding.provider}
              onChange={(value) => handleProviderChange(value as EmbeddingProviderType)}
              options={providerOptions}
            />
            <p className="field-hint">{t('settings.searchMemory.fields.providerHint')}</p>
          </div>

          <div className="form-field">
            <label>{t('settings.searchMemory.fields.model')}</label>
            <div className="model-input-row">
              <input
                type="text"
                value={config.embedding.model}
                onChange={(event) => handleModelChange(event.target.value)}
                placeholder={t('settings.searchMemory.fields.modelPlaceholder')}
                className="config-input"
              />
              <TextButton
                variant={showModelBrowser && activeModelBrowser === target ? 'primary' : 'secondary'}
                size="sm"
                type="button"
                onClick={() => openModelBrowser(target)}
                title={t('settings.searchMemory.fields.browse')}
              >
                {showModelBrowser && activeModelBrowser === target ? t('common.hide') : t('common.browse')}
              </TextButton>
            </div>
            <p className="field-hint">
              {isSearchLike
                ? t('settings.searchMemory.fields.searchModelHint')
                : t('settings.searchMemory.fields.memoryModelHint')}
            </p>

            {showModelBrowser && activeModelBrowser === target && (
              <ModelBrowser
                key={`${target}:${config.embedding.provider}`}
                autoExpand={true}
                provider={config.embedding.provider}
                mode="embedding"
                currentModel={config.embedding.model}
                onSelectModel={(model) => {
                  handleModelChange(model);
                  setShowModelBrowser(false);
                }}
                onUpdateProviderPreference={() => {
                  // embedding configuration does not use provider preference
                }}
              />
            )}
          </div>

          {options?.showIndexLanguage && (
            <div className="form-field">
              <label>{t('settings.searchMemory.fields.indexLanguage')}</label>
              <input type="text" value={mainLanguage} disabled />
              <p className="field-hint">{t('settings.searchMemory.fields.indexLanguageHint')}</p>
            </div>
          )}

          <div className="form-field">
            <label>{t('settings.searchMemory.fields.dimensions')}</label>
            <input
              type="text"
              value={dimensions != null ? String(dimensions) : t('settings.searchMemory.fields.dimensionsUnknown')}
              disabled
            />
            <p className="field-hint">{t('settings.searchMemory.fields.dimensionsHint')}</p>
          </div>

          <div className="form-field">
            <label>{t('settings.searchMemory.fields.topKPerQuery')}</label>
            <NumberInput
              value={config.retrieval.topKPerQuery}
              min={1}
              max={200}
              onValueChange={(value) =>
                onConfigChange({
                  ...config,
                  retrieval: {
                    ...config.retrieval,
                    topKPerQuery: value ?? config.retrieval.topKPerQuery,
                  },
                })
              }
              className="config-input"
            />
            <p className="field-hint">{t('settings.searchMemory.fields.topKPerQueryHint')}</p>
          </div>

          <div className="form-field">
            <label>{t('settings.searchMemory.fields.neighborWindow')}</label>
            <NumberInput
              value={config.retrieval.neighborWindow}
              min={0}
              max={20}
              onValueChange={(value) =>
                onConfigChange({
                  ...config,
                  retrieval: {
                    ...config.retrieval,
                    neighborWindow: value ?? config.retrieval.neighborWindow,
                  },
                })
              }
              className="config-input"
            />
            <p className="field-hint">{t('settings.searchMemory.fields.neighborWindowHint')}</p>
          </div>

          <div className="form-field">
            <label>{t('settings.searchMemory.fields.maxPrimaryItems')}</label>
            <NumberInput
              value={config.retrieval.maxPrimaryItems}
              min={1}
              max={200}
              onValueChange={(value) => {
                const nextPrimary = value ?? config.retrieval.maxPrimaryItems;
                onConfigChange({
                  ...config,
                  retrieval: {
                    ...config.retrieval,
                    maxPrimaryItems: nextPrimary,
                    maxTotalItems: Math.max(config.retrieval.maxTotalItems, nextPrimary),
                  },
                });
              }}
              className="config-input"
            />
            <p className="field-hint">
              {isSearchLike
                ? t('settings.searchMemory.fields.maxPrimarySearchHint')
                : t('settings.searchMemory.fields.maxPrimaryMemoryHint')}
            </p>
          </div>

          <div className="form-field">
            <label>{t('settings.searchMemory.fields.maxTotalItems')}</label>
            <NumberInput
              value={config.retrieval.maxTotalItems}
              min={config.retrieval.maxPrimaryItems}
              max={500}
              onValueChange={(value) =>
                onConfigChange({
                  ...config,
                  retrieval: {
                    ...config.retrieval,
                    maxTotalItems: Math.max(value ?? config.retrieval.maxTotalItems, config.retrieval.maxPrimaryItems),
                  },
                })
              }
              className="config-input"
            />
            <p className="field-hint">
              {isSearchLike
                ? t('settings.searchMemory.fields.maxTotalSearchHint')
                : t('settings.searchMemory.fields.maxTotalMemoryHint')}
            </p>
          </div>

          {options?.includeKeyword && typeof options.keywordPageSize === 'number' && options.onKeywordPageSizeChange && (
            <div className="form-field">
              <label>{t('settings.searchMemory.fields.keywordPageSize')}</label>
              <NumberInput
                value={options.keywordPageSize}
                min={1}
                max={200}
                onValueChange={(value) => options.onKeywordPageSizeChange?.(value ?? options.keywordPageSize ?? 20)}
                className="config-input"
              />
              <p className="field-hint">{t('settings.searchMemory.fields.keywordPageSizeHint')}</p>
            </div>
          )}
        </div>
      </>
    );
  };

  const renderInheritedCard = (target: SearchMemoryTarget) => {
    const resolved = target === 'search' ? resolvedSearchSettings : resolvedMemorySettings;
    return (
      <div className="search-memory-panel__inherit-card">
        <div className="search-memory-panel__inherit-header">
          <h4>{t('settings.searchMemory.inheritedTitle')}</h4>
          <span className="search-memory-panel__inherit-badge">{t('settings.searchMemory.inheritedBadge')}</span>
        </div>
        <p className="search-memory-panel__hint">{t('settings.searchMemory.inheritedDescription')}</p>
        <dl className="search-memory-panel__summary-grid">
          <div>
            <dt>{t('settings.searchMemory.fields.provider')}</dt>
            <dd>{resolved.embedding.provider}</dd>
          </div>
          <div>
            <dt>{t('settings.searchMemory.fields.model')}</dt>
            <dd>{resolved.embedding.model || '-'}</dd>
          </div>
          <div>
            <dt>{t('settings.searchMemory.fields.topKPerQuery')}</dt>
            <dd>{resolved.retrieval.topKPerQuery}</dd>
          </div>
          <div>
            <dt>{t('settings.searchMemory.fields.neighborWindow')}</dt>
            <dd>{resolved.retrieval.neighborWindow}</dd>
          </div>
          <div>
            <dt>{t('settings.searchMemory.fields.maxPrimaryItems')}</dt>
            <dd>{resolved.retrieval.maxPrimaryItems}</dd>
          </div>
          <div>
            <dt>{t('settings.searchMemory.fields.maxTotalItems')}</dt>
            <dd>{resolved.retrieval.maxTotalItems}</dd>
          </div>
          {target === 'search' && (
            <div>
              <dt>{t('settings.searchMemory.fields.keywordPageSize')}</dt>
              <dd>{resolvedSearchSettings.keywordPageSize}</dd>
            </div>
          )}
        </dl>
      </div>
    );
  };

  return (
    <div className="search-memory-panel">
      <div className={`search-memory-panel__layout ${isSidebarCollapsed ? 'search-memory-panel__layout--collapsed' : ''}`}>
        {!isSidebarCollapsed && (
          <div
            className="search-memory-panel__backdrop"
            onClick={() => setIsSidebarCollapsed(true)}
          />
        )}

        <main className="search-memory-panel__main">
          <div className="search-memory-panel__content">
            <div className="search-memory-panel__header-row">
              <div className="panel-header">
                <h3>{t('settings.searchMemory.title')}</h3>
                <p className="panel-description">{t('settings.searchMemory.description')}</p>
              </div>
              <IconButton
                icon={isSidebarCollapsed ? <ChevronLeft size="lg" /> : <ChevronRight size="lg" />}
                onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                title={
                  isSidebarCollapsed
                    ? t('settings.promptEditor.expandSidebar')
                    : t('settings.promptEditor.collapseSidebar')
                }
                ariaExpanded={!isSidebarCollapsed}
                size="lg"
                variant="ghost"
                className="search-memory-panel__sidebar-toggle"
              />
            </div>

            <div className="search-memory-panel__body">
              {activeTarget === 'general' && (
                <>
                  <div className="task-description">
                    <div className="description-header">
                      <span className="description-icon">{TARGET_ICONS.general}</span>
                      <h3>{t('settings.searchMemory.targets.general.label')}</h3>
                    </div>
                    <p>{t('settings.searchMemory.targets.general.description')}</p>
                  </div>

                  <div className="settings-panel-card">
                    <div className="form-field">
                      <ToggleSwitch
                        checked={settings.enabled}
                        onChange={(enabled) => updateSettings({ ...settings, enabled })}
                        label={t('settings.searchMemory.enabledLabel')}
                        icon={<Toggle size="sm" />}
                      />
                      <p className="field-hint">{t('settings.searchMemory.enabledHint')}</p>
                    </div>
                  </div>

                  {!settings.enabled && (
                    <div className="search-memory-panel__runtime-card">
                      <div className="description-header">
                        <span className="description-icon"><Toggle size="sm" /></span>
                        <h3>{t('settings.searchMemory.disabledTitle')}</h3>
                      </div>
                      <p>{t('settings.searchMemory.disabledDescription')}</p>
                    </div>
                  )}

                  {settings.enabled && renderEmbeddingFields(
                    'general',
                    settings.general,
                    (next) => updateGeneral({ ...settings.general, ...next }),
                    {
                      includeKeyword: true,
                      keywordPageSize: settings.general.keywordPageSize,
                      onKeywordPageSizeChange: (keywordPageSize) =>
                        updateGeneral({ ...settings.general, keywordPageSize }),
                      showIndexLanguage: true,
                    }
                  )}
                </>
              )}

              {settings.enabled && activeTarget === 'search' && (
                <>
                  <div className="task-description">
                    <div className="description-header">
                      <span className="description-icon">{TARGET_ICONS.search}</span>
                      <h3>{t('settings.searchMemory.targets.search.label')}</h3>
                    </div>
                    <p>{t('settings.searchMemory.targets.search.description')}</p>
                  </div>

                  <div className="search-memory-panel__override-card">
                    <ToggleSwitch
                      checked={searchOverrideEnabled}
                      onChange={(checked) => handleOverrideToggle('search', checked)}
                      label={t('settings.searchMemory.overrideToggle')}
                    />
                    <p className="search-memory-panel__hint">{t('settings.searchMemory.overrideHint')}</p>
                  </div>

                  {!searchOverrideEnabled ? (
                    renderInheritedCard('search')
                  ) : (
                    <>
                      <div className="search-memory-panel__override-actions">
                        <p className="search-memory-panel__hint">{t('settings.searchMemory.overrideFormHint')}</p>
                        <TextButton
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => handleResetOverride('search')}
                        >
                          {t('settings.searchMemory.resetOverride')}
                        </TextButton>
                      </div>
                      {settings.overrides.search && renderEmbeddingFields(
                        'search',
                        settings.overrides.search,
                        (next) => updateSearchOverride({ ...(settings.overrides.search as SearchGeneralConfig), ...next }),
                        {
                          includeKeyword: true,
                          keywordPageSize: settings.overrides.search.keywordPageSize,
                          onKeywordPageSizeChange: (keywordPageSize) =>
                            updateSearchOverride({ ...(settings.overrides.search as SearchGeneralConfig), keywordPageSize }),
                          showIndexLanguage: true,
                        }
                      )}
                    </>
                  )}

                  <div className="search-memory-panel__info-box">
                    <h4>{t('settings.searchMemory.searchRulesTitle')}</h4>
                    <ul>
                      <li>{t('settings.searchMemory.searchRules.mainLanguageOnly')}</li>
                      <li>{t('settings.searchMemory.searchRules.excludesMarkdownAssets')}</li>
                      <li>{t('settings.searchMemory.searchRules.orderedResults')}</li>
                      <li>{t('settings.searchMemory.searchRules.reindexRequired')}</li>
                    </ul>
                  </div>
                </>
              )}

              {settings.enabled && activeTarget === 'memory' && (
                <>
                  <div className="task-description">
                    <div className="description-header">
                      <span className="description-icon">{TARGET_ICONS.memory}</span>
                      <h3>{t('settings.searchMemory.targets.memory.label')}</h3>
                    </div>
                    <p>{t('settings.searchMemory.targets.memory.description')}</p>
                  </div>

                  <div className="search-memory-panel__override-card">
                    <ToggleSwitch
                      checked={memoryOverrideEnabled}
                      onChange={(checked) => handleOverrideToggle('memory', checked)}
                      label={t('settings.searchMemory.overrideToggle')}
                    />
                    <p className="search-memory-panel__hint">{t('settings.searchMemory.overrideHint')}</p>
                  </div>

                  {!memoryOverrideEnabled ? (
                    renderInheritedCard('memory')
                  ) : (
                    <>
                      <div className="search-memory-panel__override-actions">
                        <p className="search-memory-panel__hint">{t('settings.searchMemory.overrideFormHint')}</p>
                        <TextButton
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => handleResetOverride('memory')}
                        >
                          {t('settings.searchMemory.resetOverride')}
                        </TextButton>
                      </div>
                      {settings.overrides.memory && renderEmbeddingFields(
                        'memory',
                        settings.overrides.memory,
                        (next) => updateMemoryOverride({ ...(settings.overrides.memory as MemoryConfig), ...next })
                      )}
                    </>
                  )}

                  <div className="search-memory-panel__info-box">
                    <h4>{t('settings.searchMemory.memoryRulesTitle')}</h4>
                    <p>{t('settings.searchMemory.memoryRules.description')}</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </main>

        <aside className="search-memory-panel__sidebar">
          <div className="search-memory-panel__sidebar-header">
            <h4>{t('settings.searchMemory.sidebarTitle')}</h4>
          </div>

          <div className="search-memory-panel__sidebar-section-label">
            {t('settings.searchMemory.baseSectionLabel')}
          </div>
          <ul className="search-memory-panel__sidebar-list">
            <li>
              <button
                className={`search-memory-panel__sidebar-item ${activeTarget === 'general' ? 'active' : ''}`}
                onClick={() => handleTargetSelect('general')}
              >
                <span className="search-memory-panel__sidebar-item-main">
                  <span className="search-memory-panel__sidebar-item-icon">{TARGET_ICONS.general}</span>
                  <span className="search-memory-panel__sidebar-item-label">{t('settings.searchMemory.targets.general.label')}</span>
                </span>
              </button>
            </li>
          </ul>

          {settings.enabled && (
            <>
              <div className="search-memory-panel__sidebar-section-label">
                {t('settings.searchMemory.targetsSectionLabel')}
              </div>
              <ul className="search-memory-panel__sidebar-list">
                <li>
                  <button
                    className={`search-memory-panel__sidebar-item ${activeTarget === 'search' ? 'active' : ''}`}
                    onClick={() => handleTargetSelect('search')}
                  >
                    <span className="search-memory-panel__sidebar-item-main">
                      <span className="search-memory-panel__sidebar-item-icon">{TARGET_ICONS.search}</span>
                      <span className="search-memory-panel__sidebar-item-label">{t('settings.searchMemory.targets.search.label')}</span>
                    </span>
                    <span className={`search-memory-panel__sidebar-status ${searchOverrideEnabled ? 'search-memory-panel__sidebar-status--override' : 'search-memory-panel__sidebar-status--inherited'}`}>
                      {searchOverrideEnabled ? t('settings.searchMemory.overrideBadge') : t('settings.searchMemory.inheritedShort')}
                    </span>
                  </button>
                </li>
                <li>
                  <button
                    className={`search-memory-panel__sidebar-item ${activeTarget === 'memory' ? 'active' : ''}`}
                    onClick={() => handleTargetSelect('memory')}
                  >
                    <span className="search-memory-panel__sidebar-item-main">
                      <span className="search-memory-panel__sidebar-item-icon">{TARGET_ICONS.memory}</span>
                      <span className="search-memory-panel__sidebar-item-label">{t('settings.searchMemory.targets.memory.label')}</span>
                    </span>
                    <span className={`search-memory-panel__sidebar-status ${memoryOverrideEnabled ? 'search-memory-panel__sidebar-status--override' : 'search-memory-panel__sidebar-status--inherited'}`}>
                      {memoryOverrideEnabled ? t('settings.searchMemory.overrideBadge') : t('settings.searchMemory.inheritedShort')}
                    </span>
                  </button>
                </li>
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  );
};

export default SearchMemoryPanel;
