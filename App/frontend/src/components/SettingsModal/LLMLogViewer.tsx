import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseModal } from '../BaseModal';
import { TextButton } from '../TextButton';
import apiClient from '../../api/client';
import { confirm } from '../../store/dialogStore';
import './LLMLogViewer.css';

interface LLMLogSummary {
  id: string;
  provider: string;
  model: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  meta: { response_time_ms?: number } | null;
}

interface LLMLogDetail extends LLMLogSummary {
  raw_input: Record<string, unknown>;
  raw_output: Record<string, unknown> | null;
  error: string | null;
}

interface LLMLogListResponse {
  items: LLMLogSummary[];
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
  const [logs, setLogs] = useState<LLMLogSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LLMLogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchLogs = useCallback(async (offset = 0, append = false) => {
    setLoading(true);
    try {
      const res = await apiClient.request<LLMLogListResponse>(
        'GET', `/api/v1/llm-logs?limit=${PAGE_SIZE}&offset=${offset}`,
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
      const res = await apiClient.request<LLMLogDetail>('GET', `/api/v1/llm-logs/${id}`);
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
      danger: true,
    });
    if (!ok) return;
    try {
      await apiClient.request('DELETE', '/api/v1/llm-logs');
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
      size="lg"
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
            <div key={log.id} className={`llm-log-row ${expandedId === log.id ? 'expanded' : ''}`}>
              <div className="llm-log-summary" onClick={() => handleExpand(log.id)}>
                <span className={`llm-log-status llm-log-status--${log.status}`}>
                  {log.status}
                </span>
                <span className="llm-log-provider">{log.provider}</span>
                <span className="llm-log-model">{log.model}</span>
                <span className="llm-log-time">{formatTime(log.created_at)}</span>
                <span className="llm-log-duration">
                  {formatDuration(log.meta?.response_time_ms)}
                </span>
              </div>

              {expandedId === log.id && (
                <div className="llm-log-detail">
                  {detailLoading && <div className="llm-log-detail-loading">Loading...</div>}
                  {detail && detail.id === log.id && (
                    <>
                      {detail.error && (
                        <div className="llm-log-error">
                          <strong>Error:</strong> {detail.error}
                        </div>
                      )}
                      <div className="llm-log-payload">
                        <h4>Raw Input</h4>
                        <pre>{JSON.stringify(detail.raw_input, null, 2)}</pre>
                      </div>
                      {detail.raw_output && (
                        <div className="llm-log-payload">
                          <h4>Raw Output</h4>
                          <pre>{JSON.stringify(detail.raw_output, null, 2)}</pre>
                        </div>
                      )}
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
