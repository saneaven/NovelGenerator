import React, { useState, useEffect } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import type { Settings, AIFunctionType } from '../../store/settingsStore';
import CredentialsPanel from './CredentialsPanel';
import GeneralPanel from './GeneralPanel';
import LanguagePanel from './LanguagePanel';
import PromptsTemplatesPanel from './PromptsTemplatesPanel';
import ThemePanel from './ThemePanel';
import AdvancedPanel from './AdvancedPanel';
import ImageGenPanel from './ImageGenPanel';
import './SettingsModal.css';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type MainTab = 'credentials' | 'general' | 'imageGen' | 'prompts' | 'language' | 'theme' | 'advanced';

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const settingsStore = useSettingsStore();
  const [localSettings, setLocalSettings] = useState<Settings>(settingsStore.settings);
  const [isSaving, setIsSaving] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>('general');
  const [activeFunction, setActiveFunction] = useState<AIFunctionType>('chat');

  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settingsStore.settings);
    }
  }, [isOpen, settingsStore.settings]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      settingsStore.updateSettings(localSettings);
      await settingsStore.saveToServer();
      onClose();
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('Failed to save settings to server. Changes are saved locally.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setLocalSettings(settingsStore.settings);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content settings-modal-new" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <h2>⚙️ Settings</h2>
          <button className="close-button" onClick={handleCancel}>
            ×
          </button>
        </div>

        {/* Main Category Tabs */}
        <div className="main-tabs">
          <button
            className={`main-tab ${mainTab === 'credentials' ? 'active' : ''}`}
            onClick={() => setMainTab('credentials')}
          >
            <span className="tab-icon">🔐</span>
            <span className="tab-label">Credentials</span>
          </button>
          <button
            className={`main-tab ${mainTab === 'general' ? 'active' : ''}`}
            onClick={() => setMainTab('general')}
          >
            <span className="tab-icon">⚙️</span>
            <span className="tab-label">General</span>
          </button>
          <button
            className={`main-tab ${mainTab === 'imageGen' ? 'active' : ''}`}
            onClick={() => setMainTab('imageGen')}
          >
            <span className="tab-icon">🖼️</span>
            <span className="tab-label">Image Gen</span>
          </button>
          <button
            className={`main-tab ${mainTab === 'prompts' ? 'active' : ''}`}
            onClick={() => setMainTab('prompts')}
          >
            <span className="tab-icon">📝</span>
            <span className="tab-label">Prompts & Templates</span>
          </button>
          <button
            className={`main-tab ${mainTab === 'language' ? 'active' : ''}`}
            onClick={() => setMainTab('language')}
          >
            <span className="tab-icon">🌐</span>
            <span className="tab-label">Language</span>
          </button>
          <button
            className={`main-tab ${mainTab === 'theme' ? 'active' : ''}`}
            onClick={() => setMainTab('theme')}
          >
            <span className="tab-icon">🎨</span>
            <span className="tab-label">Theme</span>
          </button>
          <button
            className={`main-tab ${mainTab === 'advanced' ? 'active' : ''}`}
            onClick={() => setMainTab('advanced')}
          >
            <span className="tab-icon">🔧</span>
            <span className="tab-label">Advanced</span>
          </button>
        </div>

        {/* Panel Content */}
        <div className="modal-body">
          {mainTab === 'credentials' && (
            <CredentialsPanel
              credentials={localSettings.providerCredentials}
              onChange={(credentials) =>
                setLocalSettings({ ...localSettings, providerCredentials: credentials })
              }
            />
          )}

          {mainTab === 'general' && (
            <GeneralPanel
              functionConfigs={localSettings.functionConfigs}
              credentials={localSettings.providerCredentials}
              activeFunction={activeFunction}
              onFunctionChange={setActiveFunction}
              onConfigChange={(functionType, config) =>
                setLocalSettings({
                  ...localSettings,
                  functionConfigs: {
                    ...localSettings.functionConfigs,
                    [functionType]: config,
                  },
                })
              }
            />
          )}

          {mainTab === 'imageGen' && (
            <ImageGenPanel
              config={localSettings.imageGenConfig}
              onChange={(config) =>
                setLocalSettings({ ...localSettings, imageGenConfig: config })
              }
            />
          )}

          {mainTab === 'language' && (
            <LanguagePanel
              mainLanguage={localSettings.mainLanguage}
              subLanguages={localSettings.subLanguages}
              defaultSubLanguage={localSettings.defaultSubLanguage}
              onMainLanguageChange={(language) =>
                setLocalSettings(prev => ({ ...prev, mainLanguage: language }))
              }
              onSubLanguagesChange={(languages) =>
                setLocalSettings(prev => ({ ...prev, subLanguages: languages }))
              }
              onDefaultSubLanguageChange={(language) =>
                setLocalSettings(prev => ({ ...prev, defaultSubLanguage: language }))
              }
            />
          )}

          {mainTab === 'theme' && (
            <ThemePanel
              theme={localSettings.theme}
              onThemeChange={(theme) => {
                // Update local settings for consistency
                setLocalSettings({ ...localSettings, theme });
                // Apply theme immediately to global store
                settingsStore.setTheme(theme);
              }}
            />
          )}

          {mainTab === 'prompts' && <PromptsTemplatesPanel />}

          {mainTab === 'advanced' && (
            <AdvancedPanel
              retryConfig={localSettings.retryConfig}
              onRetryConfigChange={(config) =>
                setLocalSettings(prev => ({ ...prev, retryConfig: config }))
              }
            />
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button onClick={handleCancel} className="btn-secondary" disabled={isSaving}>
            Cancel
          </button>
          <button onClick={handleSave} className="btn-primary" disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
