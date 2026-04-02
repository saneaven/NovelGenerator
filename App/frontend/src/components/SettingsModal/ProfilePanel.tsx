import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';
import { People, Lock, Image as ImageIcon } from '../icons';
import { TextButton } from '../TextButton';
import './ProfilePanel.css';
import { accountService, type AccountStorageResponse, type ProjectStorageBreakdown } from '../../api';
import { StorageUsageSummary, formatBytes, type StorageUsageBreakdownDetail } from '../StorageUsageSummary';

function formatProjectStorageDetails(
  project: ProjectStorageBreakdown,
  t: (key: string, options?: Record<string, unknown>) => string,
): StorageUsageBreakdownDetail[] {
  const items = [
    {
      id: 'images',
      label: t('settings.profile.storageCategoryImages'),
      value: formatBytes(project.categories.image_bytes),
      bytes: project.categories.image_bytes,
    },
    {
      id: 'story',
      label: t('settings.profile.storageCategoryStory'),
      value: formatBytes(project.categories.story_bytes),
      bytes: project.categories.story_bytes,
    },
    {
      id: 'project-meta',
      label: t('settings.profile.storageCategoryProjectMeta'),
      value: formatBytes(project.categories.project_meta_bytes),
      bytes: project.categories.project_meta_bytes,
    },
    {
      id: 'manuscripts',
      label: t('settings.profile.storageCategoryManuscripts'),
      value: formatBytes(project.categories.manuscript_bytes),
      bytes: project.categories.manuscript_bytes,
    },
    {
      id: 'chat',
      label: t('settings.profile.storageCategoryChat'),
      value: formatBytes(project.categories.chat_bytes),
      bytes: project.categories.chat_bytes,
    },
    {
      id: 'notifications',
      label: t('settings.profile.storageCategoryNotifications'),
      value: formatBytes(project.categories.notification_bytes),
      bytes: project.categories.notification_bytes,
    },
    {
      id: 'image-runs',
      label: t('settings.profile.storageCategoryImageRuns'),
      value: formatBytes(project.categories.image_run_bytes),
      bytes: project.categories.image_run_bytes,
    },
    {
      id: 'llm-requests',
      label: t('settings.profile.storageCategoryLLMLogs'),
      value: formatBytes(project.categories.llm_log_bytes),
      bytes: project.categories.llm_log_bytes,
    },
  ];

  return items
    .filter((item) => item.bytes > 0)
    .map(({ bytes: _bytes, ...detail }) => detail);
}

const ProfilePanel: React.FC = () => {
  const { t } = useTranslation();
  const { user, isLoading, error, updateProfile, changePassword, clearError } = useAuthStore();

  // Profile form state
  const [username, setUsername] = useState(user?.username || '');
  const [email, setEmail] = useState(user?.email || '');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  // Password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  // Storage usage state
  const [storage, setStorage] = useState<AccountStorageResponse | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  // Sync form with user data
  useEffect(() => {
    if (user) {
      setUsername(user.username);
      setEmail(user.email);
    }
  }, [user]);

  // Clear store error on unmount
  useEffect(() => {
    return () => clearError();
  }, [clearError]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    setStorageLoading(true);
    setStorageError(null);

    accountService
      .getStorage()
      .then((data) => {
        if (cancelled) return;
        setStorage(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setStorageError(err instanceof Error ? err.message : t('settings.profile.storageLoadFailed'));
      })
      .finally(() => {
        if (cancelled) return;
        setStorageLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [t, user]);

  const handleUpdateProfile = async () => {
    setProfileError(null);
    setProfileSuccess(null);

    // Validation
    if (!username.trim()) {
      setProfileError(t('settings.profile.usernameRequired'));
      return;
    }
    if (username.trim().length < 3) {
      setProfileError(t('settings.profile.usernameMinLength'));
      return;
    }
    if (!email.trim()) {
      setProfileError(t('settings.profile.emailRequired'));
      return;
    }

    // Check if anything changed
    if (username === user?.username && email === user?.email) {
      setProfileError(t('settings.profile.noChanges'));
      return;
    }

    try {
      await updateProfile({
        username: username !== user?.username ? username : undefined,
        email: email !== user?.email ? email : undefined,
      });
      setProfileSuccess(t('settings.profile.profileUpdated'));
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : t('settings.profile.updateFailed'));
    }
  };

  const handleChangePassword = async () => {
    setPasswordError(null);
    setPasswordSuccess(null);

    // Validation
    if (!currentPassword) {
      setPasswordError(t('settings.profile.currentPasswordRequired'));
      return;
    }
    if (!newPassword) {
      setPasswordError(t('settings.profile.newPasswordRequired'));
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError(t('settings.profile.newPasswordMinLength'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('settings.profile.passwordsNotMatch'));
      return;
    }

    try {
      await changePassword(currentPassword, newPassword);
      setPasswordSuccess(t('settings.profile.passwordChanged'));
      // Clear password fields
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : t('settings.profile.passwordChangeFailed'));
    }
  };

  return (
    <div className="profile-panel">
      <div className="panel-header">
        <h3>{t('settings.profile.title')}</h3>
        <p className="panel-description">{t('settings.profile.description')}</p>
      </div>

      {/* Profile Information Card */}
      <div className="settings-panel-card">
        <h3 className="section-title">
          <People size="md" /> {t('settings.profile.profileInformation')}
        </h3>

        <div className="form-field">
          <label>{t('settings.profile.username')}</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t('settings.profile.enterUsername')}
            disabled={isLoading}
          />
          <span className="field-hint">{t('settings.profile.usernameHint')}</span>
        </div>

        <div className="form-field">
          <label>{t('settings.profile.email')}</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('settings.profile.enterEmail')}
            disabled={isLoading}
          />
        </div>

        {profileError && <div className="form-error">{profileError}</div>}
        {profileSuccess && <div className="form-success">{profileSuccess}</div>}

        <div className="action-buttons-row">
          <TextButton
            variant="primary"
            onClick={handleUpdateProfile}
            disabled={isLoading}
          >
            {isLoading ? t('settings.profile.updating') : t('settings.profile.updateProfile')}
          </TextButton>
        </div>
      </div>

      {/* Storage Usage Card */}
      <div className="settings-panel-card">
        <h3 className="section-title">
          <ImageIcon size="md" /> {t('settings.profile.storage')}
        </h3>

        {storageLoading && <div className="field-hint">{t('settings.profile.storageLoading')}</div>}
        {storageError && <div className="form-error">{storageError}</div>}

        {storage && (
          <StorageUsageSummary
            usedBytes={storage.used_bytes}
            remainingBytes={storage.remaining_bytes}
            quotaBytes={storage.quota_bytes}
            percentUsed={storage.percent_used}
            labels={{
              used: t('settings.profile.storageUsed'),
              remaining: t('settings.profile.storageRemaining'),
              quota: t('settings.profile.storageQuota'),
              breakdownTitle: t('settings.profile.storageByProject'),
            }}
            breakdownItems={storage.by_project.map((project) => ({
              id: project.project_id,
              name: project.project_name,
              meta: formatBytes(project.used_bytes),
              details: formatProjectStorageDetails(project, t),
              detailToggleLabel: t('settings.profile.storageProjectDetailsToggle', {
                project: project.project_name,
              }),
            }))}
          />
        )}
      </div>

      {/* Password Change Card */}
      <div className="settings-panel-card">
        <h3 className="section-title">
          <Lock size="md" /> {t('settings.profile.changePassword')}
        </h3>

        <div className="form-field">
          <label>{t('settings.profile.currentPassword')}</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder={t('settings.profile.enterCurrentPassword')}
            disabled={isLoading}
          />
        </div>

        <div className="form-field">
          <label>{t('settings.profile.newPassword')}</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={t('settings.profile.enterNewPassword')}
            disabled={isLoading}
          />
          <span className="field-hint">{t('settings.profile.newPasswordHint')}</span>
        </div>

        <div className="form-field">
          <label>{t('settings.profile.confirmNewPassword')}</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t('settings.profile.confirmNewPasswordPlaceholder')}
            disabled={isLoading}
          />
        </div>

        {passwordError && <div className="form-error">{passwordError}</div>}
        {passwordSuccess && <div className="form-success">{passwordSuccess}</div>}

        <div className="action-buttons-row">
          <TextButton
            variant="primary"
            onClick={handleChangePassword}
            disabled={isLoading}
          >
            {isLoading ? t('settings.profile.changingPassword') : t('settings.profile.changePassword')}
          </TextButton>
        </div>
      </div>

      {/* Store-level error display */}
      {error && !profileError && !passwordError && (
        <div className="form-error store-error">{error}</div>
      )}
    </div>
  );
};

export default ProfilePanel;
