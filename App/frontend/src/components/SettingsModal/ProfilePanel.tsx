import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';
import { People, Lock } from '../icons';
import { TextButton } from '../TextButton';
import './ProfilePanel.css';

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

    if (!window.confirm(t('settings.profile.passwordChangeBackupConfirm'))) {
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

        <p className="field-hint">{t('settings.profile.passwordChangeBackupWarning')}</p>

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
