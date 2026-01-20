import React, { useState, useEffect } from 'react';
import { BaseModal } from '../BaseModal';
import { BaseSidebar } from '../BaseSidebar';
import { useSettingsStore } from '../../store/settingsStore';
import { useCredentialsStore } from '../../store/credentialsStore';
import { useSidebarStore } from '../../store/sidebarStore';
import type { ProviderCredentials, Settings, AIFunctionType } from '../../store/settingsStore';
import CredentialsPanel from './CredentialsPanel';
import GeneralPanel from './GeneralPanel';
import LanguagePanel from './LanguagePanel';
import PromptsTemplatesPanel from './PromptsTemplatesPanel';
import ThemePanel from './ThemePanel';
import AdvancedPanel from './AdvancedPanel';
import ImageGenPanel from './ImageGenPanel';
import ProfilePanel from './ProfilePanel';
import { Settings as SettingsIcon, Lock, Image, Document, Globe, Palette, Wrench, HamburgerMenu, People } from '../icons';
import { TextButton } from '../TextButton';
import './SettingsModal.css';
import './_shared-components.css';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type MainTab = 'profile' | 'credentials' | 'general' | 'imageGen' | 'prompts' | 'language' | 'theme' | 'advanced';

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const settingsStore = useSettingsStore();
  const credentialsStore = useCredentialsStore();
  const [localSettings, setLocalSettings] = useState<Settings>(settingsStore.settings);
  const [localCredentials, setLocalCredentials] = useState<ProviderCredentials>(credentialsStore.credentials);
  const [localServerVaultEnabled, setLocalServerVaultEnabled] = useState<boolean>(credentialsStore.serverVaultEnabled);
  const [isSaving, setIsSaving] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>('profile');
  const [activeFunction, setActiveFunction] = useState<AIFunctionType>('agent');

  // Mobile sidebar state from store
  const openSidebar = useSidebarStore((state) => state.openSidebar);
  const closeSidebar = useSidebarStore((state) => state.closeSidebar);

  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settingsStore.settings);
      setLocalCredentials(credentialsStore.credentials);
      setLocalServerVaultEnabled(credentialsStore.serverVaultEnabled);
      credentialsStore.fetchServerStatus().catch(() => {
        // Ignore - status is best-effort
      });
    }
  }, [isOpen, settingsStore.settings]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      settingsStore.updateSettings(localSettings);
      await settingsStore.saveToServer();

      credentialsStore.setCredentials(localCredentials);
      credentialsStore.setServerVaultEnabled(localServerVaultEnabled);

      if (localServerVaultEnabled) {
        await credentialsStore.pushToServerIfEnabled();
      } else {
        // Turning off server vault implies no server-side storage.
        await credentialsStore.deleteServerCredentials();
      }
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
    setLocalCredentials(credentialsStore.credentials);
    setLocalServerVaultEnabled(credentialsStore.serverVaultEnabled);
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
        <button
          className="settings-hamburger-btn"
          onClick={() => openSidebar('__global__', 'settings-nav')}
          aria-label="Open navigation menu"
        >
          <HamburgerMenu size="md" />
        </button>
        <h2><SettingsIcon size="xl" /> Settings</h2>
        <button className="close-button" onClick={handleCancel}>
          ×
        </button>
      </div>

      {/* Mobile Sidebar Navigation */}
      <BaseSidebar
        id="settings-nav"
        position="left"
        className="settings-mobile-sidebar"
        header={<h3 className="settings-mobile-sidebar-title">Settings</h3>}
        onClose={() => closeSidebar('__global__')}
      >
        <ul className="settings-mobile-sidebar-list">
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'profile' ? 'active' : ''}`}
              onClick={() => { setMainTab('profile'); closeSidebar('__global__'); }}
            >
              <People size="md" />
              <span>Profile</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'credentials' ? 'active' : ''}`}
              onClick={() => { setMainTab('credentials'); closeSidebar('__global__'); }}
            >
              <Lock size="md" />
              <span>Credentials</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'general' ? 'active' : ''}`}
              onClick={() => { setMainTab('general'); closeSidebar('__global__'); }}
            >
              <SettingsIcon size="md" />
              <span>General</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'imageGen' ? 'active' : ''}`}
              onClick={() => { setMainTab('imageGen'); closeSidebar('__global__'); }}
            >
              <Image size="md" />
              <span>Image Gen</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'prompts' ? 'active' : ''}`}
              onClick={() => { setMainTab('prompts'); closeSidebar('__global__'); }}
            >
              <Document size="md" />
              <span>Prompts & Templates</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'language' ? 'active' : ''}`}
              onClick={() => { setMainTab('language'); closeSidebar('__global__'); }}
            >
              <Globe size="md" />
              <span>Language</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'theme' ? 'active' : ''}`}
              onClick={() => { setMainTab('theme'); closeSidebar('__global__'); }}
            >
              <Palette size="md" />
              <span>Theme</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'advanced' ? 'active' : ''}`}
              onClick={() => { setMainTab('advanced'); closeSidebar('__global__'); }}
            >
              <Wrench size="md" />
              <span>Advanced</span>
            </button>
          </li>
        </ul>
      </BaseSidebar>

      {/* Main Category Tabs */}
      <div className="main-tabs">
        <button
          className={`main-tab ${mainTab === 'profile' ? 'active' : ''}`}
          onClick={() => setMainTab('profile')}
        >
          <span className="tab-icon"><People size="sm" /></span>
          <span className="tab-label">Profile</span>
        </button>
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
        {mainTab === 'profile' && <ProfilePanel />}

        {mainTab === 'credentials' && (
          <CredentialsPanel
            credentials={localCredentials}
            onChange={setLocalCredentials}
          />
        )}

        {mainTab === 'general' && (
          <GeneralPanel
            functionConfigs={localSettings.functionConfigs}
            credentials={localCredentials}
            serverVaultEnabled={localServerVaultEnabled}
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
            serverVaultEnabled={localServerVaultEnabled}
            onServerVaultEnabledChange={setLocalServerVaultEnabled}
            vaultStatus={credentialsStore.serverStatus}
            vaultSyncing={credentialsStore.isSyncing}
            onVaultRefresh={() => credentialsStore.fetchServerStatus()}
            onVaultDelete={() => credentialsStore.deleteServerCredentials()}
            nativeOutputMode={localSettings.nativeOutputMode}
            onNativeOutputModeChange={(enabled) =>
              setLocalSettings(prev => ({ ...prev, nativeOutputMode: enabled }))
            }
            functionCallHistoryLimit={localSettings.functionCallHistoryLimit}
            onFunctionCallHistoryLimitChange={(limit) =>
              setLocalSettings(prev => ({ ...prev, functionCallHistoryLimit: limit }))
            }
            thinkingHistoryLimit={localSettings.thinkingHistoryLimit}
            onThinkingHistoryLimitChange={(limit) =>
              setLocalSettings(prev => ({ ...prev, thinkingHistoryLimit: limit }))
            }
          />
        )}
      </div>
    </BaseModal>
  );
};

export default SettingsModal;
