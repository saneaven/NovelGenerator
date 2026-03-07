import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { adminService, type AdminUserStorageItem } from '../../api';
import { useAuthStore } from '../../store/authStore';
import { Loading } from '../../components/common/Loading';
import { TextButton } from '../../components/TextButton';
import { CustomSelect } from '../../components/ui/CustomSelect';
import { ArrowLeft, People, Refresh, Star, Warning } from '../../components/icons';
import { StorageUsageSummary, formatBytes } from '../../components/StorageUsageSummary';
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
      </main>
    </div>
  );
};

export default AdminPage;
