import React, { useState } from 'react';
import { type FunctionAIConfig, type ProviderType, type AIFunctionType, type ProviderCredentials } from '../store/settingsStore';
import { fetchModels } from '../llm/llmService';
import { TextButton } from './TextButton';
import { Expand, Collapse, ChevronUp, ChevronDown } from './icons';

interface FunctionMetadata {
    label: string;
    description: string;
    temperature: number;
    icon: string;
}

interface FunctionConfigPanelProps {
    functionType: AIFunctionType;
    metadata: FunctionMetadata;
    config: FunctionAIConfig;
    onConfigChange: (config: FunctionAIConfig) => void;
    providerCredentials: ProviderCredentials;
}

const FunctionConfigPanel: React.FC<FunctionConfigPanelProps> = ({
    metadata,
    config,
    onConfigChange,
    providerCredentials,
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [showModels, setShowModels] = useState(false);
    const [modelsData, setModelsData] = useState<any>(null);
    const [loadingModels, setLoadingModels] = useState(false);
    const [modelsError, setModelsError] = useState<string | null>(null);

    const getTemperatureLabel = (temp: number): string => {
        if (temp < 0.3) return 'Very deterministic, consistent outputs';
        if (temp < 0.7) return 'Balanced creativity and consistency';
        if (temp < 1.2) return 'Creative and varied outputs';
        return 'Highly creative, more random';
    };

    const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newProvider = e.target.value as ProviderType;
        onConfigChange({
            ...config,
            provider: newProvider,
            providerPreference: newProvider === 'openrouter' ? config.providerPreference : undefined,
        });
        setModelsData(null);
        setShowModels(false);
    };

    const loadModels = async () => {
        setLoadingModels(true);
        setModelsError(null);
        try {
            const providerConfig = providerCredentials[config.provider];
            const data = await fetchModels(config.provider, providerConfig);
            setModelsData(data);
        } catch (error) {
            setModelsError(error instanceof Error ? error.message : 'Failed to fetch models');
        } finally {
            setLoadingModels(false);
        }
    };

    const toggleModels = () => {
        if (!showModels) {
            setShowModels(true);
            if (!modelsData) {
                loadModels();
            }
        } else {
            setShowModels(false);
        }
    };

    const selectModel = (modelId: string) => {
        onConfigChange({ ...config, model: modelId });
    };

    return (
        <div className="function-config-panel">
            {/* Header */}
            <div className="panel-header" onClick={() => setIsExpanded(!isExpanded)}>
                <span className="icon">{metadata.icon}</span>
                <span className="label">{metadata.label}</span>
                <span className="model-badge">
                    {config.provider} / {config.model}
                </span>
                <span className="expand-icon">{isExpanded ? <Collapse size="xs" /> : <Expand size="xs" />}</span>
            </div>

            {/* Content (expandable) */}
            {isExpanded && (
                <div className="panel-content">
                    <p className="description">{metadata.description}</p>

                    {/* Provider Selection */}
                    <div className="form-group">
                        <label>Provider</label>
                        <select value={config.provider} onChange={handleProviderChange}>
                            <option value="openai">OpenAI</option>
                            <option value="gemini">Gemini</option>
                            <option value="claude">Claude</option>
                            <option value="openrouter">OpenRouter</option>
                            <option value="custom">Custom Endpoint</option>
                        </select>
                        <small className="help-text">
                            {config.provider === 'openai' && 'Direct OpenAI API access'}
                            {config.provider === 'gemini' && 'Google Gemini models'}
                            {config.provider === 'claude' && 'Anthropic Claude models'}
                            {config.provider === 'openrouter' && 'Access to 100+ models'}
                            {config.provider === 'custom' && 'Your own API endpoint'}
                        </small>
                    </div>

                    {/* Model Input */}
                    <div className="form-group">
                        <label>Model</label>
                        <input
                            type="text"
                            value={config.model}
                            onChange={(e) => onConfigChange({ ...config, model: e.target.value })}
                            placeholder={
                                config.provider === 'openrouter'
                                    ? 'e.g., anthropic/claude-3.5-sonnet'
                                    : 'e.g., gpt-4o'
                            }
                        />
                    </div>

                    {/* Temperature Control */}
                    <div className="form-group">
                        <label>
                            Temperature: <strong>{config.temperature.toFixed(1)}</strong>
                        </label>
                        <input
                            type="range"
                            min="0"
                            max="2"
                            step="0.1"
                            value={config.temperature}
                            onChange={(e) =>
                                onConfigChange({
                                    ...config,
                                    temperature: parseFloat(e.target.value),
                                })
                            }
                            className="temperature-slider"
                        />
                        <div className="temperature-labels">
                            <small>Precise (0.0)</small>
                            <small>Balanced (1.0)</small>
                            <small>Creative (2.0)</small>
                        </div>
                        <small className="help-text">{getTemperatureLabel(config.temperature)}</small>
                    </div>

                    {/* Browse Models - Simple List */}
                    <div className="form-group">
                        <TextButton
                            variant="ghost"
                            size="sm"
                            onClick={toggleModels}
                            iconLeft={showModels ? <ChevronUp size="xs" /> : undefined}
                            iconRight={!showModels ? <ChevronDown size="xs" /> : undefined}
                        >
                            {showModels ? 'Hide Models' : 'Show Available Models'}
                        </TextButton>

                        {showModels && (
                            <div className="models-section">
                                {loadingModels && <p className="loading-text">Loading models...</p>}
                                {modelsError && (
                                    <div className="error-text">
                                        <p>Error: {modelsError}</p>
                                        <TextButton variant="secondary" size="sm" onClick={loadModels}>
                                            Retry
                                        </TextButton>
                                    </div>
                                )}
                                {modelsData && !loadingModels && !modelsError && (
                                    <div className="models-list">
                                        {(modelsData.data || []).map((model: any) => (
                                            <div key={model.id} className="model-item-simple">
                                                <div className="model-info-simple">
                                                    <strong>{model.name || model.id}</strong>
                                                    <br />
                                                    <small>{model.id}</small>
                                                </div>
                                                <TextButton
                                                    variant="primary"
                                                    size="sm"
                                                    onClick={() => selectModel(model.id)}
                                                >
                                                    Use
                                                </TextButton>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default FunctionConfigPanel;
