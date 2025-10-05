import React, { useState, useEffect } from 'react';
import { useSettingsStore, type Settings, type ProviderType } from '../store/settingsStore';
import { fetchModels, fetchProviders, fetchModelEndpoints } from '../llm_request/llmService';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ProviderInfo {
  name: string;
  display_name: string;
  description?: string;
  requires_api_key?: boolean;
  requires_base_url?: boolean;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const settingsStore = useSettingsStore();
  const [localSettings, setLocalSettings] = useState<Settings>(settingsStore.settings);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [modelsData, setModelsData] = useState<any>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [showModels, setShowModels] = useState(false);
  const [showUnsupportedModels, setShowUnsupportedModels] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [showProviderDropdown, setShowProviderDropdown] = useState(false);
  const [modelEndpoints, setModelEndpoints] = useState<Record<string, any>>({});
  const [loadingEndpoints, setLoadingEndpoints] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settingsStore.settings);
      setShowModels(false);
      setShowUnsupportedModels(false);
      setModelsData(null);
      setModelsError(null);
      setExpandedSections(new Set());
      loadProviders();
    }
  }, [isOpen]);

  const loadProviders = async () => {
    try {
      const data = await fetchProviders();
      setProviders(data.providers || []);
    } catch (error) {
      console.error('Failed to load providers:', error);
    }
  };

  const loadModels = async () => {
    setLoadingModels(true);
    setModelsError(null);

    try {
      const config = localSettings.providers[localSettings.activeProvider];
      const data = await fetchModels(localSettings.activeProvider, config);
      setModelsData(data);
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : 'Failed to fetch models');
      console.error('Error fetching models:', error);
    } finally {
      setLoadingModels(false);
    }
  };

  const handleSave = () => {
    settingsStore.updateSettings(localSettings);
    onClose();
  };

  const handleReset = () => {
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
      settingsStore.resetToDefaults();
      setLocalSettings(settingsStore.settings);
    }
  };

  const handleCancel = () => {
    setLocalSettings(settingsStore.settings);
    onClose();
  };

  const handleProviderChange = (provider: ProviderType) => {
    setLocalSettings(prev => ({
      ...prev,
      activeProvider: provider
    }));
    setModelsData(null);
    setShowModels(false);
    setShowProviderDropdown(false);
  };

  const getProviderIcon = (providerName: string) => {
    switch (providerName) {
      case 'copilot':
        return '🤖';
      case 'openrouter':
        return '🌐';
      case 'custom':
        return '⚙️';
      default:
        return '📡';
    }
  };

  const handleModelChange = (model: string) => {
    // Clear provider preferences when model changes
    if (localSettings.aiModel !== model && localSettings.activeProvider === 'openrouter') {
      settingsStore.clearProviderPreference(localSettings.aiModel);
    }

    setLocalSettings(prev => ({
      ...prev,
      aiModel: model
    }));
  };

  const handleProviderConfigChange = (field: string, value: string) => {
    setLocalSettings(prev => ({
      ...prev,
      providers: {
        ...prev.providers,
        [prev.activeProvider]: {
          ...prev.providers[prev.activeProvider],
          [field]: value
        }
      }
    }));
  };

  const toggleModelsSection = () => {
    if (!showModels) {
      setShowModels(true);
      loadModels();
    } else {
      setShowModels(false);
    }
  };

  const toggleSectionExpansion = (sectionKey: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sectionKey)) {
        newSet.delete(sectionKey);
      } else {
        newSet.add(sectionKey);
      }
      return newSet;
    });
  };

  const loadModelEndpoints = async (modelId: string, canonicalSlug: string) => {
    // Only fetch if OpenRouter and we don't already have the data
    if (localSettings.activeProvider !== 'openrouter' || modelEndpoints[modelId]) {
      return;
    }

    const apiKey = localSettings.providers.openrouter.apiKey;
    if (!apiKey) {
      console.error('OpenRouter API key not configured');
      return;
    }

    setLoadingEndpoints(prev => ({ ...prev, [modelId]: true }));

    try {
      const data = await fetchModelEndpoints(canonicalSlug, apiKey);
      setModelEndpoints(prev => ({ ...prev, [modelId]: data }));
    } catch (error) {
      console.error('Failed to fetch model endpoints:', error);
    } finally {
      setLoadingEndpoints(prev => ({ ...prev, [modelId]: false }));
    }
  };

  const handleProviderToggle = (modelId: string, canonicalSlug: string) => {
    const sectionKey = `${modelId}-provider`;

    // Toggle the section
    toggleSectionExpansion(sectionKey);

    // If expanding, fetch endpoints
    if (!expandedSections.has(sectionKey)) {
      loadModelEndpoints(modelId, canonicalSlug);
    }
  };

  const selectModel = (modelId: string) => {
    handleModelChange(modelId);
  };

  const toggleProviderOnly = (modelId: string, providerName: string) => {
    const currentPref = settingsStore.getProviderPreference(modelId) || {};
    const currentOnly = currentPref.only || [];
    const currentIgnore = currentPref.ignore || [];

    let newOnly: string[];
    let newIgnore = currentIgnore;

    if (currentOnly.includes(providerName)) {
      // Remove from only list
      newOnly = currentOnly.filter(p => p !== providerName);
    } else {
      // Add to only list and remove from ignore list if present
      newOnly = [...currentOnly, providerName];
      newIgnore = currentIgnore.filter(p => p !== providerName);
    }

    // If both arrays are empty, clear the entire preference
    if (newOnly.length === 0 && newIgnore.length === 0) {
      settingsStore.clearProviderPreference(modelId);
    } else {
      settingsStore.setProviderPreference(modelId, {
        only: newOnly.length > 0 ? newOnly : undefined,
        ignore: newIgnore.length > 0 ? newIgnore : undefined
      });
    }
  };

  const toggleProviderIgnore = (modelId: string, providerName: string) => {
    const currentPref = settingsStore.getProviderPreference(modelId) || {};
    const currentOnly = currentPref.only || [];
    const currentIgnore = currentPref.ignore || [];

    let newOnly = currentOnly;
    let newIgnore: string[];

    if (currentIgnore.includes(providerName)) {
      // Remove from ignore list
      newIgnore = currentIgnore.filter(p => p !== providerName);
    } else {
      // Add to ignore list and remove from only list if present
      newIgnore = [...currentIgnore, providerName];
      newOnly = currentOnly.filter(p => p !== providerName);
    }

    // If both arrays are empty, clear the entire preference
    if (newOnly.length === 0 && newIgnore.length === 0) {
      settingsStore.clearProviderPreference(modelId);
    } else {
      settingsStore.setProviderPreference(modelId, {
        only: newOnly.length > 0 ? newOnly : undefined,
        ignore: newIgnore.length > 0 ? newIgnore : undefined
      });
    }
  };

  const clearProviderPreference = (modelId: string) => {
    settingsStore.clearProviderPreference(modelId);
  };

  const separateModelsBySupport = (models: any[]) => {
    // For Copilot: check policy, for OpenRouter: all are supported
    if (localSettings.activeProvider === 'openrouter') {
      return { supported: models, unsupported: [] };
    }

    const supported: any[] = [];
    const unsupported: any[] = [];

    models.forEach(model => {
      if (model.policy) {
        supported.push(model);
      } else {
        unsupported.push(model);
      }
    });

    return { supported, unsupported };
  };

  const groupModelsByFamily = (models: any[]) => {
    const grouped: Record<string, any[]> = {};

    models.forEach(model => {
      let family = 'Unknown';

      if (localSettings.activeProvider === 'openrouter') {
        // Group by extracting provider/company from model ID
        // e.g., "openai/gpt-4" -> "openai", "anthropic/claude-3" -> "anthropic"
        const parts = model.id.split('/');
        if (parts.length > 1) {
          family = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        } else {
          family = 'Other';
        }
      } else {
        // For Copilot: use capabilities.family
        family = model.capabilities?.family || 'Unknown';
      }

      if (!grouped[family]) {
        grouped[family] = [];
      }
      grouped[family].push(model);
    });

    return grouped;
  };

  const parseMarkdownLinks = (text: string) => {
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = linkRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }

      parts.push(
        <a
          key={match.index}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="policy-link"
        >
          {match[1]}
        </a>
      );

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  };

  const renderOpenRouterModelItem = (model: any) => {
    const MAX_DESC_LENGTH = 100;
    const isDescriptionLong = model.description && model.description.length > MAX_DESC_LENGTH;
    const isDescExpanded = expandedSections.has(`${model.id}-description`);

    return (
      <div key={model.id} className="model-item">
        <div className="model-header">
          <div className="model-info">
            <div className="model-name-row">
              <span className="model-name">{model.name}</span>
            </div>
            <span className="model-id">ID: {model.id}</span>
            {model.description && (
              <div className="model-description-container">
                <span className="model-description">
                  {parseMarkdownLinks(
                    isDescriptionLong && !isDescExpanded
                      ? model.description.substring(0, MAX_DESC_LENGTH) + '...'
                      : model.description
                  )}
                </span>
                {isDescriptionLong && (
                  <button
                    type="button"
                    onClick={() => toggleSectionExpansion(`${model.id}-description`)}
                    className="expand-description-btn"
                  >
                    {isDescExpanded ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              selectModel(model.id);
            }}
            className="select-model-btn"
            title="Use this model"
          >
            Use
          </button>
        </div>

        <div className="model-actions">
          {model.architecture && (
            <button
              type="button"
              onClick={() => toggleSectionExpansion(`${model.id}-architecture`)}
              className="expand-btn"
            >
              Architecture {expandedSections.has(`${model.id}-architecture`) ? '▼' : '▶'}
            </button>
          )}
          {model.pricing && (
            <button
              type="button"
              onClick={() => toggleSectionExpansion(`${model.id}-pricing`)}
              className="expand-btn"
            >
              Pricing {expandedSections.has(`${model.id}-pricing`) ? '▼' : '▶'}
            </button>
          )}
          {model.canonical_slug && (
            <button
              type="button"
              onClick={() => handleProviderToggle(model.id, model.canonical_slug)}
              className="expand-btn"
            >
              Providers {expandedSections.has(`${model.id}-provider`) ? '▼' : '▶'}
            </button>
          )}
        </div>

        {expandedSections.has(`${model.id}-architecture`) && model.architecture && (
          <div className="expanded-section">
            <h5>Architecture:</h5>
            <ul>
              <li>Input Modalities: {model.architecture.input_modalities?.join(', ')}</li>
              <li>Output Modalities: {model.architecture.output_modalities?.join(', ')}</li>
              <li>Tokenizer: {model.architecture.tokenizer}</li>
              {model.architecture.instruct_type && <li>Instruct Type: {model.architecture.instruct_type}</li>}
            </ul>
          </div>
        )}

        {expandedSections.has(`${model.id}-pricing`) && model.pricing && (
          <div className="expanded-section">
            <h5>Pricing (per 1M tokens):</h5>
            <ul>
              <li>Prompt: ${(parseFloat(model.pricing.prompt) * 1000000).toFixed(2)}</li>
              <li>Completion: ${(parseFloat(model.pricing.completion) * 1000000).toFixed(2)}</li>
              {parseFloat(model.pricing.image) > 0 && <li>Image: ${(parseFloat(model.pricing.image) * 1000000).toFixed(2)}</li>}
            </ul>
          </div>
        )}

        {expandedSections.has(`${model.id}-provider`) && (
          <div className="expanded-section">
            <div className="provider-header-row">
              <h5>Available Providers/Endpoints:</h5>
              {settingsStore.getProviderPreference(model.id) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    clearProviderPreference(model.id);
                  }}
                  className="clear-preference-btn"
                  title="Clear provider preferences"
                >
                  Clear Filters
                </button>
              )}
            </div>
            {loadingEndpoints[model.id] ? (
              <p className="loading-text">Loading provider information...</p>
            ) : modelEndpoints[model.id]?.data?.endpoints ? (
              <>
                {(() => {
                  const pref = settingsStore.getProviderPreference(model.id);
                  if (pref && (pref.only || pref.ignore)) {
                    return (
                      <div className="provider-preference-display">
                        {pref.only && (
                          <div className="preference-tag only">
                            Only: {pref.only.join(', ')}
                          </div>
                        )}
                        {pref.ignore && (
                          <div className="preference-tag ignore">
                            Ignore: {pref.ignore.join(', ')}
                          </div>
                        )}
                      </div>
                    );
                  }
                  return null;
                })()}
                <div className="endpoints-list">
                  {modelEndpoints[model.id].data.endpoints.map((endpoint: any, idx: number) => {
                    const pref = settingsStore.getProviderPreference(model.id) || {};
                    const isInOnly = pref.only?.includes(endpoint.provider_name);
                    const isInIgnore = pref.ignore?.includes(endpoint.provider_name);

                    return (
                      <div key={idx} className="endpoint-item">
                        <div className="endpoint-header">
                          <span className="endpoint-provider">{endpoint.provider_name}</span>
                          {endpoint.status && (
                            <span className={`endpoint-status ${endpoint.status}`}>
                              {endpoint.status}
                            </span>
                          )}
                          {endpoint.uptime_last_30m !== undefined && (
                            <span className="endpoint-uptime">
                              {(endpoint.uptime_last_30m * 100).toFixed(1)}% uptime
                            </span>
                          )}
                        </div>
                        <div className="endpoint-details">
                          {endpoint.context_length && (
                            <span className="endpoint-detail">
                              Context: {endpoint.context_length?.toLocaleString()} tokens
                            </span>
                          )}
                          {endpoint.pricing && (
                            <span className="endpoint-detail">
                              Pricing: ${(parseFloat(endpoint.pricing.prompt) * 1000000).toFixed(2)} / ${(parseFloat(endpoint.pricing.completion) * 1000000).toFixed(2)} per 1M
                            </span>
                          )}
                        </div>
                        {endpoint.supported_parameters && endpoint.supported_parameters.length > 0 && (
                          <div className="endpoint-params">
                            <small>Params: {endpoint.supported_parameters.join(', ')}</small>
                          </div>
                        )}
                        <div className="endpoint-actions">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              toggleProviderOnly(model.id, endpoint.provider_name);
                            }}
                            className={`provider-filter-btn ${isInOnly ? 'active-only' : ''}`}
                            title="Only use this provider"
                          >
                            {isInOnly ? '✓ Only' : 'Only'}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              toggleProviderIgnore(model.id, endpoint.provider_name);
                            }}
                            className={`provider-filter-btn ${isInIgnore ? 'active-ignore' : ''}`}
                            title="Ignore this provider"
                          >
                            {isInIgnore ? '✓ Ignore' : 'Ignore'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="error-text">Failed to load provider information</p>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderCopilotModelItem = (model: any, isUnsupported = false) => (
    <div key={model.id} className={`model-item ${isUnsupported ? 'unsupported' : ''}`}>
      <div className="model-header">
        <div className="model-info">
          <div className="model-name-row">
            <span className="model-name">{model.name}</span>
            {model.policy ? (
              <span className={`policy-status ${model.policy.state}`}>
                {model.policy.state === 'enabled' ? '✓' : '⚠'}
              </span>
            ) : (
              <span className="policy-status unsupported-badge">⚠</span>
            )}
          </div>
          <span className="model-id">ID: {model.id}</span>
          {model.version && <span className="model-version">v{model.version}</span>}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            selectModel(model.id);
          }}
          className="select-model-btn"
          title="Use this model"
        >
          Use
        </button>
      </div>

      {model.policy?.terms ? (
        <div className="model-policy">
          <p className="policy-terms">{parseMarkdownLinks(model.policy.terms)}</p>
        </div>
      ) : isUnsupported && (
        <div className="model-policy unsupported-warning">
          <p className="policy-terms">
            This model is not officially supported or recommended. Use at your own discretion.
          </p>
        </div>
      )}

      <div className="model-actions">
        {model.capabilities?.supports && (
          <button
            type="button"
            onClick={() => toggleSectionExpansion(`${model.id}-supports`)}
            className="expand-btn"
          >
            Supports {expandedSections.has(`${model.id}-supports`) ? '▼' : '▶'}
          </button>
        )}
        {model.capabilities?.limits && (
          <button
            type="button"
            onClick={() => toggleSectionExpansion(`${model.id}-limits`)}
            className="expand-btn"
          >
            Limits {expandedSections.has(`${model.id}-limits`) ? '▼' : '▶'}
          </button>
        )}
      </div>

      {expandedSections.has(`${model.id}-supports`) && model.capabilities?.supports && (
        <div className="expanded-section">
          <h5>Supported Features:</h5>
          <ul>
            {Object.entries(model.capabilities.supports).map(([feature, supported]) => (
              <li key={feature} className={supported ? 'supported' : 'not-supported'}>
                {feature}: {supported ? '✓' : '✗'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {expandedSections.has(`${model.id}-limits`) && model.capabilities?.limits && (
        <div className="expanded-section">
          <h5>Model Limits:</h5>
          <ul>
            <li>Max Context Window: {model.capabilities.limits.max_context_window_tokens?.toLocaleString()} tokens</li>
            <li>Max Output: {model.capabilities.limits.max_output_tokens?.toLocaleString()} tokens</li>
            <li>Max Prompt: {model.capabilities.limits.max_prompt_tokens?.toLocaleString()} tokens</li>
            {model.capabilities.limits.vision && (
              <>
                <li>Max Image Size: {(model.capabilities.limits.vision.max_prompt_image_size / 1024 / 1024).toFixed(1)} MB</li>
                <li>Max Images: {model.capabilities.limits.vision.max_prompt_images}</li>
                <li>Supported Media: {model.capabilities.limits.vision.supported_media_types?.join(', ')}</li>
              </>
            )}
          </ul>
        </div>
      )}
    </div>
  );

  const renderModelItem = (model: any, isUnsupported = false) => {
    // Determine which renderer to use based on provider
    if (localSettings.activeProvider === 'openrouter') {
      return renderOpenRouterModelItem(model);
    } else {
      return renderCopilotModelItem(model, isUnsupported);
    }
  };

  if (!isOpen) return null;

  const currentProvider = providers.find(p => p.name === localSettings.activeProvider);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>⚙️ Settings</h2>
          <button className="modal-close" onClick={handleCancel}>×</button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="settings-form">
          {/* Provider Selection - Custom Dropdown */}
          <div className="form-group">
            <label htmlFor="provider">API Provider</label>
            <div className="custom-select-container">
              <div
                className="custom-select-trigger"
                onClick={() => setShowProviderDropdown(!showProviderDropdown)}
              >
                <div className="selected-provider">
                  <span className="provider-icon">{getProviderIcon(localSettings.activeProvider)}</span>
                  <span className="provider-name">{currentProvider?.display_name || 'Select Provider'}</span>
                </div>
                <span className="dropdown-arrow">{showProviderDropdown ? '▲' : '▼'}</span>
              </div>

              {showProviderDropdown && (
                <div className="custom-select-dropdown">
                  {providers.map(provider => (
                    <div
                      key={provider.name}
                      className={`custom-select-option ${provider.name === localSettings.activeProvider ? 'selected' : ''}`}
                      onClick={() => handleProviderChange(provider.name as ProviderType)}
                    >
                      <div className="option-content">
                        <span className="provider-icon">{getProviderIcon(provider.name)}</span>
                        <div className="provider-details">
                          <span className="provider-name">{provider.display_name}</span>
                          {provider.description && (
                            <span className="provider-description">{provider.description}</span>
                          )}
                        </div>
                      </div>
                      {provider.name === localSettings.activeProvider && (
                        <span className="check-icon">✓</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {currentProvider?.description && (
              <p className="form-help">{currentProvider.description}</p>
            )}
          </div>

          {/* Provider-Specific Configuration */}
          {localSettings.activeProvider === 'copilot' && (
            <div className="provider-config-section">
              <p className="form-help">
                ✓ GitHub Copilot uses server-side authentication. No additional configuration needed.
              </p>
            </div>
          )}

          {localSettings.activeProvider === 'openrouter' && (
            <div className="provider-config-section">
              <div className="form-group">
                <label htmlFor="openrouter-api-key">🔑 OpenRouter API Key</label>
                <input
                  id="openrouter-api-key"
                  type="password"
                  value={localSettings.providers.openrouter.apiKey}
                  onChange={(e) => handleProviderConfigChange('apiKey', e.target.value)}
                  placeholder="sk-or-v1-..."
                  required
                />
                <p className="form-help">
                  Get your API key from{' '}
                  <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
                    openrouter.ai/keys
                  </a>
                </p>
              </div>
            </div>
          )}

          {localSettings.activeProvider === 'custom' && (
            <div className="provider-config-section">
              <div className="form-group">
                <label htmlFor="custom-base-url">🌐 Base URL</label>
                <input
                  id="custom-base-url"
                  type="url"
                  value={localSettings.providers.custom.baseUrl}
                  onChange={(e) => handleProviderConfigChange('baseUrl', e.target.value)}
                  placeholder="https://api.example.com/v1"
                  required
                />
                <p className="form-help">
                  OpenAI-compatible API endpoint (e.g., https://api.openai.com/v1)
                </p>
              </div>

              <div className="form-group">
                <label htmlFor="custom-api-key">🔑 API Key (Optional)</label>
                <input
                  id="custom-api-key"
                  type="password"
                  value={localSettings.providers.custom.apiKey || ''}
                  onChange={(e) => handleProviderConfigChange('apiKey', e.target.value)}
                  placeholder="sk-..."
                />
                <p className="form-help">
                  API key for authentication (leave empty if not required)
                </p>
              </div>
            </div>
          )}

          {/* Model Selection */}
          <div className="form-group">
            <label htmlFor="ai-model">AI Model</label>
            <input
              id="ai-model"
              type="text"
              value={localSettings.aiModel}
              onChange={(e) => handleModelChange(e.target.value)}
              placeholder="e.g., gpt-4, claude-3-sonnet"
              required
            />
            <p className="form-help">
              Model identifier for the selected provider
            </p>
          </div>

          {/* Available Models */}
          <div className="form-group">
            <div className="models-section-header">
              <label>Available Models</label>
              <button
                type="button"
                onClick={toggleModelsSection}
                className="models-expand-btn"
              >
                {showModels ? 'Hide Models ▲' : 'Show Available Models ▼'}
              </button>
            </div>

            {showModels && (
              <div className="models-section">
                {loadingModels && <p className="loading-text">Loading models...</p>}
                {modelsError && (
                  <div className="error-text">
                    <p>Error: {modelsError}</p>
                    <button type="button" onClick={loadModels} className="retry-button">
                      Retry
                    </button>
                  </div>
                )}
                {modelsData && !loadingModels && !modelsError && (() => {
                  const { supported, unsupported } = separateModelsBySupport(modelsData.data || []);
                  const supportedGrouped = groupModelsByFamily(supported);
                  const unsupportedGrouped = groupModelsByFamily(unsupported);

                  return (
                    <div className="models-display">
                      {Object.entries(supportedGrouped).map(([family, models]) => (
                        <div key={family} className="model-family">
                          <div className="family-header-container">
                            <h4 className="family-header">{family} Family</h4>
                            <button
                              type="button"
                              onClick={() => toggleSectionExpansion(`family-${family}`)}
                              className="family-toggle-btn"
                            >
                              {expandedSections.has(`family-${family}`) ? '▼' : '▶'}
                            </button>
                          </div>
                          {expandedSections.has(`family-${family}`) && (
                            <div className="family-models">
                              {models.map((model: any) => renderModelItem(model, false))}
                            </div>
                          )}
                        </div>
                      ))}

                      {Object.keys(unsupportedGrouped).length > 0 && (
                        <div className="unsupported-models-section">
                          <div className="unsupported-header">
                            <h4 className="family-header unsupported-title">
                              Unrecommended/Unsupported Models
                            </h4>
                            <button
                              type="button"
                              onClick={() => setShowUnsupportedModels(!showUnsupportedModels)}
                              className="unsupported-view-btn"
                            >
                              {showUnsupportedModels ? 'Hide ▲' : 'View ▼'}
                            </button>
                          </div>

                          {showUnsupportedModels && (
                            <div className="unsupported-models-content">
                              {Object.entries(unsupportedGrouped).map(([family, models]) => (
                                <div key={family} className="model-family unsupported-family">
                                  <div className="family-header-container">
                                    <h5 className="family-header unsupported-family-header">{family} Family</h5>
                                    <button
                                      type="button"
                                      onClick={() => toggleSectionExpansion(`family-unsupported-${family}`)}
                                      className="family-toggle-btn"
                                    >
                                      {expandedSections.has(`family-unsupported-${family}`) ? '▼' : '▶'}
                                    </button>
                                  </div>
                                  {expandedSections.has(`family-unsupported-${family}`) && (
                                    <div className="family-models">
                                      {models.map((model: any) => renderModelItem(model, true))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Language Settings */}
          <div className="form-group">
            <label htmlFor="primary-language">Primary Language</label>
            <input
              id="primary-language"
              type="text"
              value={localSettings.primaryLanguage}
              onChange={(e) => setLocalSettings(prev => ({
                ...prev,
                primaryLanguage: e.target.value
              }))}
              placeholder="e.g., English, Korean, Japanese"
              required
            />
            <p className="form-help">
              AI will generate responses in this language
            </p>
          </div>

          {/* Form Actions */}
          <div className="form-actions">
            <button type="button" onClick={handleReset} className="reset-button">
              Reset to Defaults
            </button>
            <div className="action-buttons">
              <button type="button" onClick={handleCancel} className="cancel-button">
                Cancel
              </button>
              <button type="submit" className="save-button">
                Save Settings
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SettingsModal;
