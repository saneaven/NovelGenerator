import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { useSettings, settingsQueryOptions } from '../data/settings';
import { queryClient } from '../data/queryClient';
import { useTheme } from '../hooks/useTheme';
import { Loading } from '../components/common/Loading';
import { NotificationModals } from '../components/Notification';
import { NotificationToastManager } from '../components/ActivityPanel/NotificationToastManager';
import ConfirmModal from '../components/Modal/ConfirmModal';
import { startUserRuntime, stopUserRuntime } from '../runtime/runtimeStream';
import '../App.css';

function ProtectedAppShell() {
  const settings = useSettings();
  const { i18n } = useTranslation();

  // Initialize theme system (depends on loaded settings)
  useTheme();

  // Sync i18n language with settings
  useEffect(() => {
    const uiLanguage = settings.uiLanguage;
    if (uiLanguage && i18n.language !== uiLanguage) {
      i18n.changeLanguage(uiLanguage);
    }
  }, [settings.uiLanguage, i18n]);

  useEffect(() => {
    void startUserRuntime().catch((error) => {
      console.warn('Failed to start user runtime stream', { error });
    });

    return () => {
      stopUserRuntime();
    };
  }, []);

  return (
    <div className="app">
      <main className="main-content">
        <Outlet />
      </main>
      <NotificationModals />
      <NotificationToastManager />
      <ConfirmModal />
    </div>
  );
}

function FatalSettingsError({ message, onReload }: { message: string; onReload: () => void }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <div style={{ maxWidth: 720 }}>
        <h1 style={{ margin: 0, marginBottom: '0.75rem' }}>Failed to load settings</h1>
        <p style={{ margin: 0, marginBottom: '1rem', opacity: 0.8 }}>{message}</p>
        <button onClick={onReload} className="btn-primary">
          Reload
        </button>
      </div>
    </div>
  );
}

export default function ProtectedLayout() {
  const location = useLocation();

  const { isAuthenticated, checkAuth } = useAuthStore();

  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await checkAuth();
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkAuth]);

  // Settings load once per authenticated session (staleTime: Infinity); the
  // query is gated on auth so it never fires for logged-out users.
  const settingsQuery = useQuery({
    ...settingsQueryOptions,
    enabled: authChecked && isAuthenticated,
  });

  // Drop ALL cached server data when the user is not authenticated (covers
  // token-expiry deauth; logout clears the cache directly).
  useEffect(() => {
    if (authChecked && !isAuthenticated) {
      queryClient.clear();
    }
  }, [authChecked, isAuthenticated]);

  if (!authChecked) {
    return <Loading fullPage text="Checking authentication..." />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (settingsQuery.isError) {
    return (
      <FatalSettingsError
        message={settingsQuery.error instanceof Error ? settingsQuery.error.message : 'Unknown error'}
        onReload={() => window.location.reload()}
      />
    );
  }

  if (!settingsQuery.isSuccess) {
    return <Loading fullPage text="Loading settings..." />;
  }

  return <ProtectedAppShell />;
}

