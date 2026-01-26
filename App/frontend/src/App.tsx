import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from './store/settingsStore';
import { useTheme } from './hooks/useTheme';
import { NotificationModals } from './components/Notification';
import { registerLLMModals } from './llmTask/notificationHelpers';
import { registerJourneyModals } from './llmTaskJourney/notificationHelpers';
import { registerImageTaskModals } from './imageTask';
import './App.css';

// Register notification modal renderers at module load (push-based - no subscribers)
registerLLMModals();
registerJourneyModals();
registerImageTaskModals();

function App() {
  const loadFromServer = useSettingsStore((state) => state.loadFromServer);
  const uiLanguage = useSettingsStore((state) => state.settings.uiLanguage);
  const { i18n } = useTranslation();

  // Initialize theme system
  useTheme();

  // Sync i18n language with settings
  useEffect(() => {
    if (uiLanguage && i18n.language !== uiLanguage) {
      i18n.changeLanguage(uiLanguage);
    }
  }, [uiLanguage, i18n]);

  useEffect(() => {
    // Prevent theme flash on initial load
    document.documentElement.classList.add('no-transitions');

    // Load settings from server on app start
    loadFromServer().catch((error: Error) => {
      console.warn('Failed to load settings from server, using local:', error);
      // Continue with local settings if server fails
    });

    // Remove no-transitions class after a brief delay
    const timer = setTimeout(() => {
      document.documentElement.classList.remove('no-transitions');
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="app">
      <main className="main-content">
        <Outlet />
      </main>
      <NotificationModals />
    </div>
  );
}

export default App;
