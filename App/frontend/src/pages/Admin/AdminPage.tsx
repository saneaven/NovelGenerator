import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  adminService,
  type AdminMemorySummaryResponse,
  type AdminMemoryTracemallocAction,
  type AdminUserStorageItem,
} from '../../api';
import { useAuthStore } from '../../store/authStore';
import { Loading } from '../../components/common/Loading';
import { TextButton } from '../../components/TextButton';
import { CustomSelect } from '../../components/ui/CustomSelect';
import { ArrowLeft, People, Refresh, Star, Warning } from '../../components/icons';
import { StorageUsageSummary, formatBytes } from '../../components/StorageUsageSummary';
import { isAdminMemoryDiagnosticsEnabled } from '../../config/features';
import './AdminPage.css';

type AdminFilter = 'all' | 'admins' | 'members';
type PendingAction = 'role' | 'quota' | 'reset' | null;

const FILTER_OPTIONS = [
  { value: 'all', label: 'All Users' },
  { value: 'admins', label: 'Admins Only' },
  { value: 'members', label: 'Members Only' },
];

function formatJoinedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function parseQuotaInput(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) return 'invalid';
  return parsed;
}

const PROCESS_STATUS_ROWS = [
  { key: 'VmRSS', label: 'VmRSS', kind: 'bytes' },
  { key: 'VmHWM', label: 'VmHWM', kind: 'bytes' },
  { key: 'VmSize', label: 'VmSize', kind: 'bytes' },
  { key: 'VmData', label: 'VmData', kind: 'bytes' },
  { key: 'VmStk', label: 'VmStk', kind: 'bytes' },
  { key: 'VmExe', label: 'VmExe', kind: 'bytes' },
  { key: 'VmLib', label: 'VmLib', kind: 'bytes' },
  { key: 'VmPTE', label: 'VmPTE', kind: 'bytes' },
  { key: 'RssAnon', label: 'RssAnon', kind: 'bytes' },
  { key: 'RssFile', label: 'RssFile', kind: 'bytes' },
  { key: 'RssShmem', label: 'RssShmem', kind: 'bytes' },
  { key: 'Threads', label: 'Threads', kind: 'count' },
] as const;

const SMAPS_ROLLUP_ROWS = [
  { key: 'Rss', label: 'Rss' },
  { key: 'Pss', label: 'Pss' },
  { key: 'Private_Clean', label: 'Private Clean' },
  { key: 'Private_Dirty', label: 'Private Dirty' },
  { key: 'Shared_Clean', label: 'Shared Clean' },
  { key: 'Shared_Dirty', label: 'Shared Dirty' },
  { key: 'Anonymous', label: 'Anonymous' },
  { key: 'File', label: 'File' },
  { key: 'Swap', label: 'Swap' },
] as const;

function metricValue(source: Record<string, number | null> | undefined, key: string): number | null {
  const value = source?.[key];
  return typeof value === 'number' ? value : null;
}

function formatCount(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toLocaleString() : '—';
}

function formatMemoryBytes(value: number | null | undefined): string {
  return typeof value === 'number' ? formatBytes(value) : '—';
}

function formatDiagnosticValue(value: number | null | undefined, kind: 'bytes' | 'count'): string {
  return kind === 'bytes' ? formatMemoryBytes(value) : formatCount(value);
}

function buildJsonTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function downloadRawJson(data: unknown, prefix: string): void {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${prefix}-${buildJsonTimestamp()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const AdminPage: React.FC = () => {
  const navigate = useNavigate();
  const currentUser = useAuthStore((state) => state.user);

  const [users, setUsers] = useState<AdminUserStorageItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<AdminFilter>('all');
  const [quotaDrafts, setQuotaDrafts] = useState<Record<string, string>>({});
  const [pendingActions, setPendingActions] = useState<Record<string, PendingAction>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string | null>>({});

  const memoryDiagnosticsEnabled = isAdminMemoryDiagnosticsEnabled();
  const [memoryData, setMemoryData] = useState<AdminMemorySummaryResponse | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [tracemallocPending, setTracemallocPending] =
    useState<AdminMemoryTracemallocAction | null>(null);

  const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLowerCase());

  const loadUsers = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await adminService.listUsersStorage();
      setUsers(response.users);
      setQuotaDrafts(
        Object.fromEntries(
          response.users.map((user) => [
            user.user_id,
            user.storage_quota_bytes_override != null ? String(user.storage_quota_bytes_override) : '',
          ])
        )
      );
      setRowErrors({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMemory = async () => {
    setMemoryLoading(true);
    setMemoryError(null);
    try {
      const response = await adminService.getMemorySummary();
      setMemoryData(response);
    } catch (err) {
      setMemoryError(err instanceof Error ? err.message : 'Failed to load memory diagnostics.');
    } finally {
      setMemoryLoading(false);
    }
  };

  useEffect(() => {
    if (!memoryDiagnosticsEnabled) return;
    void loadMemory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoryDiagnosticsEnabled]);

  const handleTracemallocAction = async (action: AdminMemoryTracemallocAction) => {
    setTracemallocPending(action);
    setMemoryError(null);
    try {
      await adminService.controlTracemalloc(action);
      await loadMemory();
    } catch (err) {
      setMemoryError(err instanceof Error ? err.message : 'Failed to update tracemalloc.');
    } finally {
      setTracemallocPending(null);
    }
  };

  const handleDownloadMemoryJson = () => {
    if (!memoryData) return;
    downloadRawJson(memoryData, 'memory-summary');
  };

  const replaceUser = (nextUser: AdminUserStorageItem) => {
    setUsers((prev) => prev.map((user) => (user.user_id === nextUser.user_id ? nextUser : user)));
    setQuotaDrafts((prev) => ({
      ...prev,
      [nextUser.user_id]: nextUser.storage_quota_bytes_override != null ? String(nextUser.storage_quota_bytes_override) : '',
    }));
  };

  const setPendingAction = (userId: string, action: PendingAction) => {
    setPendingActions((prev) => ({ ...prev, [userId]: action }));
  };

  const handleToggleAdmin = async (targetUser: AdminUserStorageItem) => {
    setPendingAction(targetUser.user_id, 'role');
    setRowErrors((prev) => ({ ...prev, [targetUser.user_id]: null }));

    try {
      const updated = await adminService.updateUser(targetUser.user_id, { is_admin: !targetUser.is_admin });
      replaceUser(updated);
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [targetUser.user_id]: err instanceof Error ? err.message : 'Failed to update this user.',
      }));
    } finally {
      setPendingAction(targetUser.user_id, null);
    }
  };

  const handleSaveQuota = async (targetUser: AdminUserStorageItem) => {
    const draft = quotaDrafts[targetUser.user_id] ?? '';
    const parsedQuota = parseQuotaInput(draft);

    if (parsedQuota === 'invalid') {
      setRowErrors((prev) => ({ ...prev, [targetUser.user_id]: 'Quota override must be a whole number >= 0.' }));
      return;
    }

    setPendingAction(targetUser.user_id, 'quota');
    setRowErrors((prev) => ({ ...prev, [targetUser.user_id]: null }));

    try {
      const updated = await adminService.updateUser(targetUser.user_id, { storage_quota_bytes: parsedQuota });
      replaceUser(updated);
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [targetUser.user_id]: err instanceof Error ? err.message : 'Failed to update this user.',
      }));
    } finally {
      setPendingAction(targetUser.user_id, null);
    }
  };

  const handleResetQuota = async (targetUser: AdminUserStorageItem) => {
    setPendingAction(targetUser.user_id, 'reset');
    setRowErrors((prev) => ({ ...prev, [targetUser.user_id]: null }));

    try {
      const updated = await adminService.updateUser(targetUser.user_id, { storage_quota_bytes: null });
      replaceUser(updated);
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [targetUser.user_id]: err instanceof Error ? err.message : 'Failed to update this user.',
      }));
    } finally {
      setPendingAction(targetUser.user_id, null);
    }
  };

  const summary = useMemo(() => {
    const adminCount = users.filter((user) => user.is_admin).length;
    const totalUsedBytes = users.reduce((sum, user) => sum + user.used_bytes, 0);
    const totalQuotaBytes = users.reduce((sum, user) => sum + user.quota_bytes, 0);

    return {
      totalUsers: users.length,
      adminCount,
      totalUsedBytes,
      totalQuotaBytes,
    };
  }, [users]);

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      if (filter === 'admins' && !user.is_admin) return false;
      if (filter === 'members' && user.is_admin) return false;

      if (!deferredSearchQuery) return true;

      const haystack = `${user.username} ${user.email}`.toLowerCase();
      return haystack.includes(deferredSearchQuery);
    });
  }, [deferredSearchQuery, filter, users]);

  const memorySummaryCards = useMemo(() => {
    if (!memoryData) return [];
    return [
      { label: 'RSS', value: formatMemoryBytes(memoryData.rss_bytes) },
      { label: 'VMS', value: formatMemoryBytes(memoryData.vms_bytes) },
      { label: 'VmHWM', value: formatMemoryBytes(metricValue(memoryData.process_status, 'VmHWM')) },
      { label: 'RssAnon', value: formatMemoryBytes(metricValue(memoryData.process_status, 'RssAnon')) },
      { label: 'RssFile', value: formatMemoryBytes(metricValue(memoryData.process_status, 'RssFile')) },
      { label: 'Private Dirty', value: formatMemoryBytes(metricValue(memoryData.smaps_rollup, 'Private_Dirty')) },
      { label: 'Threads', value: formatCount(metricValue(memoryData.process_status, 'Threads')) },
      { label: 'FD Sockets', value: formatCount(memoryData.fd?.sockets) },
      { label: 'Async Pending', value: formatCount(memoryData.asyncio?.pending) },
      { label: 'Gen-2 Objects', value: memoryData.gc.total_objects_gen2.toLocaleString() },
      {
        label: 'Tracemalloc',
        value: memoryData.tracemalloc.enabled
          ? `On · ${formatMemoryBytes(memoryData.tracemalloc.traced_memory_current)} / peak ${formatMemoryBytes(memoryData.tracemalloc.traced_memory_peak)}`
          : 'Off',
      },
    ];
  }, [memoryData]);

  if (!currentUser?.is_admin) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="admin-page">
      <header className="admin-page__header">
        <div className="admin-page__header-inner">
          <div className="admin-page__heading">
            <div className="admin-page__eyebrow">
              <Star size="sm" />
              <span>Admin Console</span>
            </div>
            <h1>Admin Console</h1>
            <p>Manage user roles and total project storage quotas from one dedicated surface.</p>
          </div>

          <div className="admin-page__header-actions">
            <TextButton
              variant="secondary"
              iconLeft={<ArrowLeft size="md" />}
              onClick={() => navigate('/dashboard')}
            >
              Back to Dashboard
            </TextButton>
            <TextButton
              variant="primary"
              iconLeft={<Refresh size="md" />}
              onClick={() => {
                void loadUsers();
              }}
              loading={isLoading}
            >
              Refresh
            </TextButton>
          </div>
        </div>
      </header>

      <main className="admin-page__main">
        {error && <div className="admin-page__error">{error}</div>}

        <section className="admin-page__summary-grid">
          <article className="admin-summary-card">
            <div className="admin-summary-card__label">Total Users</div>
            <div className="admin-summary-card__value">{summary.totalUsers}</div>
          </article>
          <article className="admin-summary-card">
            <div className="admin-summary-card__label">Admins</div>
            <div className="admin-summary-card__value">{summary.adminCount}</div>
          </article>
          <article className="admin-summary-card">
            <div className="admin-summary-card__label">Total Used</div>
            <div className="admin-summary-card__value">{formatBytes(summary.totalUsedBytes)}</div>
          </article>
          <article className="admin-summary-card">
            <div className="admin-summary-card__label">Total Quota</div>
            <div className="admin-summary-card__value">{formatBytes(summary.totalQuotaBytes)}</div>
          </article>
        </section>

        <section className="admin-page__panel">
          <div className="admin-page__panel-header">
            <div>
              <h2>Users</h2>
              <p>Search accounts, grant or revoke admin access, and manage quota overrides.</p>
            </div>
            <div className="admin-page__panel-badge">
              <People size="md" />
              <span>{filteredUsers.length}</span>
            </div>
          </div>

          <div className="admin-page__filters">
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by username or email"
            />
            <CustomSelect
              value={filter}
              onChange={(value) => setFilter(value as AdminFilter)}
              options={FILTER_OPTIONS}
              className="admin-page__filter-select"
              minWidth={220}
              align="right"
            />
          </div>

          {isLoading && users.length === 0 ? (
            <div className="admin-page__loading">
              <Loading text="Loading admin data..." />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="admin-page__empty">
              <Warning size="lg" />
              <h3>{searchQuery ? 'No matching users' : 'No users found'}</h3>
              <p>
                {searchQuery
                  ? 'Try a different search query or filter combination.'
                  : 'The admin list is empty right now.'}
              </p>
            </div>
          ) : (
            <div className="admin-user-grid">
              {filteredUsers.map((targetUser) => {
                const pendingAction = pendingActions[targetUser.user_id];
                const rowError = rowErrors[targetUser.user_id];
                const quotaDraft = quotaDrafts[targetUser.user_id] ?? '';
                const isSelf = currentUser.id === targetUser.user_id;
                const isLastAdmin = targetUser.is_admin && summary.adminCount <= 1;
                const roleActionBlocked = targetUser.is_admin && (isSelf || isLastAdmin);

                let roleHint: string | null = null;
                if (targetUser.is_admin && isSelf) {
                  roleHint = 'You cannot revoke your own admin role from this screen.';
                } else if (targetUser.is_admin && isLastAdmin) {
                  roleHint = 'At least one admin must remain.';
                }

                return (
                  <article key={targetUser.user_id} className="admin-user-card">
                    <div className="admin-user-card__header">
                      <div className="admin-user-card__identity">
                        <h3>{targetUser.username}</h3>
                        <p>{targetUser.email}</p>
                      </div>
                      <div className="admin-user-card__badges">
                        <span className={`admin-user-card__badge ${targetUser.is_admin ? 'admin' : 'member'}`}>
                          {targetUser.is_admin ? 'Admin' : 'Member'}
                        </span>
                        {isSelf && <span className="admin-user-card__badge you">You</span>}
                      </div>
                    </div>

                    <div className="admin-user-card__meta">
                      <span>{`Joined ${formatJoinedDate(targetUser.created_at)}`}</span>
                      <span>
                        {targetUser.storage_quota_bytes_override != null
                          ? 'Custom quota override'
                          : 'Using default quota'}
                      </span>
                    </div>

                    <StorageUsageSummary
                      compact
                      usedBytes={targetUser.used_bytes}
                      remainingBytes={targetUser.remaining_bytes}
                      quotaBytes={targetUser.quota_bytes}
                      percentUsed={targetUser.percent_used}
                      labels={{
                        used: 'Used',
                        remaining: 'Remaining',
                        quota: 'Quota',
                      }}
                    />

                    <div className="admin-user-card__actions">
                      <TextButton
                        variant={targetUser.is_admin ? 'warning' : 'primary'}
                        onClick={() => {
                          void handleToggleAdmin(targetUser);
                        }}
                        disabled={roleActionBlocked}
                        loading={pendingAction === 'role'}
                      >
                        {targetUser.is_admin ? 'Revoke Admin' : 'Grant Admin'}
                      </TextButton>
                      {roleHint && <div className="field-hint">{roleHint}</div>}
                    </div>

                    <div className="admin-user-card__quota">
                      <label htmlFor={`quota-${targetUser.user_id}`}>Quota Override (bytes)</label>
                      <div className="admin-user-card__quota-row">
                        <input
                          id={`quota-${targetUser.user_id}`}
                          type="number"
                          min="0"
                          step="1"
                          value={quotaDraft}
                          onChange={(event) =>
                            setQuotaDrafts((prev) => ({ ...prev, [targetUser.user_id]: event.target.value }))
                          }
                          placeholder="Leave blank to use default"
                        />
                        <TextButton
                          variant="secondary"
                          onClick={() => {
                            void handleSaveQuota(targetUser);
                          }}
                          loading={pendingAction === 'quota'}
                        >
                          Save Quota
                        </TextButton>
                        <TextButton
                          variant="ghost"
                          onClick={() => {
                            void handleResetQuota(targetUser);
                          }}
                          disabled={targetUser.storage_quota_bytes_override == null && !quotaDraft}
                          loading={pendingAction === 'reset'}
                        >
                          Reset
                        </TextButton>
                      </div>
                      <div className="field-hint">
                        {`Current effective quota: ${formatBytes(targetUser.quota_bytes)}`}
                      </div>
                    </div>

                    {rowError && <div className="form-error">{rowError}</div>}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {memoryDiagnosticsEnabled && (
          <section className="admin-page__panel admin-memory-panel">
            <div className="admin-page__panel-header">
              <div>
                <h2>Memory Diagnostics</h2>
                <p>Inspect the backend process heap. Snapshot now, compare later.</p>
              </div>
              <div className="admin-memory-header-actions">
                <TextButton
                  variant="secondary"
                  onClick={handleDownloadMemoryJson}
                  disabled={!memoryData}
                >
                  Download Summary JSON
                </TextButton>
                <TextButton
                  variant="primary"
                  iconLeft={<Refresh size="md" />}
                  onClick={() => {
                    void loadMemory();
                  }}
                  loading={memoryLoading}
                >
                  Refresh
                </TextButton>
              </div>
            </div>

            {memoryError && <div className="admin-page__error">{memoryError}</div>}

            {memoryData ? (
              <>
                <div className="admin-memory-cards">
                  {memorySummaryCards.map((card) => (
                    <article key={card.label} className="admin-summary-card">
                      <div className="admin-summary-card__label">{card.label}</div>
                      <div className="admin-summary-card__value">{card.value}</div>
                    </article>
                  ))}
                </div>

                <div className="admin-memory-controls">
                  <TextButton
                    variant="primary"
                    onClick={() => {
                      void handleTracemallocAction('start');
                    }}
                    disabled={memoryData.tracemalloc.enabled}
                    loading={tracemallocPending === 'start'}
                  >
                    Start Tracemalloc
                  </TextButton>
                  <TextButton
                    variant="secondary"
                    onClick={() => {
                      void handleTracemallocAction('reset');
                    }}
                    disabled={!memoryData.tracemalloc.enabled}
                    loading={tracemallocPending === 'reset'}
                  >
                    Reset Baseline
                  </TextButton>
                  <TextButton
                    variant="warning"
                    onClick={() => {
                      void handleTracemallocAction('stop');
                    }}
                    disabled={!memoryData.tracemalloc.enabled}
                    loading={tracemallocPending === 'stop'}
                  >
                    Stop Tracemalloc
                  </TextButton>
                </div>

                <div className="admin-memory-tables">
                  <div className="admin-memory-diagnostic-grid">
                    <div className="admin-memory-table admin-memory-table--compact">
                      <h3>Process Status</h3>
                      <table>
                        <thead>
                          <tr>
                            <th>Metric</th>
                            <th>Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {PROCESS_STATUS_ROWS.map((entry) => (
                            <tr key={entry.key}>
                              <td>{entry.label}</td>
                              <td>{formatDiagnosticValue(metricValue(memoryData.process_status, entry.key), entry.kind)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="admin-memory-table admin-memory-table--compact">
                      <h3>smaps Rollup</h3>
                      <table>
                        <thead>
                          <tr>
                            <th>Metric</th>
                            <th>Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {SMAPS_ROLLUP_ROWS.map((entry) => (
                            <tr key={entry.key}>
                              <td>{entry.label}</td>
                              <td>{formatMemoryBytes(metricValue(memoryData.smaps_rollup, entry.key))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="admin-memory-table admin-memory-table--compact">
                      <h3>Runtime Counters</h3>
                      <table>
                        <thead>
                          <tr>
                            <th>Metric</th>
                            <th>Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>FD Total</td>
                            <td>{formatCount(memoryData.fd?.total)}</td>
                          </tr>
                          <tr>
                            <td>FD Sockets</td>
                            <td>{formatCount(memoryData.fd?.sockets)}</td>
                          </tr>
                          <tr>
                            <td>FD Regular Files</td>
                            <td>{formatCount(memoryData.fd?.regular_files)}</td>
                          </tr>
                          <tr>
                            <td>FD Other</td>
                            <td>{formatCount(memoryData.fd?.other)}</td>
                          </tr>
                          <tr>
                            <td>Asyncio Tasks</td>
                            <td>{formatCount(memoryData.asyncio?.total)}</td>
                          </tr>
                          <tr>
                            <td>Asyncio Pending</td>
                            <td>{formatCount(memoryData.asyncio?.pending)}</td>
                          </tr>
                          <tr>
                            <td>Asyncio Done</td>
                            <td>{formatCount(memoryData.asyncio?.done)}</td>
                          </tr>
                          <tr>
                            <td>GC Count</td>
                            <td>{Array.isArray(memoryData.gc.count) ? memoryData.gc.count.join(' / ') : '—'}</td>
                          </tr>
                          <tr>
                            <td>GC Threshold</td>
                            <td>{Array.isArray(memoryData.gc.threshold) ? memoryData.gc.threshold.join(' / ') : '—'}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="admin-memory-table">
                    <h3>Top Types by Count (gen-2)</h3>
                    <table>
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {memoryData.gc.top_types_by_count.map((entry) => (
                          <tr key={entry.type}>
                            <td>{entry.type}</td>
                            <td>{entry.count.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {memoryData.tracemalloc.enabled && memoryData.tracemalloc.top_allocations && (
                    <div className="admin-memory-table">
                      <h3>Top Allocations</h3>
                      <table>
                        <thead>
                          <tr>
                            <th>Location</th>
                            <th>Size</th>
                            <th>Count</th>
                          </tr>
                        </thead>
                        <tbody>
                          {memoryData.tracemalloc.top_allocations.map((entry, idx) => (
                            <tr key={`${entry.location}-${idx}`}>
                              <td className="admin-memory-table__location">{entry.location}</td>
                              <td>{formatBytes(entry.size_bytes)}</td>
                              <td>{entry.count.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="admin-page__loading">
                <Loading text="Loading memory diagnostics..." />
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
};

export default AdminPage;
