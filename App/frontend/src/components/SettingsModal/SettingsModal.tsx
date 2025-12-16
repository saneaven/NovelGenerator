import React, { useState, useEffect } from 'react';
import { BaseModal } from '../BaseModal';
import { useSettingsStore } from '../../store/settingsStore';
import type { Settings, AIFunctionType } from '../../store/settingsStore';
import CredentialsPanel from './CredentialsPanel';
import GeneralPanel from './GeneralPanel';
import LanguagePanel from './LanguagePanel';
import PromptsTemplatesPanel from './PromptsTemplatesPanel';
import ThemePanel from './ThemePanel';
import AdvancedPanel from './AdvancedPanel';
import ImageGenPanel from './ImageGenPanel';
import { Settings as SettingsIcon, Lock, Image, Document, Globe, Palette, Wrench } from '../icons';
import { TextButton } from '../TextButton';
import './SettingsModal.css';
import './_shared-components.css';

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

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleCancel}
      size="large"
      showHeader={false}
      className="settings-modal"
      footer={
        <>
          <TextButton variant="secondary" onClick={handleCancel} disabled={isSaving}>
            Cancel
          </TextButton>
          <TextButton variant="primary" onClick={handleSave} disabled={isSaving} loading={isSaving}>
            {isSaving ? 'Saving...' : 'Save Settings'}
          </TextButton>
        </>
      }
    >
      {/* Custom Header */}
      <div className="settings-modal-header">
        <h2><SettingsIcon size="xl" /> Settings</h2>
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
          <span className="tab-icon"><Lock size="sm" /></span>
          <span className="tab-label">Credentials</span>
        </button>
        <button
          className={`main-tab ${mainTab === 'general' ? 'active' : ''}`}
          onClick={() => setMainTab('general')}
        >
          <span className="tab-icon"><SettingsIcon size="sm" /></span>
          <span className="tab-label">General</span>
        </button>
        <button
          className={`main-tab ${mainTab === 'imageGen' ? 'active' : ''}`}
          onClick={() => setMainTab('imageGen')}
        >
          <span className="tab-icon"><Image size="sm" /></span>
          <span className="tab-label">Image Gen</span>
        </button>
        <button
          className={`main-tab ${mainTab === 'prompts' ? 'active' : ''}`}
          onClick={() => setMainTab('prompts')}
        >
          <span className="tab-icon"><Document size="sm" /></span>
          <span className="tab-label">Prompts & Templates</span>
        </button>
        <button
          className={`main-tab ${mainTab === 'language' ? 'active' : ''}`}
          onClick={() => setMainTab('language')}
        >
          <span className="tab-icon"><Globe size="sm" /></span>
          <span className="tab-label">Language</span>
        </button>
        <button
          className={`main-tab ${mainTab === 'theme' ? 'active' : ''}`}
          onClick={() => setMainTab('theme')}
        >
          <span className="tab-icon"><Palette size="sm" /></span>
          <span className="tab-label">Theme</span>
        </button>
        <button
          className={`main-tab ${mainTab === 'advanced' ? 'active' : ''}`}
          onClick={() => setMainTab('advanced')}
        >
          <span className="tab-icon"><Wrench size="sm" /></span>
          <span className="tab-label">Advanced</span>
        </button>
      </div>

      {/* Panel Content */}
      <div className="settings-panel-content">
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
            nativeOutputMode={localSettings.nativeOutputMode}
            onNativeOutputModeChange={(enabled) =>
              setLocalSettings(prev => ({ ...prev, nativeOutputMode: enabled }))
            }
          />
        )}
      </div>
    </BaseModal>
  );
};

export default SettingsModal;
