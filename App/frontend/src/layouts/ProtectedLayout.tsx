import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import { useSettings, useSettingsStore } from '../store/settingsStore';
import { useNotificationStore } from '../store/notificationStore';
import { notificationService } from '../api/notificationService';
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
  const hydrateNotifications = useNotificationStore((state) => state.hydrate);

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
    let cancelled = false;

    void startUserRuntime().catch((error) => {
      console.warn('Failed to start user runtime stream', { error });
    });

    void notificationService.list({
      limit: 50,
      offset: 0,
      includeRead: true,
    }).then((response) => {
      if (cancelled) return;
      hydrateNotifications(response.items);
    }).catch((error) => {
      if (cancelled) return;
      console.warn('Failed to hydrate notifications', { error });
    });

    return () => {
      cancelled = true;
      stopUserRuntime();
    };
  }, [hydrateNotifications]);

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
  const loadSettings = useSettingsStore((state) => state.loadFromServer);
  const clearSettings = useSettingsStore((state) => state.clearSettings);
  const settingsStatus = useSettingsStore((state) => state.status);
  const settingsError = useSettingsStore((state) => state.error);

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

  useEffect(() => {
    if (!authChecked) return;

    if (!isAuthenticated) {
      clearSettings();
      return;
    }

    if (settingsStatus === 'idle') {
      loadSettings().catch(() => {
        // Fail-closed: store will be in `error` state; UI renders fatal screen.
      });
    }
  }, [authChecked, isAuthenticated, settingsStatus, loadSettings, clearSettings]);

  if (!authChecked) {
    return <Loading fullPage text="Checking authentication..." />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (settingsStatus === 'error') {
    return (
      <FatalSettingsError
        message={settingsError ?? 'Unknown error'}
        onReload={() => window.location.reload()}
      />
    );
  }

  if (settingsStatus !== 'ready') {
    return <Loading fullPage text="Loading settings..." />;
  }

  return <ProtectedAppShell />;
}

