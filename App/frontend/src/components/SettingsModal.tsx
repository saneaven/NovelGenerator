import React, { useState, useEffect } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import type { Settings } from '../store/settingsStore';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const settingsStore = useSettingsStore();
  const [localSettings, setLocalSettings] = useState<Settings>(settingsStore.settings);
  const [modelsData, setModelsData] = useState<any>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [showModels, setShowModels] = useState(false);
  const [showUnsupportedModels, setShowUnsupportedModels] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settingsStore.settings);
      // Reset models section when modal opens
      setShowModels(false);
      setShowUnsupportedModels(false);
      setModelsData(null);
      setModelsError(null);
    }
  }, [isOpen, settingsStore.settings]);

  const fetchModels = async () => {
    setLoadingModels(true);
    setModelsError(null);
    
    try {
      const response = await fetch('http://localhost:8000/models');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
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

  const handleInputChange = (field: keyof Settings, value: string) => {
    setLocalSettings(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const separateModelsBySupport = (models: any[]) => {
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
      const family = model.capabilities?.family || 'Unknown';
      if (!grouped[family]) {
        grouped[family] = [];
      }
      grouped[family].push(model);
    });
    return grouped;
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

  const selectModel = (modelId: string) => {
    setLocalSettings(prev => ({
      ...prev,
      aiModel: modelId
    }));
  };

  const toggleModelsSection = () => {
    if (!showModels) {
      // Expanding for the first time, load models
      setShowModels(true);
      fetchModels();
    } else {
      // Collapsing
      setShowModels(false);
    }
  };

  const parseMarkdownLinks = (text: string) => {
    // Parse markdown-style links [text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = linkRegex.exec(text)) !== null) {
      // Add text before the link
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      
      // Add the link
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
    
    // Add remaining text after the last link
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }
    
    return parts.length > 0 ? parts : text;
  };

  const renderModelItem = (model: any, isUnsupported = false) => (
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
              <span className="policy-status unsupported-badge">
                ⚠
              </span>
            )}
          </div>
          <span className="model-id">ID: {model.id}</span>
          {model.version && <span className="model-version">v{model.version}</span>}
        </div>
        <button
          type="button"
          onClick={() => selectModel(model.id)}
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
            This model is not officially supported or recommended. Use at your own discretion as it may have limited functionality or reliability.
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

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>⚙️ Settings</h2>
          <button className="modal-close" onClick={handleCancel}>×</button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="settings-form">
          <div className="form-group">
            <label htmlFor="ai-model">AI Model</label>
            <input
              id="ai-model"
              type="text"
              value={localSettings.aiModel}
              onChange={(e) => handleInputChange('aiModel', e.target.value)}
              placeholder="e.g., gpt-3.5-turbo, gpt-4, claude-3-sonnet"
              required
            />
            <p className="form-help">
              Specify the AI model to use for generation. You can enter any model name supported by your backend.
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="output-language">Output Language</label>
            <input
              id="output-language"
              type="text"
              value={localSettings.outputLanguage}
              onChange={(e) => handleInputChange('outputLanguage', e.target.value)}
              placeholder="e.g., English, Korean, Japanese, Spanish"
              required
            />
            <p className="form-help">
              The AI will generate responses in this language. Enter the language name in English.
            </p>
          </div>

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
                {loadingModels && (
                  <p className="loading-text">Loading models...</p>
                )}
                {modelsError && (
                  <div className="error-text">
                    <p>Error loading models: {modelsError}</p>
                    <button 
                      type="button" 
                      onClick={fetchModels} 
                      className="retry-button"
                    >
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
                      {/* Supported Models */}
                      {Object.entries(supportedGrouped).map(([family, models]) => (
                        <div key={family} className="model-family">
                          <h4 className="family-header">{family} Family</h4>
                          {models.map((model: any) => renderModelItem(model, false))}
                        </div>
                      ))}
                      
                      {/* Unsupported Models Section */}
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
                                  <h5 className="family-header unsupported-family-header">{family} Family</h5>
                                  {models.map((model: any) => renderModelItem(model, true))}
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
            <p className="form-help">
              {showModels 
                ? "Available models from the GitHub Copilot API. Use the model ID in the AI Model field above."
                : "Click 'Show Available Models' to browse and select from available GitHub Copilot models."
              }
            </p>
          </div>

          <div className="form-actions">
            <button 
              type="button" 
              onClick={handleReset} 
              className="reset-button"
            >
              Reset to Defaults
            </button>
            <div className="action-buttons">
              <button 
                type="button" 
                onClick={handleCancel} 
                className="cancel-button"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="save-button"
              >
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