import React, { useState } from 'react';
import { useLLMLogStore, type LLMLogEntry, type LLMLogStatus } from '../../store/llmLogStore';
import { useSettingsStore } from '../../store/settingsStore';
import { TextButton } from '../TextButton';
import { Check, Warning, Loading, Clock, Trash, Document } from '../icons';
import './LLMLogViewer.css';

const LLMLogViewer: React.FC = () => {
    const { logs, clearLogs } = useLLMLogStore();
    const llmLoggingEnabled = useSettingsStore((state) => state.settings.llmLoggingEnabled);
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
                        <span className="toggle-text">Enable LLM Request Logging</span>
                    </label>
                </div>
                <TextButton
                    variant="danger"
                    size="sm"
                    onClick={clearLogs}
                    disabled={logs.length === 0}
                    iconLeft={<Trash size="sm" />}
                >
                    Clear Logs
                </TextButton>
            </div>

            {!llmLoggingEnabled && (
                <div className="log-disabled-notice">
                    Logging is disabled. Enable it to capture LLM requests and responses.
                </div>
            )}

            {/* Log entries */}
            {logs.length === 0 ? (
                <div className="empty-logs">
                    <Document size="3xl" />
                    <p>No logs captured yet.</p>
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
                                            <h4>Request</h4>
                                            <div className="log-params">
                                                <div className="param">
                                                    <label>Provider:</label>
                                                    <span>{log.request.provider}</span>
                                                </div>
                                                <div className="param">
                                                    <label>Model:</label>
                                                    <span>{log.request.model}</span>
                                                </div>
                                                <div className="param">
                                                    <label>Temperature:</label>
                                                    <span>{log.request.temperature}</span>
                                                </div>
                                                <div className="param">
                                                    <label>Thinking Mode:</label>
                                                    <span>{log.request.thinkingMode}</span>
                                                </div>
                                                {log.request.functions && (
                                                    <div className="param">
                                                        <label>Functions:</label>
                                                        <span>{log.request.functions.length} defined</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="log-messages">
                                                <h5>Messages ({log.request.messages.length})</h5>
                                                <pre className="log-json">
                                                    {JSON.stringify(log.request.messages, null, 2)}
                                                </pre>
                                            </div>
                                        </div>

                                        {/* Response Section */}
                                        {log.response && (
                                            <div className="log-section">
                                                <h4>Response</h4>
                                                <div className="log-content">
                                                    <h5>Content Parts</h5>
                                                    <pre className="log-json">
                                                        {JSON.stringify(log.response.contentParts, null, 2)}
                                                    </pre>
                                                </div>
                                                {log.response.functionCalls.length > 0 && (
                                                    <div className="log-function-calls">
                                                        <h5>Function Calls ({log.response.functionCalls.length})</h5>
                                                        <pre className="log-json">
                                                            {JSON.stringify(log.response.functionCalls, null, 2)}
                                                        </pre>
                                                    </div>
                                                )}
                                                {log.response.thinkingDetails && log.response.thinkingDetails.length > 0 && (
                                                    <div className="log-thinking">
                                                        <h5>Thinking Details</h5>
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
                                                <h4>Error</h4>
                                                <pre className="log-error">{log.error}</pre>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="log-info">
                        Showing {logs.length} of max 50 entries. Logs are stored in memory and cleared on page refresh.
                    </div>
                </>
            )}
        </div>
    );
};

export default LLMLogViewer;
