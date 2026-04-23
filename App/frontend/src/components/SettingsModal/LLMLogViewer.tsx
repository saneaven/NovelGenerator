import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseModal } from '../BaseModal';
import { TextButton } from '../TextButton';
import apiClient from '../../api/client';
import { confirm } from '../../store/dialogStore';
import './LLMLogViewer.css';

interface LLMRequestSummary {
  request_id: string;
  provider: string;
  model: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  retry_count: number;
  meta: {
    response_time_ms?: number;
    cache_metrics?: Record<string, unknown>;
  } | null;
}

interface LLMRequestDetail extends LLMRequestSummary {
  run_id: string;
  thread_id: string;
  assistant_message_id: string;
  raw_input: Record<string, unknown> | null;
  raw_output: Record<string, unknown> | null;
  error: string | null;
  meta: {
    response_time_ms?: number;
    retry_errors?: Array<Record<string, unknown>>;
    usage?: Record<string, unknown>;
    finish_reason?: string;
    reasoning_tokens?: number;
    cache_metrics?: Record<string, unknown>;
  } | null;
}

interface LLMRequestListResponse {
  items: LLMRequestSummary[];
  total: number;
}

interface LLMLogViewerProps {
  onClose: () => void;
}

const PAGE_SIZE = 30;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function formatDuration(ms: number | undefined | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const LLMLogViewer: React.FC<LLMLogViewerProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<LLMRequestSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LLMRequestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchLogs = useCallback(async (offset = 0, append = false) => {
    setLoading(true);
    try {
      const res = await apiClient.request<LLMRequestListResponse>(
        'GET', `/api/v1/llm-requests?limit=${PAGE_SIZE}&offset=${offset}`,
      );
      setLogs(prev => append ? [...prev, ...res.items] : res.items);
      setTotal(res.total);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await apiClient.request<LLMRequestDetail>('GET', `/api/v1/llm-requests/${id}`);
      setDetail(res);
    } catch {
      // silently fail
    } finally {
      setDetailLoading(false);
    }
  };

  const handleClearAll = async () => {
    const ok = await confirm({
      title: t('settings.advanced.llmLogging.clearConfirmTitle'),
      message: t('settings.advanced.llmLogging.clearConfirmMessage'),
      confirmLabel: t('common.delete'),
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await apiClient.request('DELETE', '/api/v1/llm-requests');
      setLogs([]);
      setTotal(0);
      setExpandedId(null);
      setDetail(null);
    } catch {
      // silently fail
    }
  };

  const hasMore = logs.length < total;

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={t('settings.advanced.llmLogging.viewerTitle')}
      size="large"
    >
      <div className="llm-log-viewer">
        <div className="llm-log-toolbar">
          <TextButton variant="secondary" size="sm" onClick={() => fetchLogs()} disabled={loading}>
            {t('settings.advanced.llmLogging.refresh')}
          </TextButton>
          <span className="llm-log-count">
            {t('settings.advanced.llmLogging.totalLogs', { count: total })}
          </span>
          <TextButton variant="danger" size="sm" onClick={handleClearAll} disabled={total === 0}>
            {t('settings.advanced.llmLogging.clearAll')}
          </TextButton>
        </div>

        {logs.length === 0 && !loading && (
          <div className="llm-log-empty">
            {t('settings.advanced.llmLogging.noLogs')}
          </div>
        )}

        <div className="llm-log-list">
          {logs.map((log) => (
            <div key={log.request_id} className={`llm-log-row ${expandedId === log.request_id ? 'expanded' : ''}`}>
              <div className="llm-log-summary" onClick={() => handleExpand(log.request_id)}>
                <span className={`llm-log-status llm-log-status--${log.status}`}>
                  {log.status}
                </span>
                <span className="llm-log-request-id">{log.request_id}</span>
                <span className="llm-log-provider">{log.provider}</span>
                <span className="llm-log-model">{log.model}</span>
                <span className="llm-log-retries">r{log.retry_count}</span>
                <span className="llm-log-time">{formatTime(log.created_at)}</span>
                <span className="llm-log-duration">
                  {formatDuration(log.meta?.response_time_ms)}
                </span>
              </div>

              {expandedId === log.request_id && (
                <div className="llm-log-detail">
                  {detailLoading && <div className="llm-log-detail-loading">Loading...</div>}
                  {detail && detail.request_id === log.request_id && (
                    <>
                      <div className="llm-log-meta-grid">
                        <div><strong>Request ID:</strong> {detail.request_id}</div>
                        <div><strong>Run ID:</strong> {detail.run_id}</div>
                        <div><strong>Thread ID:</strong> {detail.thread_id}</div>
                        <div><strong>Assistant Message ID:</strong> {detail.assistant_message_id}</div>
                        <div><strong>Retries:</strong> {detail.retry_count}</div>
                      </div>
                      {detail.error && (
                        <div className="llm-log-error">
                          <strong>Error:</strong> {detail.error}
                        </div>
                      )}
                      {Array.isArray(detail.meta?.retry_errors) && detail.meta.retry_errors.length > 0 && (
                        <div className="llm-log-payload">
                          <h4>Retry Errors</h4>
                          <pre>{JSON.stringify(detail.meta.retry_errors, null, 2)}</pre>
                        </div>
                      )}
                      {detail.meta?.cache_metrics && (
                        <div className="llm-log-payload">
                          <h4>Cache Metrics</h4>
                          <pre>{JSON.stringify(detail.meta.cache_metrics, null, 2)}</pre>
                        </div>
                      )}
                      <div className="llm-log-payload">
                        <h4>Raw Input</h4>
                        <pre>{detail.raw_input === null ? 'Logging disabled' : JSON.stringify(detail.raw_input, null, 2)}</pre>
                      </div>
                      <div className="llm-log-payload">
                        <h4>Raw Output</h4>
                        <pre>{detail.raw_output === null ? 'Logging disabled' : JSON.stringify(detail.raw_output, null, 2)}</pre>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {hasMore && (
          <div className="llm-log-load-more">
            <TextButton
              variant="secondary"
              size="sm"
              onClick={() => fetchLogs(logs.length, true)}
              disabled={loading}
            >
              {t('settings.advanced.llmLogging.loadMore')}
            </TextButton>
          </div>
        )}
      </div>
    </BaseModal>
  );
};

export default LLMLogViewer;
