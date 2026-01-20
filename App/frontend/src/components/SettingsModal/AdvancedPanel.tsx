import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RetryConfig } from '../../store/settingsStore';
import LLMLogViewer from './LLMLogViewer';
import ToggleSwitch from '../common/ToggleSwitch';
import { TextButton } from '../TextButton';
import { Refresh, Document, Lock } from '../icons';
import type { CredentialBackupStatusResponse } from '../../api/credentialsBackupService';
import PasswordPromptModal from './PasswordPromptModal';
import './AdvancedPanel.css';

interface AdvancedPanelProps {
    retryConfig: RetryConfig;
    onRetryConfigChange: (config: RetryConfig) => void;
    backupStatus: CredentialBackupStatusResponse | null;
    backupSyncing: boolean;
    onBackupRefresh: () => void;
    onBackupUpload: (password: string) => Promise<void>;
    onBackupRestore: (password: string) => Promise<void>;
    onBackupDelete: (password: string) => Promise<void>;
    nativeOutputMode: boolean;
    onNativeOutputModeChange: (enabled: boolean) => void;
    functionCallHistoryLimit: number;
    onFunctionCallHistoryLimitChange: (limit: number) => void;
    thinkingHistoryLimit: number;
    onThinkingHistoryLimitChange: (limit: number) => void;
}

const AdvancedPanel: React.FC<AdvancedPanelProps> = ({
    retryConfig,
    onRetryConfigChange,
    backupStatus,
    backupSyncing,
    onBackupRefresh,
    onBackupUpload,
    onBackupRestore,
    onBackupDelete,
    nativeOutputMode,
    onNativeOutputModeChange,
    functionCallHistoryLimit,
    onFunctionCallHistoryLimitChange,
    thinkingHistoryLimit,
    onThinkingHistoryLimitChange,
}) => {
    const [newErrorCode, setNewErrorCode] = useState('');
    const [passwordModalOpen, setPasswordModalOpen] = useState(false);
    const [passwordModalTitle, setPasswordModalTitle] = useState('');
    const [passwordModalDescription, setPasswordModalDescription] = useState<string | undefined>(undefined);
    const [passwordModalConfirmLabel, setPasswordModalConfirmLabel] = useState('');
    const [passwordModalAction, setPasswordModalAction] = useState<((password: string) => Promise<void>) | null>(null);

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

    const { t } = useTranslation();

    const openPasswordModal = (opts: {
        title: string;
        description?: string;
        confirmLabel: string;
        action: (password: string) => Promise<void>;
    }) => {
        setPasswordModalTitle(opts.title);
        setPasswordModalDescription(opts.description);
        setPasswordModalConfirmLabel(opts.confirmLabel);
        setPasswordModalAction(() => opts.action);
        setPasswordModalOpen(true);
    };

    return (
        <div className="advanced-panel">
            <div className="panel-description">
                <p>{t('settings.advanced.description')}</p>
            </div>

            <div className="advanced-settings-card">
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

            <div className="advanced-info-box">
                <h4>{t('settings.advanced.commonErrorCodes.title')}</h4>
                <ul>
                    <li><strong>429:</strong> {t('settings.advanced.commonErrorCodes.429')}</li>
                    <li><strong>500:</strong> {t('settings.advanced.commonErrorCodes.500')}</li>
                    <li><strong>502:</strong> {t('settings.advanced.commonErrorCodes.502')}</li>
                    <li><strong>503:</strong> {t('settings.advanced.commonErrorCodes.503')}</li>
                    <li><strong>504:</strong> {t('settings.advanced.commonErrorCodes.504')}</li>
                </ul>
            </div>

            {/* Server Credentials Backup (E2E) */}
            <div className="advanced-settings-card">
                <h3>{t('settings.advanced.serverVault.backupTitle')}</h3>
                <div className="form-field">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Lock size="sm" />
                        <p className="field-hint" style={{ margin: 0 }}>
                            {t('settings.advanced.serverVault.backupHint')}
                        </p>
                    </div>
                </div>

                <div className="form-field">
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <TextButton
                            variant="secondary"
                            size="sm"
                            type="button"
                            onClick={onBackupRefresh}
                            disabled={backupSyncing}
                        >
                            {t('settings.advanced.serverVault.refreshBackupStatus')}
                        </TextButton>
                        <TextButton
                            variant="secondary"
                            size="sm"
                            type="button"
                            onClick={() =>
                                openPasswordModal({
                                    title: t('settings.advanced.serverVault.backupActionTitle'),
                                    description: t('settings.advanced.serverVault.backupActionDescription'),
                                    confirmLabel: t('settings.advanced.serverVault.backupActionConfirm'),
                                    action: onBackupUpload,
                                })
                            }
                            disabled={backupSyncing}
                        >
                            {t('settings.advanced.serverVault.backupActionConfirm')}
                        </TextButton>
                        <TextButton
                            variant="secondary"
                            size="sm"
                            type="button"
                            onClick={() =>
                                openPasswordModal({
                                    title: t('settings.advanced.serverVault.restoreActionTitle'),
                                    description: t('settings.advanced.serverVault.restoreActionDescription'),
                                    confirmLabel: t('settings.advanced.serverVault.restoreActionConfirm'),
                                    action: onBackupRestore,
                                })
                            }
                            disabled={backupSyncing || !backupStatus?.hasBackup}
                        >
                            {t('settings.advanced.serverVault.restoreActionConfirm')}
                        </TextButton>
                        <TextButton
                            variant="secondary"
                            size="sm"
                            type="button"
                            onClick={() =>
                                openPasswordModal({
                                    title: t('settings.advanced.serverVault.deleteActionTitle'),
                                    description: t('settings.advanced.serverVault.deleteActionDescription'),
                                    confirmLabel: t('settings.advanced.serverVault.deleteActionConfirm'),
                                    action: onBackupDelete,
                                })
                            }
                            disabled={backupSyncing || !backupStatus?.hasBackup}
                        >
                            {t('settings.advanced.serverVault.deleteActionConfirm')}
                        </TextButton>
                    </div>
                    {backupStatus && (
                        <p className="field-hint" style={{ marginTop: 8 }}>
                            {backupStatus.hasBackup ? t('settings.advanced.serverVault.statusHasBackup') : t('settings.advanced.serverVault.statusNoBackup')}
                            {backupStatus.updatedAt ? ` (${backupStatus.updatedAt})` : ''}
                        </p>
                    )}
                </div>
            </div>

            <PasswordPromptModal
                isOpen={passwordModalOpen}
                title={passwordModalTitle}
                description={passwordModalDescription}
                confirmLabel={passwordModalConfirmLabel}
                isLoading={backupSyncing}
                onClose={() => setPasswordModalOpen(false)}
                onConfirm={async (password) => {
                    if (!passwordModalAction) return;
                    await passwordModalAction(password);
                }}
            />

            {/* Native Output Mode */}
            <div className="advanced-settings-card">
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

            {/* Function Call History */}
            <div className="advanced-settings-card">
                <h3>{t('settings.advanced.functionCallHistory.title')}</h3>
                <div className="form-field">
                    <label>{t('settings.advanced.functionCallHistory.label')}</label>
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
                            {functionCallHistoryLimit === -1 ? t('settings.advanced.functionCallHistory.all') : functionCallHistoryLimit}
                        </span>
                    </div>
                    <div className="slider-labels">
                        <span>0</span>
                        <span>{t('settings.advanced.functionCallHistory.all')}</span>
                    </div>
                    <p className="field-hint">{t('settings.advanced.functionCallHistory.hint')}</p>
                </div>
            </div>

            {/* Thinking History */}
            <div className="advanced-settings-card">
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

            {/* LLM Request Logging */}
            <div className="advanced-settings-card">
                <h3>{t('settings.advanced.llmLogging.title')}</h3>
                <div className="panel-description">
                    <p>{t('settings.advanced.llmLogging.description')}</p>
                </div>
                <LLMLogViewer />
            </div>
        </div>
    );
};

export default AdvancedPanel;
