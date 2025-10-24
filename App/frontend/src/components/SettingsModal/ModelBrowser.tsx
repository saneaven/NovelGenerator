import React, { useState } from 'react';
import type { AIFunctionType, ProviderType, ProviderPreference, ProviderCredentials } from '../../store/settingsStore';
import { fetchModels, fetchModelEndpoints } from '../../llm_request/llmService';

interface ModelBrowserProps {
  functionType: AIFunctionType;
  provider: ProviderType;
  currentModel: string;
  providerPreference?: ProviderPreference;
  credentials: ProviderCredentials;
  onSelectModel: (modelId: string) => void;
  onUpdateProviderPreference: (pref?: ProviderPreference) => void;
}

const ModelBrowser: React.FC<ModelBrowserProps> = ({
  functionType,
  provider,
  currentModel,
  providerPreference,
  credentials,
  onSelectModel,
  onUpdateProviderPreference,
}) => {
  const [showModels, setShowModels] = useState(false);
  const [modelsData, setModelsData] = useState<any>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [showUnsupportedModels, setShowUnsupportedModels] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());
  const [modelEndpoints, setModelEndpoints] = useState<Record<string, any>>({});
  const [loadingEndpoints, setLoadingEndpoints] = useState<Record<string, boolean>>({});

  const loadModels = async () => {
    setLoadingModels(true);
    setModelsError(null);

    try {
      const config: any = {};
      const providerCreds = credentials[provider];

      if ('apiKey' in providerCreds && providerCreds.apiKey) {
        config.apiKey = providerCreds.apiKey;
      }
      if ('baseUrl' in providerCreds && providerCreds.baseUrl) {
        config.baseUrl = providerCreds.baseUrl;
      }

      const data = await fetchModels(provider, config);
      setModelsData(data);
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : 'Failed to fetch models');
      console.error('Error fetching models:', error);
    } finally {
      setLoadingModels(false);
    }
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

  const toggleFamilyExpansion = (familyKey: string) => {
    setExpandedFamilies(prev => {
      const newSet = new Set(prev);
      if (newSet.has(familyKey)) {
        newSet.delete(familyKey);
      } else {
        newSet.add(familyKey);
      }
      return newSet;
    });
  };

  const loadModelEndpoints = async (modelId: string, canonicalSlug: string) => {
    if (provider !== 'openrouter' || modelEndpoints[modelId]) {
      return;
    }

    const apiKey = credentials.openrouter.apiKey;
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
    toggleSectionExpansion(sectionKey);

    if (!expandedSections.has(sectionKey)) {
      loadModelEndpoints(modelId, canonicalSlug);
    }
  };

  const toggleProviderOnly = (modelId: string, providerName: string) => {
    const currentPref = providerPreference || {};
    const currentOnly = currentPref.only || [];
    const currentIgnore = currentPref.ignore || [];

    let newOnly: string[];
    let newIgnore = currentIgnore;

    if (currentOnly.includes(providerName)) {
      newOnly = currentOnly.filter(p => p !== providerName);
    } else {
      newOnly = [...currentOnly, providerName];
      newIgnore = currentIgnore.filter(p => p !== providerName);
    }

    if (newOnly.length === 0 && newIgnore.length === 0) {
      onUpdateProviderPreference(undefined);
    } else {
      onUpdateProviderPreference({
        only: newOnly.length > 0 ? newOnly : undefined,
        ignore: newIgnore.length > 0 ? newIgnore : undefined
      });
    }
  };

  const toggleProviderIgnore = (modelId: string, providerName: string) => {
    const currentPref = providerPreference || {};
    const currentOnly = currentPref.only || [];
    const currentIgnore = currentPref.ignore || [];

    let newOnly = currentOnly;
    let newIgnore: string[];

    if (currentIgnore.includes(providerName)) {
      newIgnore = currentIgnore.filter(p => p !== providerName);
    } else {
      newIgnore = [...currentIgnore, providerName];
      newOnly = currentOnly.filter(p => p !== providerName);
    }

    if (newOnly.length === 0 && newIgnore.length === 0) {
      onUpdateProviderPreference(undefined);
    } else {
      onUpdateProviderPreference({
        only: newOnly.length > 0 ? newOnly : undefined,
        ignore: newIgnore.length > 0 ? newIgnore : undefined
      });
    }
  };

  const clearProviderPreference = () => {
    onUpdateProviderPreference(undefined);
  };

  const separateModelsBySupport = (models: any[]) => {
    if (provider === 'openrouter') {
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

      if (provider === 'openrouter') {
        const parts = model.id.split('/');
        if (parts.length > 1) {
          family = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        } else {
          family = 'Other';
        }
      } else {
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
    const MAX_DESC_LENGTH = 150;
    const isDescriptionLong = model.description && model.description.length > MAX_DESC_LENGTH;
    const isDescExpanded = expandedSections.has(`${model.id}-description`);

    return (
      <div key={model.id} className="model-item">
        <div className="model-top-bar">
          <div className="model-title-section">
            <h4 className="model-name">{model.name}</h4>
            <span className="model-id">{model.id}</span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onSelectModel(model.id);
            }}
            className="select-model-btn"
            title="Use this model"
          >
            <span className="btn-icon">✓</span>
            Use Model
          </button>
        </div>

        {model.description && (
          <div className="model-description-section">
            <p className="model-description">
              {parseMarkdownLinks(
                isDescriptionLong && !isDescExpanded
                  ? model.description.substring(0, MAX_DESC_LENGTH) + '...'
                  : model.description
              )}
            </p>
            {isDescriptionLong && (
              <button
                type="button"
                onClick={() => toggleSectionExpansion(`${model.id}-description`)}
                className="expand-description-btn"
              >
                {isDescExpanded ? '− Show less' : '+ Show more'}
              </button>
            )}
          </div>
        )}

        <div className="model-details-actions">
          {model.architecture && (
            <button
              type="button"
              onClick={() => toggleSectionExpansion(`${model.id}-architecture`)}
              className={`detail-btn ${expandedSections.has(`${model.id}-architecture`) ? 'active' : ''}`}
            >
              <span className="detail-icon">🏗</span>
              Architecture
            </button>
          )}
          {model.pricing && (
            <button
              type="button"
              onClick={() => toggleSectionExpansion(`${model.id}-pricing`)}
              className={`detail-btn ${expandedSections.has(`${model.id}-pricing`) ? 'active' : ''}`}
            >
              <span className="detail-icon">💰</span>
              Pricing
            </button>
          )}
          {model.canonical_slug && (
            <button
              type="button"
              onClick={() => handleProviderToggle(model.id, model.canonical_slug)}
              className={`detail-btn ${expandedSections.has(`${model.id}-provider`) ? 'active' : ''}`}
            >
              <span className="detail-icon">🌐</span>
              Providers
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
              {providerPreference && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    clearProviderPreference();
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
                  const pref = providerPreference;
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
                    const pref = providerPreference || {};
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
      <div className="model-top-bar">
        <div className="model-title-section">
          <div className="model-title-row">
            <h4 className="model-name">{model.name}</h4>
            {model.policy ? (
              <span className={`policy-status ${model.policy.state}`}>
                {model.policy.state === 'enabled' ? '✓' : '⚠'}
              </span>
            ) : (
              <span className="policy-status unsupported-badge">⚠</span>
            )}
            {model.version && <span className="model-version">v{model.version}</span>}
          </div>
          <span className="model-id">{model.id}</span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onSelectModel(model.id);
          }}
          className="select-model-btn"
          title="Use this model"
        >
          <span className="btn-icon">✓</span>
          Use Model
        </button>
      </div>

      {model.policy?.terms ? (
        <div className="model-policy">
          <p className="policy-terms">{parseMarkdownLinks(model.policy.terms)}</p>
        </div>
      ) : isUnsupported && (
        <div className="model-policy unsupported-warning">
          <p className="policy-terms">
            ⚠ This model is not officially supported or recommended. Use at your own discretion.
          </p>
        </div>
      )}

      <div className="model-details-actions">
        {model.capabilities?.supports && (
          <button
            type="button"
            onClick={() => toggleSectionExpansion(`${model.id}-supports`)}
            className={`detail-btn ${expandedSections.has(`${model.id}-supports`) ? 'active' : ''}`}
          >
            <span className="detail-icon">✨</span>
            Features
          </button>
        )}
        {model.capabilities?.limits && (
          <button
            type="button"
            onClick={() => toggleSectionExpansion(`${model.id}-limits`)}
            className={`detail-btn ${expandedSections.has(`${model.id}-limits`) ? 'active' : ''}`}
          >
            <span className="detail-icon">📊</span>
            Limits
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
    return provider === 'openrouter'
      ? renderOpenRouterModelItem(model)
      : renderCopilotModelItem(model, isUnsupported);
  };

  return (
    <div className="model-browser">
      <div className="model-browser-header">
        <button
          type="button"
          onClick={toggleModelsSection}
          className="models-toggle-btn"
        >
          {showModels ? '▲ Hide Available Models' : '▼ Browse Available Models'}
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
                {Object.entries(supportedGrouped).map(([family, models]) => {
                  const familyKey = `supported-${family}`;
                  const isExpanded = expandedFamilies.has(familyKey);
                  return (
                    <div key={family} className="model-family">
                      <div
                        className="family-header-container"
                        onClick={() => toggleFamilyExpansion(familyKey)}
                      >
                        <h4 className="family-header">{family} Family ({models.length})</h4>
                        <span className="family-toggle-icon">{isExpanded ? '▼' : '▶'}</span>
                      </div>
                      {isExpanded && (
                        <div className="family-models">
                          {models.map((model: any) => renderModelItem(model, false))}
                        </div>
                      )}
                    </div>
                  );
                })}

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
                        {Object.entries(unsupportedGrouped).map(([family, models]) => {
                          const familyKey = `unsupported-${family}`;
                          const isExpanded = expandedFamilies.has(familyKey);
                          return (
                            <div key={family} className="model-family unsupported-family">
                              <div
                                className="family-header-container"
                                onClick={() => toggleFamilyExpansion(familyKey)}
                              >
                                <h5 className="family-header unsupported-family-header">{family} Family ({models.length})</h5>
                                <span className="family-toggle-icon">{isExpanded ? '▼' : '▶'}</span>
                              </div>
                              {isExpanded && (
                                <div className="family-models">
                                  {models.map((model: any) => renderModelItem(model, true))}
                                </div>
                              )}
                            </div>
                          );
                        })}
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
  );
};

export default ModelBrowser;
