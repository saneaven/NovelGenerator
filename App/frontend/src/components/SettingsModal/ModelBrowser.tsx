import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderType, ProviderPreference, RequestFormat } from '../../store/settingsStore';
import { fetchModels, fetchEmbeddingModels, fetchModelEndpoints } from '../../api/providerService';
import { TextButton } from '../TextButton';
import { CustomSelect } from '../ui/CustomSelect';
import { Check, Expand, Collapse } from '../icons';
import './ModelBrowser.css';

interface ModelBrowserProps {
  provider: ProviderType;
  request_format?: RequestFormat;
  mode?: 'chat' | 'embedding';
  currentModel: string;
  provider_preference?: ProviderPreference;
  onSelectModel: (modelId: string) => void;
  onUpdateProviderPreference: (pref?: ProviderPreference) => void;
  autoExpand?: boolean;
}

type SortOption = 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc';

// Tree node for hierarchical display
interface TreeNode {
  id: string;
  label: string;
  type: 'base' | 'version' | 'grade' | 'family' | 'model';
  children?: TreeNode[];
  model?: any;
}

// Parse Gemini model ID into components
const parseGeminiModelId = (id: string): { base: string; version: string; grade: string } | null => {
  // Match patterns like: gemini-2.5-flash, gemini-2.0-flash-thinking-exp, gemma-3-27b-it
  const geminiRegex = /^(gemini)-(\d+\.?\d*)-([a-z]+)/;
  const gemmaRegex = /^(gemma)-(\d+)/;

  const geminiMatch = id.match(geminiRegex);
  if (geminiMatch) {
    return {
      base: geminiMatch[1],
      version: geminiMatch[2],
      grade: geminiMatch[3]
    };
  }

  const gemmaMatch = id.match(gemmaRegex);
  if (gemmaMatch) {
    return {
      base: gemmaMatch[1],
      version: gemmaMatch[2],
      grade: ''  // Gemma doesn't have grade in the same way
    };
  }

  return null;
};

// Parse OpenAI model ID: gpt-{version}-{variant} or o{version}[-variant]
const parseOpenAIModelId = (id: string): { series: string; version: string } | null => {
  // GPT models: gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo
  const gptRegex = /^gpt-([\d.]+o?)/;
  const gptMatch = id.match(gptRegex);
  if (gptMatch) {
    return { series: 'GPT', version: gptMatch[1] };
  }

  // O-series: o1, o1-mini, o3, o3-pro, o4-mini
  const oRegex = /^(o\d+)/;
  const oMatch = id.match(oRegex);
  if (oMatch) {
    return { series: 'O-Series', version: oMatch[1] };
  }

  return null;
};

// Capitalize first letter
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// Build tree for OpenRouter (1-level: Family -> Models)
const buildOpenRouterTree = (models: any[]): TreeNode[] => {
  const familyMap: Record<string, TreeNode> = {};

  models.forEach(model => {
    const parts = model.id.split('/');
    const familyName = parts.length > 1 ? capitalize(parts[0]) : 'Other';

    if (!familyMap[familyName]) {
      familyMap[familyName] = {
        id: `family-${familyName}`,
        label: familyName,
        type: 'family',
        children: []
      };
    }

    familyMap[familyName].children!.push({
      id: model.id,
      label: model.display_name || model.name || model.id,
      type: 'model',
      model
    });
  });

  return Object.values(familyMap).sort((a, b) => a.label.localeCompare(b.label));
};

// Build tree for Gemini (4-level: Base -> Version -> Grade -> Models)
const buildGeminiTree = (models: any[]): TreeNode[] => {
  const geminiNode: TreeNode = { id: 'base-gemini', label: 'Gemini', type: 'base', children: [] };
  const gemmaNode: TreeNode = { id: 'base-gemma', label: 'Gemma', type: 'base', children: [] };
  const otherNode: TreeNode = { id: 'base-other', label: 'Other', type: 'base', children: [] };

  models.forEach(model => {
    const parts = parseGeminiModelId(model.id);

    if (!parts) {
      // Unparseable model goes to Other
      otherNode.children!.push({
        id: model.id,
        label: model.display_name || model.id,
        type: 'model',
        model
      });
      return;
    }

    if (parts.base === 'gemma') {
      // Gemma: flat list under Gemma folder
      gemmaNode.children!.push({
        id: model.id,
        label: model.display_name || model.id,
        type: 'model',
        model
      });
    } else {
      // Gemini: 4-level hierarchy
      let versionNode = geminiNode.children!.find(c => c.label === parts.version);
      if (!versionNode) {
        versionNode = {
          id: `version-${parts.version}`,
          label: parts.version,
          type: 'version',
          children: []
        };
        geminiNode.children!.push(versionNode);
      }

      let gradeNode = versionNode.children!.find(c => c.label === capitalize(parts.grade));
      if (!gradeNode) {
        gradeNode = {
          id: `grade-${parts.version}-${parts.grade}`,
          label: capitalize(parts.grade),
          type: 'grade',
          children: []
        };
        versionNode.children!.push(gradeNode);
      }

      gradeNode.children!.push({
        id: model.id,
        label: model.display_name || model.id,
        type: 'model',
        model
      });
    }
  });

  // Sort versions descending (2.5 > 2.0 > 1.5)
  geminiNode.children!.sort((a, b) => parseFloat(b.label) - parseFloat(a.label));

  // Sort grades by hierarchy (Pro > Flash > Nano)
  const gradeOrder: Record<string, number> = { 'Ultra': 4, 'Pro': 3, 'Flash': 2, 'Nano': 1 };
  geminiNode.children!.forEach(versionNode => {
    versionNode.children!.sort((a, b) => (gradeOrder[b.label] || 0) - (gradeOrder[a.label] || 0));
  });

  return [geminiNode, gemmaNode, otherNode].filter(n => n.children!.length > 0);
};

// Build tree for OpenAI (2-level: Series -> Version -> Models)
const buildOpenAITree = (models: any[]): TreeNode[] => {
  const gptNode: TreeNode = { id: 'series-gpt', label: 'GPT', type: 'base', children: [] };
  const oSeriesNode: TreeNode = { id: 'series-o', label: 'O-Series', type: 'base', children: [] };
  const otherNode: TreeNode = { id: 'series-other', label: 'Other', type: 'base', children: [] };

  models.forEach(model => {
    const parts = parseOpenAIModelId(model.id);

    if (!parts) {
      otherNode.children!.push({ id: model.id, label: model.id, type: 'model', model });
      return;
    }

    const parentNode = parts.series === 'GPT' ? gptNode : oSeriesNode;

    let versionNode = parentNode.children!.find(c => c.label === parts.version);
    if (!versionNode) {
      versionNode = {
        id: `version-${parts.series}-${parts.version}`,
        label: parts.version,
        type: 'version',
        children: []
      };
      parentNode.children!.push(versionNode);
    }

    versionNode.children!.push({ id: model.id, label: model.id, type: 'model', model });
  });

  // Sort GPT versions: 4o > 4.1 > 4 > 3.5
  gptNode.children!.sort((a, b) => {
    // Handle 'o' suffix specially (4o should come before 4)
    const aHasO = a.label.endsWith('o');
    const bHasO = b.label.endsWith('o');
    const aNum = parseFloat(a.label.replace('o', ''));
    const bNum = parseFloat(b.label.replace('o', ''));

    if (aNum !== bNum) return bNum - aNum;  // Descending by number
    if (aHasO && !bHasO) return -1;  // 'o' suffix comes first
    if (!aHasO && bHasO) return 1;
    return 0;
  });

  // Sort O-series versions: o4 > o3 > o1
  oSeriesNode.children!.sort((a, b) => {
    const numA = parseInt(a.label.replace('o', ''));
    const numB = parseInt(b.label.replace('o', ''));
    return numB - numA;  // Descending
  });

  return [gptNode, oSeriesNode, otherNode].filter(n => n.children!.length > 0);
};

const ModelBrowser: React.FC<ModelBrowserProps> = ({
  provider,
  request_format,
  mode = 'chat',
  currentModel,
  provider_preference,
  onSelectModel,
  onUpdateProviderPreference,
  autoExpand = false,
}) => {
  const { t } = useTranslation();
  const [modelsData, setModelsData] = useState<any>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  // Search and sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('name-asc');

  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());
  const [modelEndpoints, setModelEndpoints] = useState<Record<string, any>>({});
  const [loadingEndpoints, setLoadingEndpoints] = useState<Record<string, boolean>>({});

  // Auto-load models when auto-expanded
  useEffect(() => {
    if (autoExpand && !modelsData && !loadingModels) {
      loadModels();
    }
  }, [autoExpand]);

  const loadModels = async () => {
    setLoadingModels(true);
    setModelsError(null);

    try {
      const data = mode === 'embedding'
        ? await fetchEmbeddingModels(provider)
        : await fetchModels(provider, request_format);
      setModelsData(data);
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : 'Failed to fetch models');
      console.error('Error fetching models:', error);
    } finally {
      setLoadingModels(false);
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

  // Determine if provider should use tree grouping
  const shouldGroupByFamily = (): boolean => {
    if (mode === 'embedding') {
      return provider === 'openrouter';
    }
    return provider === 'openrouter' || provider === 'gemini' || provider === 'openai';
  };

  // Determine what details to show based on provider
  const getDetailsConfig = () => {
    if (provider === 'openrouter') {
      return {
        showArchitecture: true,
        showPricing: true,
        showEndpoints: mode === 'chat',
      };
    }
    return {
      showArchitecture: false,
      showPricing: false,
      showEndpoints: false,
    };
  };

  const loadModelEndpoints = async (modelId: string, canonicalSlug: string) => {
    if (mode !== 'chat' || provider !== 'openrouter' || modelEndpoints[modelId]) {
      return;
    }

    setLoadingEndpoints(prev => ({ ...prev, [modelId]: true }));

    try {
      const data = await fetchModelEndpoints(canonicalSlug);
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

  const toggleProviderOnly = (_modelId: string, providerName: string) => {
    const currentPref = provider_preference || {};
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

  const toggleProviderIgnore = (_modelId: string, providerName: string) => {
    const currentPref = provider_preference || {};
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

  // Get model display name
  const getModelDisplayName = (model: any): string => {
    return model.display_name || model.displayName || model.name || model.id;
  };

  // Filter and sort models
  const processedModels = useMemo(() => {
    if (!modelsData?.data) return [];

    let models = [...modelsData.data];

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      models = models.filter((model: any) => {
        const name = getModelDisplayName(model).toLowerCase();
        const id = (model.id || '').toLowerCase();
        return name.includes(query) || id.includes(query);
      });
    }

    // Sort models
    models.sort((a: any, b: any) => {
      switch (sortOption) {
        case 'name-asc':
          return getModelDisplayName(a).localeCompare(getModelDisplayName(b));
        case 'name-desc':
          return getModelDisplayName(b).localeCompare(getModelDisplayName(a));
        case 'price-asc':
          if (provider === 'openrouter') {
            const priceA = parseFloat(a.pricing?.prompt || '0');
            const priceB = parseFloat(b.pricing?.prompt || '0');
            return priceA - priceB;
          }
          return 0;
        case 'price-desc':
          if (provider === 'openrouter') {
            const priceA = parseFloat(a.pricing?.prompt || '0');
            const priceB = parseFloat(b.pricing?.prompt || '0');
            return priceB - priceA;
          }
          return 0;
        default:
          return 0;
      }
    });

    return models;
  }, [modelsData, searchQuery, sortOption, provider]);

  // Build model tree based on provider
  const modelTree = useMemo((): TreeNode[] | null => {
    if (!shouldGroupByFamily() || !processedModels.length) return null;

    if (provider === 'openrouter') {
      return buildOpenRouterTree(processedModels);
    }
    if (provider === 'gemini') {
      return buildGeminiTree(processedModels);
    }
    if (provider === 'openai') {
      return buildOpenAITree(processedModels);
    }
    return null;
  }, [processedModels, provider]);

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
          className="model-card__link"
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

  const renderModelCard = (model: any) => {
    const detailsConfig = getDetailsConfig();
    const isSelected = currentModel === model.id;
    const MAX_DESC_LENGTH = 150;
    const isDescriptionLong = model.description && model.description.length > MAX_DESC_LENGTH;
    const isDescExpanded = expandedSections.has(`${model.id}-description`);

    return (
      <div key={model.id} className={`model-card ${isSelected ? 'model-card--selected' : ''}`}>
        <div className="model-card__header">
          <div className="model-card__info">
            <h4 className="model-card__name">{getModelDisplayName(model)}</h4>
            <span className="model-card__id">{model.id}</span>
            {model.version && <span className="model-card__version">v{model.version}</span>}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onSelectModel(model.id);
            }}
            className={`model-card__select-btn ${isSelected ? 'model-card__select-btn--selected' : ''}`}
            title={isSelected ? t('settings.modelBrowser.currentlySelected') : t('settings.modelBrowser.useThisModel')}
          >
            {isSelected ? t('settings.modelBrowser.selected') : t('settings.modelBrowser.use')}
          </button>
        </div>

        {/* OpenRouter: Show pricing inline */}
        {provider === 'openrouter' && model.pricing && (
          <div className="model-card__pricing-inline">
            <span className="model-card__price">
              ${(parseFloat(model.pricing.prompt) * 1000000).toFixed(2)} / ${(parseFloat(model.pricing.completion) * 1000000).toFixed(2)} per 1M tokens
            </span>
          </div>
        )}

        {/* Description (OpenRouter only) */}
        {model.description && (
          <div className="model-card__description">
            <p>
              {parseMarkdownLinks(
                isDescriptionLong && !isDescExpanded
                  ? model.description.substring(0, MAX_DESC_LENGTH) + '...'
                  : model.description
              )}
            </p>
            {isDescriptionLong && (
              <TextButton
                variant="ghost"
                size="sm"
                onClick={() => toggleSectionExpansion(`${model.id}-description`)}
              >
                {isDescExpanded ? t('settings.modelBrowser.showLess') : t('settings.modelBrowser.showMore')}
              </TextButton>
            )}
          </div>
        )}

        {/* Detail buttons - Only for OpenRouter */}
        {(detailsConfig.showArchitecture || detailsConfig.showPricing || detailsConfig.showEndpoints) && (
          <div className="model-card__actions">
            {detailsConfig.showArchitecture && model.architecture && (
              <button
                type="button"
                onClick={() => toggleSectionExpansion(`${model.id}-architecture`)}
                className={`model-card__action-btn ${expandedSections.has(`${model.id}-architecture`) ? 'model-card__action-btn--active' : ''}`}
              >
                {t('settings.modelBrowser.architecture')}
              </button>
            )}
            {detailsConfig.showPricing && model.pricing && (
              <button
                type="button"
                onClick={() => toggleSectionExpansion(`${model.id}-pricing`)}
                className={`model-card__action-btn ${expandedSections.has(`${model.id}-pricing`) ? 'model-card__action-btn--active' : ''}`}
              >
                {t('settings.modelBrowser.pricingDetails')}
              </button>
            )}
            {detailsConfig.showEndpoints && model.canonical_slug && (
              <button
                type="button"
                onClick={() => handleProviderToggle(model.id, model.canonical_slug)}
                className={`model-card__action-btn ${expandedSections.has(`${model.id}-provider`) ? 'model-card__action-btn--active' : ''}`}
              >
                {t('settings.modelBrowser.providers')}
              </button>
            )}
          </div>
        )}

        {/* Expanded sections */}
        {expandedSections.has(`${model.id}-architecture`) && model.architecture && (
          <div className="model-card__details">
            <h5>{t('settings.modelBrowser.architecture')}</h5>
            <ul>
              <li>{t('settings.modelBrowser.input')}: {model.architecture.input_modalities?.join(', ')}</li>
              <li>{t('settings.modelBrowser.output')}: {model.architecture.output_modalities?.join(', ')}</li>
              <li>{t('settings.modelBrowser.tokenizer')}: {model.architecture.tokenizer}</li>
              {model.architecture.instruct_type && <li>{t('settings.modelBrowser.instruct')}: {model.architecture.instruct_type}</li>}
            </ul>
          </div>
        )}

        {expandedSections.has(`${model.id}-pricing`) && model.pricing && (
          <div className="model-card__details">
            <h5>{t('settings.modelBrowser.pricingPerMillion')}</h5>
            <ul>
              <li>{t('settings.modelBrowser.prompt')}: ${(parseFloat(model.pricing.prompt) * 1000000).toFixed(2)}</li>
              <li>{t('settings.modelBrowser.completion')}: ${(parseFloat(model.pricing.completion) * 1000000).toFixed(2)}</li>
              {parseFloat(model.pricing.image) > 0 && <li>{t('settings.modelBrowser.image')}: ${(parseFloat(model.pricing.image) * 1000000).toFixed(2)}</li>}
            </ul>
          </div>
        )}

        {expandedSections.has(`${model.id}-provider`) && (
          <div className="model-card__details">
            <div className="model-card__details-header">
              <h5>{t('settings.modelBrowser.availableProviders')}</h5>
              {provider_preference && (
                <TextButton
                  variant="ghost"
                  size="sm"
                  onClick={clearProviderPreference}
                >
                  {t('settings.modelBrowser.clearFilters')}
                </TextButton>
              )}
            </div>
            {loadingEndpoints[model.id] ? (
              <p className="model-card__loading">{t('settings.modelBrowser.loadingProviders')}</p>
            ) : modelEndpoints[model.id]?.data?.endpoints ? (
              <>
                {provider_preference && (provider_preference.only || provider_preference.ignore) && (
                  <div className="model-card__filters">
                    {provider_preference.only && (
                      <span className="model-card__filter model-card__filter--only">
                        {t('settings.modelBrowser.only')}: {provider_preference.only.join(', ')}
                      </span>
                    )}
                    {provider_preference.ignore && (
                      <span className="model-card__filter model-card__filter--ignore">
                        {t('settings.modelBrowser.ignore')}: {provider_preference.ignore.join(', ')}
                      </span>
                    )}
                  </div>
                )}
                <div className="model-card__endpoints">
                  {modelEndpoints[model.id].data.endpoints.map((endpoint: any, idx: number) => {
                    const pref = provider_preference || {};
                    const isInOnly = pref.only?.includes(endpoint.provider_name);
                    const isInIgnore = pref.ignore?.includes(endpoint.provider_name);

                    return (
                      <div key={idx} className="model-card__endpoint">
                        <div className="model-card__endpoint-header">
                          <span className="model-card__endpoint-name">{endpoint.provider_name}</span>
                          {endpoint.status && (
                            <span className={`model-card__endpoint-status model-card__endpoint-status--${endpoint.status}`}>
                              {endpoint.status}
                            </span>
                          )}
                          {endpoint.uptime_last_30m !== undefined && (
                            <span className="model-card__endpoint-uptime">
                              {(endpoint.uptime_last_30m * 100).toFixed(1)}%
                            </span>
                          )}
                        </div>
                        <div className="model-card__endpoint-info">
                          {endpoint.context_length && (
                            <span>Context: {endpoint.context_length?.toLocaleString()}</span>
                          )}
                          {endpoint.pricing && (
                            <span>
                              ${(parseFloat(endpoint.pricing.prompt) * 1000000).toFixed(2)} / ${(parseFloat(endpoint.pricing.completion) * 1000000).toFixed(2)}
                            </span>
                          )}
                        </div>
                        <div className="model-card__endpoint-actions">
                          <button
                            type="button"
                            onClick={() => toggleProviderOnly(model.id, endpoint.provider_name)}
                            className={`model-card__endpoint-btn ${isInOnly ? 'model-card__endpoint-btn--active' : ''}`}
                          >
                            {isInOnly ? <><Check size="xs" /> {t('settings.modelBrowser.only')}</> : t('settings.modelBrowser.only')}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleProviderIgnore(model.id, endpoint.provider_name)}
                            className={`model-card__endpoint-btn model-card__endpoint-btn--ignore ${isInIgnore ? 'model-card__endpoint-btn--active' : ''}`}
                          >
                            {isInIgnore ? <><Check size="xs" /> {t('settings.modelBrowser.ignore')}</> : t('settings.modelBrowser.ignore')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="model-card__error">{t('settings.modelBrowser.failedToLoadProviders')}</p>
            )}
          </div>
        )}
      </div>
    );
  };

  // Count total models in a tree node
  const countModels = (node: TreeNode): number => {
    if (node.type === 'model') return 1;
    return node.children?.reduce((sum, child) => sum + countModels(child), 0) || 0;
  };

  // Render a tree node recursively
  const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    if (node.type === 'model') {
      return (
        <div key={node.id} className={`model-tree__model model-tree__model--depth-${depth}`}>
          {renderModelCard(node.model)}
        </div>
      );
    }

    const isExpanded = expandedFamilies.has(node.id);
    const modelCount = countModels(node);

    return (
      <div key={node.id} className={`model-tree__node model-tree__node--${node.type} model-tree__node--depth-${depth}`}>
        <div
          className={`model-tree__header ${isExpanded ? 'model-tree__header--expanded' : ''}`}
          onClick={() => toggleFamilyExpansion(node.id)}
        >
          <span className="model-tree__toggle">{isExpanded ? <Collapse size="xs" /> : <Expand size="xs" />}</span>
          <span className="model-tree__label">{node.label}</span>
          <span className="model-tree__count">{`${modelCount} ${t('settings.modelBrowser.models')}`}</span>
        </div>
        {isExpanded && node.children && (
          <div className="model-tree__children">
            {node.children.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderModelList = () => {
    if (loadingModels) {
      return <div className="model-browser__loading">{t('settings.modelBrowser.loadingModels')}</div>;
    }

    if (modelsError) {
      return (
        <div className="model-browser__error">
          <p>{t('common.error')}: {modelsError}</p>
          <TextButton variant="secondary" size="sm" type="button" onClick={loadModels}>
            {t('settings.modelBrowser.retry')}
          </TextButton>
        </div>
      );
    }

    if (!modelsData?.data || processedModels.length === 0) {
      if (searchQuery) {
        return <div className="model-browser__empty">{t('settings.modelBrowser.noModelsFound', { query: searchQuery })}</div>;
      }
      return <div className="model-browser__empty">{t('settings.modelBrowser.noModelsAvailable')}</div>;
    }

    // Tree display (OpenRouter, Gemini)
    if (modelTree) {
      return (
        <div className="model-browser__list model-browser__list--tree">
          {modelTree.map(node => renderTreeNode(node, 0))}
        </div>
      );
    }

    // Flat list display (Claude, OpenAI, etc.)
    return (
      <div className="model-browser__list model-browser__list--flat">
        {processedModels.map((model: any) => renderModelCard(model))}
      </div>
    );
  };

  return (
    <div className="model-browser">

      {
        <div className="model-browser__content">
          {/* Toolbar: Search and Sort */}
          <div className="model-browser__toolbar">
            <input
              type="text"
              placeholder={t('settings.modelBrowser.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="model-browser__search"
            />
            <CustomSelect
              value={sortOption}
              onChange={(value) => setSortOption(value as SortOption)}
              options={[
                { value: 'name-asc', label: t('settings.modelBrowser.sortNameAsc') },
                { value: 'name-desc', label: t('settings.modelBrowser.sortNameDesc') },
                ...(provider === 'openrouter' ? [
                  { value: 'price-asc', label: t('settings.modelBrowser.sortPriceAsc') },
                  { value: 'price-desc', label: t('settings.modelBrowser.sortPriceDesc') },
                ] : []),
              ]}
            />
          </div>

          {renderModelList()}
        </div>
      }
    </div>
  );
};

export default ModelBrowser;
