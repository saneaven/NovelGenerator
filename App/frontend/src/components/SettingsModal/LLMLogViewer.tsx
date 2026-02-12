import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLLMLogStore, type LLMLogStatus } from '../../store/llmLogStore';
import { useSettingsStore } from '../../store/settingsStore';
import { TextButton } from '../TextButton';
import { Check, Warning, Loading, Clock, Trash, Document } from '../icons';
import './LLMLogViewer.css';

const LLMLogViewer: React.FC = () => {
    const { t } = useTranslation();
    const { logs, clearLogs } = useLLMLogStore();
    const llmLoggingEnabled = useSettingsStore((state) => state.getSettings().llmLoggingEnabled);
    const setLLMLoggingEnabled = useSettingsStore((state) => state.setLLMLoggingEnabled);
    const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

    const toggleExpand = (logId: string) => {
        setExpandedLogs((prev) => {
            const next = new Set(prev);
            if (next.has(logId)) {
                next.delete(logId);
            } else {
                next.add(logId);
            }
            return next;
        });
    };

    const getStatusIcon = (status: LLMLogStatus) => {
        switch (status) {
            case 'success':
                return <Check size="sm" className="status-icon success" />;
            case 'error':
                return <Warning size="sm" className="status-icon error" />;
            case 'streaming':
            case 'pending':
                return <Loading size="sm" className="status-icon pending" />;
        }
    };

    const formatDuration = (ms?: number) => {
        if (!ms) return '-';
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(2)}s`;
    };

    const formatTimestamp = (date: Date) => {
        return date.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    };

    return (
        <div className="llm-log-viewer">
            {/* Header with toggle and clear */}
            <div className="log-viewer-header">
                <div className="log-toggle">
                    <label className="toggle-label">
                        <input
                            type="checkbox"
                            checked={llmLoggingEnabled}
                            onChange={(e) => setLLMLoggingEnabled(e.target.checked)}
                            className="toggle-input"
                        />
                        <span className="toggle-switch"></span>
                        <span className="toggle-text">{t('settings.llmLog.enableLogging')}</span>
                    </label>
                </div>
                <TextButton
                    variant="danger"
                    size="sm"
                    onClick={clearLogs}
                    disabled={logs.length === 0}
                    iconLeft={<Trash size="sm" />}
                >
                    {t('settings.llmLog.clearLogs')}
                </TextButton>
            </div>

            {!llmLoggingEnabled && (
                <div className="log-disabled-notice">
                    {t('settings.llmLog.loggingDisabled')}
                </div>
            )}

            {/* Log entries */}
            {logs.length === 0 ? (
                <div className="empty-logs">
                    <Document size="3xl" />
                    <p>{t('settings.llmLog.noLogs')}</p>
                </div>
            ) : (
                <>
                    <div className="log-entries">
                        {logs.map((log) => (
                            <div
                                key={log.id}
                                className={`log-entry ${log.status}`}
                            >
                                <div
                                    className="log-entry-header"
                                    onClick={() => toggleExpand(log.id)}
                                >
                                    <div className="log-entry-summary">
                                        {getStatusIcon(log.status)}
                                        <span className="log-mode">{log.request.mode}</span>
                                        <span className="log-model">
                                            {log.request.provider}/{log.request.model}
                                        </span>
                                    </div>
                                    <div className="log-entry-meta">
                                        <span className="log-duration">
                                            <Clock size="xs" /> {formatDuration(log.durationMs)}
                                        </span>
                                        <span className="log-timestamp">
                                            {formatTimestamp(log.timestamp)}
                                        </span>
                                        <span className="expand-indicator">
                                            {expandedLogs.has(log.id) ? '[-]' : '[+]'}
                                        </span>
                                    </div>
                                </div>

                                {expandedLogs.has(log.id) && (
                                    <div className="log-entry-details">
                                        {/* Request Section */}
                                        <div className="log-section">
                                            <h4>{t('settings.llmLog.request')}</h4>
                                            <div className="log-params">
                                                <div className="param">
                                                    <label>{t('settings.llmLog.provider')}:</label>
                                                    <span>{log.request.provider}</span>
                                                </div>
                                                <div className="param">
                                                    <label>{t('settings.llmLog.model')}:</label>
                                                    <span>{log.request.model}</span>
                                                </div>
                                                <div className="param">
                                                    <label>{t('settings.llmLog.temperature')}:</label>
                                                    <span>{log.request.temperature}</span>
                                                </div>
                                                <div className="param">
                                                    <label>{t('settings.llmLog.thinking_mode')}:</label>
                                                    <span>{log.request.thinking_mode}</span>
                                                </div>
                                                {log.request.tools && (
                                                    <div className="param">
                                                        <label>{t('settings.llmLog.tools')}:</label>
                                                        <span>{t('settings.llmLog.toolsDefined', { count: log.request.tools.length })}</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="log-messages">
                                                <h5>{t('settings.llmLog.messages', { count: log.request.messages.length })}</h5>
                                                <pre className="log-json">
                                                    {JSON.stringify(log.request.messages, null, 2)}
                                                </pre>
                                            </div>
                                        </div>

                                        {/* Response Section */}
                                        {log.response && (
                                            <div className="log-section">
                                                <h4>{t('settings.llmLog.response')}</h4>
                                                <div className="log-content">
                                                    <h5>{t('settings.llmLog.contentParts')}</h5>
                                                    <pre className="log-json">
                                                        {JSON.stringify(log.response.contentParts, null, 2)}
                                                    </pre>
                                                </div>
                                                {log.response.toolCalls.length > 0 && (
                                                    <div className="log-tool-calls">
                                                        <h5>{t('settings.llmLog.toolCalls', { count: log.response.toolCalls.length })}</h5>
                                                        <pre className="log-json">
                                                            {JSON.stringify(log.response.toolCalls, null, 2)}
                                                        </pre>
                                                    </div>
                                                )}
                                                {log.response.thinkingDetails && log.response.thinkingDetails.length > 0 && (
                                                    <div className="log-thinking">
                                                        <h5>{t('settings.llmLog.thinkingDetails')}</h5>
                                                        <pre className="log-json">
                                                            {JSON.stringify(log.response.thinkingDetails, null, 2)}
                                                        </pre>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Error Section */}
                                        {log.error && (
                                            <div className="log-section error">
                                                <h4>{t('common.error')}</h4>
                                                <pre className="log-error">{log.error}</pre>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="log-info">
                        {t('settings.llmLog.showingEntries', { count: logs.length })}
                    </div>
                </>
            )}
        </div>
    );
};

export default LLMLogViewer;
