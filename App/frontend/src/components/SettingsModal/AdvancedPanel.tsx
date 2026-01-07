import React, { useState } from 'react';
import type { RetryConfig } from '../../store/settingsStore';
import LLMLogViewer from './LLMLogViewer';
import ToggleSwitch from '../ToggleSwitch';
import { TextButton } from '../TextButton';
import { Refresh, Document } from '../icons';
import './AdvancedPanel.css';

interface AdvancedPanelProps {
    retryConfig: RetryConfig;
    onRetryConfigChange: (config: RetryConfig) => void;
    nativeOutputMode: boolean;
    onNativeOutputModeChange: (enabled: boolean) => void;
    functionCallHistoryLimit: number;
    onFunctionCallHistoryLimitChange: (limit: number) => void;
}

const AdvancedPanel: React.FC<AdvancedPanelProps> = ({
    retryConfig,
    onRetryConfigChange,
    nativeOutputMode,
    onNativeOutputModeChange,
    functionCallHistoryLimit,
    onFunctionCallHistoryLimitChange,
}) => {
    const [newErrorCode, setNewErrorCode] = useState('');

    const handleMaxRetriesChange = (value: number) => {
        onRetryConfigChange({
            ...retryConfig,
            maxRetries: Math.max(0, Math.min(10, value)),
        });
    };

    const handleDelayChange = (value: number) => {
        onRetryConfigChange({
            ...retryConfig,
            retryDelayMs: Math.max(100, Math.min(30000, value)),
        });
    };

    const handleRemoveErrorCode = (code: number) => {
        onRetryConfigChange({
            ...retryConfig,
            retryableStatusCodes: retryConfig.retryableStatusCodes.filter(c => c !== code),
        });
    };

    const handleAddErrorCode = () => {
        const code = parseInt(newErrorCode, 10);
        if (!isNaN(code) && code >= 100 && code <= 599) {
            if (!retryConfig.retryableStatusCodes.includes(code)) {
                onRetryConfigChange({
                    ...retryConfig,
                    retryableStatusCodes: [...retryConfig.retryableStatusCodes, code].sort((a, b) => a - b),
                });
            }
            setNewErrorCode('');
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddErrorCode();
        }
    };

    return (
        <div className="advanced-panel">
            <div className="panel-description">
                <p>
                    Configure error handling behavior for API requests. When enabled, failed requests
                    will be automatically retried based on the settings below.
                </p>
            </div>

            <div className="advanced-settings-card">
                <h3>Error Retry Configuration</h3>

                {/* Enable/Disable Toggle */}
                <div className="form-field">
                    <ToggleSwitch
                        checked={retryConfig.enabled}
                        onChange={(checked) => onRetryConfigChange({ ...retryConfig, enabled: checked })}
                        label="Enable automatic retry on errors"
                        icon={<Refresh size="sm" />}
                    />
                </div>

                {/* Max Retries Slider */}
                <div className={`form-field ${!retryConfig.enabled ? 'disabled' : ''}`}>
                    <label>Maximum Retries</label>
                    <div className="slider-container">
                        <input
                            type="range"
                            min="0"
                            max="10"
                            value={retryConfig.maxRetries}
                            onChange={(e) => handleMaxRetriesChange(parseInt(e.target.value, 10))}
                            disabled={!retryConfig.enabled}
                            className="slider"
                        />
                        <span className="slider-value">{retryConfig.maxRetries}</span>
                    </div>
                    <div className="slider-labels">
                        <span>0</span>
                        <span>10</span>
                    </div>
                </div>

                {/* Retry Delay */}
                <div className={`form-field ${!retryConfig.enabled ? 'disabled' : ''}`}>
                    <label>Retry Delay</label>
                    <div className="input-with-suffix">
                        <input
                            type="number"
                            min="100"
                            max="30000"
                            step="100"
                            value={retryConfig.retryDelayMs}
                            onChange={(e) => handleDelayChange(parseInt(e.target.value, 10))}
                            disabled={!retryConfig.enabled}
                            className="number-input"
                        />
                        <span className="input-suffix">ms</span>
                    </div>
                    <p className="field-hint">Time to wait between retry attempts (100-30000ms)</p>
                </div>

                {/* Error Codes */}
                <div className={`form-field ${!retryConfig.enabled ? 'disabled' : ''}`}>
                    <label>Retryable Error Codes</label>
                    <div className="error-codes-container">
                        {retryConfig.retryableStatusCodes.length === 0 ? (
                            <span className="no-codes-hint">No error codes configured</span>
                        ) : (
                            retryConfig.retryableStatusCodes.map(code => (
                                <div key={code} className="error-code-tag">
                                    <span className="error-code-value">{code}</span>
                                    <button
                                        type="button"
                                        className="error-code-remove"
                                        onClick={() => handleRemoveErrorCode(code)}
                                        disabled={!retryConfig.enabled}
                                        title="Remove"
                                    >
                                        ×
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                    <div className="add-error-code">
                        <input
                            type="number"
                            min="100"
                            max="599"
                            placeholder="Enter code"
                            value={newErrorCode}
                            onChange={(e) => setNewErrorCode(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={!retryConfig.enabled}
                            className="add-code-input"
                        />
                        <TextButton
                            variant="secondary"
                            size="sm"
                            type="button"
                            onClick={handleAddErrorCode}
                            disabled={!retryConfig.enabled || !newErrorCode}
                        >
                            + Add
                        </TextButton>
                    </div>
                </div>
            </div>

            <div className="advanced-info-box">
                <h4>Common Error Codes</h4>
                <ul>
                    <li><strong>429:</strong> Rate Limit - Too many requests</li>
                    <li><strong>500:</strong> Internal Server Error</li>
                    <li><strong>502:</strong> Bad Gateway</li>
                    <li><strong>503:</strong> Service Unavailable</li>
                    <li><strong>504:</strong> Gateway Timeout</li>
                </ul>
            </div>

            {/* Native Output Mode */}
            <div className="advanced-settings-card">
                <h3>Native Output Mode</h3>
                <div className="form-field">
                    <ToggleSwitch
                        checked={nativeOutputMode}
                        onChange={onNativeOutputModeChange}
                        label="Enable native output mode"
                        icon={<Document size="sm" />}
                    />
                    <p className="field-hint">
                        When enabled, non-agent AI features use a native output format. Edit/translation tasks emit
                        <code>&lt;function_calls&gt;</code> blocks (converted server-side into normal function calls),
                        while image prompt tasks output raw text.
                    </p>
                </div>
            </div>

            {/* Function Call History */}
            <div className="advanced-settings-card">
                <h3>Function Call History</h3>
                <div className="form-field">
                    <label>Include function calls in agent history</label>
                    <div className="slider-container">
                        <input
                            type="range"
                            min="0"
                            max="11"
                            value={functionCallHistoryLimit === -1 ? 11 : functionCallHistoryLimit}
                            onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                onFunctionCallHistoryLimitChange(val === 11 ? -1 : val);
                            }}
                            className="slider"
                        />
                        <span className="slider-value">
                            {functionCallHistoryLimit === -1 ? 'All' : functionCallHistoryLimit}
                        </span>
                    </div>
                    <div className="slider-labels">
                        <span>0</span>
                        <span>All</span>
                    </div>
                    <p className="field-hint">
                        Number of recent assistant messages whose function calls will be included
                        in the conversation history sent to the AI. Set to 0 to disable.
                    </p>
                </div>
            </div>

            {/* LLM Request Logging */}
            <div className="advanced-settings-card">
                <h3>LLM Request Logging</h3>
                <div className="panel-description">
                    <p>
                        Debug LLM requests and responses. Logs are stored in memory and cleared on page refresh.
                    </p>
                </div>
                <LLMLogViewer />
            </div>
        </div>
    );
};

export default AdvancedPanel;
