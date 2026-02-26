import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RetryConfig, ToolCallAutoApproveConfig } from '../../store/settingsStore';

import ToggleSwitch from '../common/ToggleSwitch';
import { TextButton } from '../TextButton';
import { NumberInput } from '../ui/NumberInput';
import { Refresh, Document } from '../icons';
import './AdvancedPanel.css';

interface AdvancedPanelProps {
    retryConfig: RetryConfig;
    onRetryConfigChange: (config: RetryConfig) => void;
    nativeOutputMode: boolean;
    onNativeOutputModeChange: (enabled: boolean) => void;
    toolCallHistoryLimit: number;
    onToolCallHistoryLimitChange: (limit: number) => void;
    thinkingHistoryLimit: number;
    onThinkingHistoryLimitChange: (limit: number) => void;
    toolCallAutoApprove: ToolCallAutoApproveConfig;
    onToolCallAutoApproveChange: (config: ToolCallAutoApproveConfig) => void;
}

const AdvancedPanel: React.FC<AdvancedPanelProps> = ({
    retryConfig,
    onRetryConfigChange,
    nativeOutputMode,
    onNativeOutputModeChange,
    toolCallHistoryLimit,
    onToolCallHistoryLimitChange,
    thinkingHistoryLimit,
    onThinkingHistoryLimitChange,
    toolCallAutoApprove,
    onToolCallAutoApproveChange,
}) => {
    const [newErrorCode, setNewErrorCode] = useState('');

    const handleMaxRetriesChange = (value: number) => {
        onRetryConfigChange({
            ...retryConfig,
            maxRetries: Math.max(0, Math.min(10, value)),
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

    const { t } = useTranslation();

    return (
        <div className="advanced-panel">
            <div className="panel-header">
                <h3>{t('settings.advanced.title')}</h3>
                <p className="panel-description">{t('settings.advanced.description')}</p>
            </div>

            <div className="settings-panel-card">
                <h3>{t('settings.advanced.errorRetry.title')}</h3>

                {/* Enable/Disable Toggle */}
                <div className="form-field">
                    <ToggleSwitch
                        checked={retryConfig.enabled}
                        onChange={(checked) => onRetryConfigChange({ ...retryConfig, enabled: checked })}
                        label={t('settings.advanced.errorRetry.enableAutoRetry')}
                        icon={<Refresh size="sm" />}
                    />
                </div>

                {/* Max Retries Slider */}
                <div className={`form-field ${!retryConfig.enabled ? 'disabled' : ''}`}>
                    <label>{t('settings.advanced.errorRetry.maxRetries')}</label>
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
                    <label>{t('settings.advanced.errorRetry.retryDelay')}</label>
                    <div className="input-with-suffix">
                        <NumberInput
                            min={100}
                            max={30000}
                            step={100}
                            value={retryConfig.retryDelayMs}
                            onValueChange={(v) => onRetryConfigChange({
                                ...retryConfig,
                                retryDelayMs: v!,
                            })}
                            disabled={!retryConfig.enabled}
                            className="number-input"
                        />
                        <span className="input-suffix">ms</span>
                    </div>
                    <p className="field-hint">{t('settings.advanced.errorRetry.retryDelayHint')}</p>
                </div>

                {/* Error Codes */}
                <div className={`form-field ${!retryConfig.enabled ? 'disabled' : ''}`}>
                    <label>{t('settings.advanced.errorRetry.retryableErrorCodes')}</label>
                    <div className="error-codes-container">
                        {retryConfig.retryableStatusCodes.length === 0 ? (
                            <span className="no-codes-hint">{t('settings.advanced.errorRetry.noErrorCodes')}</span>
                        ) : (
                            retryConfig.retryableStatusCodes.map(code => (
                                <div key={code} className="error-code-tag">
                                    <span className="error-code-value">{code}</span>
                                    <button
                                        type="button"
                                        className="error-code-remove"
                                        onClick={() => handleRemoveErrorCode(code)}
                                        disabled={!retryConfig.enabled}
                                        title={t('settings.advanced.errorRetry.remove')}
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
                            placeholder={t('settings.advanced.errorRetry.enterCode')}
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
                            + {t('common.add')}
                        </TextButton>
                    </div>
                </div>
            </div>

            <div className="info-box">
                <h4>{t('settings.advanced.commonErrorCodes.title')}</h4>
                <ul>
                    <li><strong>429:</strong> {t('settings.advanced.commonErrorCodes.429')}</li>
                    <li><strong>500:</strong> {t('settings.advanced.commonErrorCodes.500')}</li>
                    <li><strong>502:</strong> {t('settings.advanced.commonErrorCodes.502')}</li>
                    <li><strong>503:</strong> {t('settings.advanced.commonErrorCodes.503')}</li>
                    <li><strong>504:</strong> {t('settings.advanced.commonErrorCodes.504')}</li>
                </ul>
            </div>

            {/* Native Output Mode */}
            <div className="settings-panel-card">
                <h3>{t('settings.advanced.nativeOutput.title')}</h3>
                <div className="form-field">
                    <ToggleSwitch
                        checked={nativeOutputMode}
                        onChange={onNativeOutputModeChange}
                        label={t('settings.advanced.nativeOutput.enableNative')}
                        icon={<Document size="sm" />}
                    />
                    <p className="field-hint">{t('settings.advanced.nativeOutput.hint')}</p>
                </div>
            </div>

            {/* Tool Call Auto-Approve */}
            <div className="settings-panel-card">
                <h3>{t('settings.advanced.toolCallAutoApprove.title')}</h3>
                <div className="panel-description">
                    <p>{t('settings.advanced.toolCallAutoApprove.hint')}</p>
                </div>

                <div className="form-field">
                    <ToggleSwitch
                        checked={toolCallAutoApprove.read}
                        onChange={(checked) => onToolCallAutoApproveChange({ ...toolCallAutoApprove, read: checked })}
                        label={t('settings.advanced.toolCallAutoApprove.read')}
                    />
                </div>
                <div className="form-field">
                    <ToggleSwitch
                        checked={toolCallAutoApprove.search}
                        onChange={(checked) => onToolCallAutoApproveChange({ ...toolCallAutoApprove, search: checked })}
                        label={t('settings.advanced.toolCallAutoApprove.search')}
                    />
                </div>
                <div className="form-field">
                    <ToggleSwitch
                        checked={toolCallAutoApprove.create}
                        onChange={(checked) => onToolCallAutoApproveChange({ ...toolCallAutoApprove, create: checked })}
                        label={t('settings.advanced.toolCallAutoApprove.create')}
                    />
                </div>
                <div className="form-field">
                    <ToggleSwitch
                        checked={toolCallAutoApprove.patch}
                        onChange={(checked) => onToolCallAutoApproveChange({ ...toolCallAutoApprove, patch: checked })}
                        label={t('settings.advanced.toolCallAutoApprove.patch')}
                    />
                </div>
                <div className="form-field">
                    <ToggleSwitch
                        checked={toolCallAutoApprove.replace}
                        onChange={(checked) => onToolCallAutoApproveChange({ ...toolCallAutoApprove, replace: checked })}
                        label={t('settings.advanced.toolCallAutoApprove.replace')}
                    />
                </div>
                <div className="form-field">
                    <ToggleSwitch
                        checked={toolCallAutoApprove.delete}
                        onChange={(checked) => onToolCallAutoApproveChange({ ...toolCallAutoApprove, delete: checked })}
                        label={t('settings.advanced.toolCallAutoApprove.delete')}
                    />
                </div>
                <div className="form-field">
                    <ToggleSwitch
                        checked={toolCallAutoApprove.subAgent ?? false}
                        onChange={(checked) => onToolCallAutoApproveChange({ ...toolCallAutoApprove, subAgent: checked })}
                        label={t('settings.advanced.toolCallAutoApprove.subAgent')}
                    />
                </div>
            </div>

            {/* Tool Call History */}
            <div className="settings-panel-card">
                <h3>{t('settings.advanced.toolCallHistory.title')}</h3>
                <div className="form-field">
                    <label>{t('settings.advanced.toolCallHistory.label')}</label>
                    <div className="slider-container">
                        <input
                            type="range"
                            min="0"
                            max="11"
                            value={toolCallHistoryLimit === -1 ? 11 : toolCallHistoryLimit}
                            onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                onToolCallHistoryLimitChange(val === 11 ? -1 : val);
                            }}
                            className="slider"
                        />
                        <span className="slider-value">
                            {toolCallHistoryLimit === -1 ? t('settings.advanced.toolCallHistory.all') : toolCallHistoryLimit}
                        </span>
                    </div>
                    <div className="slider-labels">
                        <span>0</span>
                        <span>{t('settings.advanced.toolCallHistory.all')}</span>
                    </div>
                    <p className="field-hint">{t('settings.advanced.toolCallHistory.hint')}</p>
                </div>
            </div>

            {/* Thinking History */}
            <div className="settings-panel-card">
                <h3>{t('settings.advanced.thinkingHistory.title')}</h3>
                <div className="form-field">
                    <label>{t('settings.advanced.thinkingHistory.label')}</label>
                    <div className="slider-container">
                        <input
                            type="range"
                            min="0"
                            max="11"
                            value={thinkingHistoryLimit === -1 ? 11 : thinkingHistoryLimit}
                            onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                onThinkingHistoryLimitChange(val === 11 ? -1 : val);
                            }}
                            className="slider"
                        />
                        <span className="slider-value">
                            {thinkingHistoryLimit === -1 ? t('settings.advanced.thinkingHistory.all') : thinkingHistoryLimit}
                        </span>
                    </div>
                    <div className="slider-labels">
                        <span>0</span>
                        <span>{t('settings.advanced.thinkingHistory.all')}</span>
                    </div>
                    <p className="field-hint">{t('settings.advanced.thinkingHistory.hint')}</p>
                </div>
            </div>

        </div>
    );
};

export default AdvancedPanel;
