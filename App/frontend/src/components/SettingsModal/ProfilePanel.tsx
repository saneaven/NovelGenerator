import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { People, Lock } from '../icons';
import { TextButton } from '../TextButton';
import './ProfilePanel.css';

const ProfilePanel: React.FC = () => {
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
      setProfileError('Username is required');
      return;
    }
    if (username.trim().length < 3) {
      setProfileError('Username must be at least 3 characters');
      return;
    }
    if (!email.trim()) {
      setProfileError('Email is required');
      return;
    }

    // Check if anything changed
    if (username === user?.username && email === user?.email) {
      setProfileError('No changes to save');
      return;
    }

    try {
      await updateProfile({
        username: username !== user?.username ? username : undefined,
        email: email !== user?.email ? email : undefined,
      });
      setProfileSuccess('Profile updated successfully');
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Failed to update profile');
    }
  };

  const handleChangePassword = async () => {
    setPasswordError(null);
    setPasswordSuccess(null);

    // Validation
    if (!currentPassword) {
      setPasswordError('Current password is required');
      return;
    }
    if (!newPassword) {
      setPasswordError('New password is required');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    try {
      await changePassword(currentPassword, newPassword);
      setPasswordSuccess('Password changed successfully');
      // Clear password fields
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to change password');
    }
  };

  return (
    <div className="profile-panel">
      <div className="panel-description">
        <p>Manage your account information and security settings.</p>
      </div>

      {/* Profile Information Card */}
      <div className="profile-settings-card">
        <h3 className="section-title">
          <People size="md" /> Profile Information
        </h3>

        <div className="form-field">
          <label>Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter username"
            disabled={isLoading}
          />
          <span className="field-hint">Minimum 3 characters</span>
        </div>

        <div className="form-field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter email"
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
            {isLoading ? 'Updating...' : 'Update Profile'}
          </TextButton>
        </div>
      </div>

      {/* Password Change Card */}
      <div className="profile-settings-card">
        <h3 className="section-title">
          <Lock size="md" /> Change Password
        </h3>

        <div className="form-field">
          <label>Current Password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Enter current password"
            disabled={isLoading}
          />
        </div>

        <div className="form-field">
          <label>New Password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Enter new password"
            disabled={isLoading}
          />
          <span className="field-hint">Minimum 8 characters</span>
        </div>

        <div className="form-field">
          <label>Confirm New Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
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
            {isLoading ? 'Changing...' : 'Change Password'}
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
