import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useSettingsStore } from './store/settingsStore';
import { useTheme } from './hooks/useTheme';
import { NotificationModals } from './components/Notification';
import { initLLMNotificationSubscriber } from './llmTask/notificationSubscriber';
import { initImageNotificationSubscriber } from './imageGeneration/notificationSubscriber';
import './App.css';

// Initialize notification subscribers at module load
initLLMNotificationSubscriber();
initImageNotificationSubscriber();

function App() {
  const settingsStore = useSettingsStore();

  // Initialize theme system
  useTheme();

  useEffect(() => {
    // Prevent theme flash on initial load
    document.documentElement.classList.add('no-transitions');

    // Load settings from server on app start
    settingsStore.loadFromServer().catch((error) => {
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

