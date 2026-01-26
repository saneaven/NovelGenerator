import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseModal } from '../BaseModal';
import { BaseSidebar } from '../BaseSidebar';
import { useSettingsStore } from '../../store/settingsStore';
import { useCredentialsStore } from '../../store/credentialsStore';
import { useSidebarStore } from '../../store/sidebarStore';
import type { ProviderCredentials, Settings, AITaskType, ProviderType } from '../../store/settingsStore';
import { ragService, type RagEmbeddingProfile } from '../../api/ragService';
import CredentialsPanel from './CredentialsPanel';
import GeneralPanel from './GeneralPanel';
import LanguagePanel from './LanguagePanel';
import PromptsTemplatesPanel from './PromptEditor/PromptsTemplatesPanel';
import ThemePanel from './ThemePanel';
import AdvancedPanel from './AdvancedPanel';
import ImageGenPanel from './ImageGenPanel';
import ProfilePanel from './ProfilePanel';
import RagSearchPanel from './RagSearchPanel';
import { Settings as SettingsIcon, Lock, Image, Document, Globe, Palette, Wrench, HamburgerMenu, People, List } from '../icons';
import { TextButton } from '../TextButton';
import './SettingsModal.css';
import './_shared-components.css';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type MainTab =
  | 'profile'
  | 'credentials'
  | 'ragSearch'
  | 'general'
  | 'imageGen'
  | 'prompts'
  | 'language'
  | 'theme'
  | 'advanced';

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const settingsStore = useSettingsStore();
  const credentialsStore = useCredentialsStore();
  const [localSettings, setLocalSettings] = useState<Settings>(settingsStore.settings);
  const [localCredentials, setLocalCredentials] = useState<ProviderCredentials>(credentialsStore.credentials);
  const [savedRagProfile, setSavedRagProfile] = useState<RagEmbeddingProfile | null>(null);
  const [localRagProfile, setLocalRagProfile] = useState<{ provider: ProviderType; model: string }>({
    provider: 'openai',
    model: '',
  });
  const [isRagProfileLoading, setIsRagProfileLoading] = useState(false);
  const [ragProfileLoadError, setRagProfileLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>('profile');
  const [activeTask, setActiveTask] = useState<AITaskType>('agent');

  // Mobile sidebar state from store
  const openSidebar = useSidebarStore((state) => state.openSidebar);
  const closeSidebar = useSidebarStore((state) => state.closeSidebar);

  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settingsStore.settings);
      setLocalCredentials(credentialsStore.credentials);
      credentialsStore.fetchBackupStatus().catch(() => {
        // Ignore - status is best-effort
      });
    }
  }, [isOpen, settingsStore.settings]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setIsRagProfileLoading(true);
    setRagProfileLoadError(null);

    ragService
      .getProfile()
      .then((profile) => {
        if (cancelled) return;
        setSavedRagProfile(profile);
        if (profile) {
          setLocalRagProfile({ provider: profile.provider as ProviderType, model: profile.model });
        } else {
          setLocalRagProfile({ provider: 'openai', model: '' });
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        console.error('Failed to load RAG profile:', err);
        setSavedRagProfile(null);
        setLocalRagProfile({ provider: 'openai', model: '' });
        setRagProfileLoadError(String(err?.message || err || 'Failed to load profile'));
      })
      .finally(() => {
        if (cancelled) return;
        setIsRagProfileLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleSave = async () => {
    const ragProvider = String(localRagProfile.provider || '').trim();
    const ragModel = String(localRagProfile.model || '').trim();
    const ragEnabled = Boolean(localSettings.ragSearchEnabled);
    const ragChanged = savedRagProfile
      ? savedRagProfile.provider !== ragProvider || savedRagProfile.model !== ragModel
      : Boolean(ragProvider && ragModel);

    if (ragEnabled && (!ragProvider || !ragModel)) {
      alert(t('settings.ragSearch.saveValidationError'));
      return;
    }

    setIsSaving(true);
    try {
      settingsStore.updateSettings(localSettings);
      await settingsStore.saveToServer();

      credentialsStore.setCredentials(localCredentials);

      if (ragChanged && ragProvider && ragModel) {
        const updated = await ragService.updateProfile({ provider: ragProvider, model: ragModel });
        setSavedRagProfile(updated);
        setLocalRagProfile({ provider: updated.provider as ProviderType, model: updated.model });
      }

      // Show success toast
      setShowSavedToast(true);
      setTimeout(() => setShowSavedToast(false), 2000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert(t('settings.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setLocalSettings(settingsStore.settings);
    setLocalCredentials(credentialsStore.credentials);
    if (savedRagProfile) {
      setLocalRagProfile({ provider: savedRagProfile.provider as ProviderType, model: savedRagProfile.model });
    } else {
      setLocalRagProfile({ provider: 'openai', model: '' });
    }
    onClose();
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleCancel}
      size="full"
      showHeader={false}
      className="settings-modal"
      footer={
        <>
          <TextButton variant="secondary" onClick={handleCancel} disabled={isSaving}>
            {t('common.cancel')}
          </TextButton>
          <TextButton variant="primary" onClick={handleSave} disabled={isSaving} loading={isSaving}>
            {isSaving ? t('settings.saving') : t('settings.saveSettings')}
          </TextButton>
        </>
      }
    >
      {/* Success Toast */}
      {showSavedToast && (
        <div className="settings-saved-toast">
          {t('settings.savedSuccessfully')}
        </div>
      )}

      {/* Custom Header */}
      <div className="settings-modal-header">
        <button
          className="settings-hamburger-btn"
          onClick={() => openSidebar('__global__', 'settings-nav')}
          aria-label={t('settings.openNavigation')}
        >
          <HamburgerMenu size="md" />
        </button>
        <h2><SettingsIcon size="xl" /> {t('settings.title')}</h2>
        <button className="close-button" onClick={handleCancel}>
          ×
        </button>
      </div>

      {/* Mobile Sidebar Navigation */}
      <BaseSidebar
        id="settings-nav"
        position="left"
        className="settings-mobile-sidebar"
        header={<h3 className="settings-mobile-sidebar-title">{t('settings.title')}</h3>}
        onClose={() => closeSidebar('__global__')}
      >
        <ul className="settings-mobile-sidebar-list">
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'profile' ? 'active' : ''}`}
              onClick={() => { setMainTab('profile'); closeSidebar('__global__'); }}
            >
              <People size="md" />
              <span>{t('settings.tabs.profile')}</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'credentials' ? 'active' : ''}`}
              onClick={() => { setMainTab('credentials'); closeSidebar('__global__'); }}
            >
              <Lock size="md" />
              <span>{t('settings.tabs.credentials')}</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'general' ? 'active' : ''}`}
              onClick={() => { setMainTab('general'); closeSidebar('__global__'); }}
            >
              <SettingsIcon size="md" />
              <span>{t('settings.tabs.general')}</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'ragSearch' ? 'active' : ''}`}
              onClick={() => { setMainTab('ragSearch'); closeSidebar('__global__'); }}
            >
              <List size="md" />
              <span>{t('settings.tabs.ragSearch')}</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'imageGen' ? 'active' : ''}`}
              onClick={() => { setMainTab('imageGen'); closeSidebar('__global__'); }}
            >
              <Image size="md" />
              <span>{t('settings.tabs.imageGen')}</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'prompts' ? 'active' : ''}`}
              onClick={() => { setMainTab('prompts'); closeSidebar('__global__'); }}
            >
              <Document size="md" />
              <span>{t('settings.tabs.prompts')}</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'language' ? 'active' : ''}`}
              onClick={() => { setMainTab('language'); closeSidebar('__global__'); }}
            >
              <Globe size="md" />
              <span>{t('settings.tabs.language')}</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'theme' ? 'active' : ''}`}
              onClick={() => { setMainTab('theme'); closeSidebar('__global__'); }}
            >
              <Palette size="md" />
              <span>{t('settings.tabs.theme')}</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'advanced' ? 'active' : ''}`}
              onClick={() => { setMainTab('advanced'); closeSidebar('__global__'); }}
            >
              <Wrench size="md" />
              <span>{t('settings.tabs.advanced')}</span>
            </button>
          </li>
        </ul>
      </BaseSidebar>

      {/* Main content area with sidebar layout */}
      <div className="settings-modal-main">
        {/* Desktop Sidebar */}
        <aside className="settings-desktop-sidebar">
          <ul className="settings-desktop-sidebar-list">
            <li>
              <button
                className={`settings-desktop-sidebar-item ${mainTab === 'profile' ? 'active' : ''}`}
                onClick={() => setMainTab('profile')}
              >
                <People size="md" />
                <span>{t('settings.tabs.profile')}</span>
              </button>
            </li>
            <li>
              <button
                className={`settings-desktop-sidebar-item ${mainTab === 'credentials' ? 'active' : ''}`}
                onClick={() => setMainTab('credentials')}
              >
                <Lock size="md" />
                <span>{t('settings.tabs.credentials')}</span>
              </button>
            </li>
            <li>
              <button
                className={`settings-desktop-sidebar-item ${mainTab === 'general' ? 'active' : ''}`}
                onClick={() => setMainTab('general')}
              >
                <SettingsIcon size="md" />
                <span>{t('settings.tabs.general')}</span>
              </button>
            </li>
            <li>
              <button
                className={`settings-desktop-sidebar-item ${mainTab === 'ragSearch' ? 'active' : ''}`}
                onClick={() => setMainTab('ragSearch')}
              >
                <List size="md" />
                <span>{t('settings.tabs.ragSearch')}</span>
              </button>
            </li>
            <li>
              <button
                className={`settings-desktop-sidebar-item ${mainTab === 'imageGen' ? 'active' : ''}`}
                onClick={() => setMainTab('imageGen')}
              >
                <Image size="md" />
                <span>{t('settings.tabs.imageGen')}</span>
              </button>
            </li>
            <li>
              <button
                className={`settings-desktop-sidebar-item ${mainTab === 'prompts' ? 'active' : ''}`}
                onClick={() => setMainTab('prompts')}
              >
                <Document size="md" />
                <span>{t('settings.tabs.prompts')}</span>
              </button>
            </li>
            <li>
              <button
                className={`settings-desktop-sidebar-item ${mainTab === 'language' ? 'active' : ''}`}
                onClick={() => setMainTab('language')}
              >
                <Globe size="md" />
                <span>{t('settings.tabs.language')}</span>
              </button>
            </li>
            <li>
              <button
                className={`settings-desktop-sidebar-item ${mainTab === 'theme' ? 'active' : ''}`}
                onClick={() => setMainTab('theme')}
              >
                <Palette size="md" />
                <span>{t('settings.tabs.theme')}</span>
              </button>
            </li>
            <li>
              <button
                className={`settings-desktop-sidebar-item ${mainTab === 'advanced' ? 'active' : ''}`}
                onClick={() => setMainTab('advanced')}
              >
                <Wrench size="md" />
                <span>{t('settings.tabs.advanced')}</span>
              </button>
            </li>
          </ul>
        </aside>

        {/* Panel Content */}
        <div className="settings-panel-content">
        {mainTab === 'profile' && <ProfilePanel />}

        {mainTab === 'credentials' && (
          <CredentialsPanel
            credentials={localCredentials}
            onChange={setLocalCredentials}
          />
        )}

        {mainTab === 'ragSearch' && (
          <RagSearchPanel
            enabled={localSettings.ragSearchEnabled}
            onEnabledChange={(enabled) => setLocalSettings(prev => ({ ...prev, ragSearchEnabled: enabled }))}
            profile={localRagProfile}
            savedProfile={savedRagProfile}
            credentials={localCredentials}
            mainLanguage={localSettings.mainLanguage}
            topKPerQuery={localSettings.ragSearchTopKPerQuery}
            onTopKPerQueryChange={(value) => setLocalSettings(prev => ({ ...prev, ragSearchTopKPerQuery: value }))}
            neighborWindow={localSettings.ragSearchNeighborWindow}
            onNeighborWindowChange={(value) => setLocalSettings(prev => ({ ...prev, ragSearchNeighborWindow: value }))}
            maxPrimaryChunks={localSettings.ragSearchMaxPrimaryChunks}
            onMaxPrimaryChunksChange={(value) => setLocalSettings(prev => ({ ...prev, ragSearchMaxPrimaryChunks: value }))}
            maxTotalChunks={localSettings.ragSearchMaxTotalChunks}
            onMaxTotalChunksChange={(value) => setLocalSettings(prev => ({ ...prev, ragSearchMaxTotalChunks: value }))}
            loading={isRagProfileLoading}
            loadError={ragProfileLoadError}
            onChange={setLocalRagProfile}
          />
        )}

        {mainTab === 'general' && (
          <GeneralPanel
            taskConfigs={localSettings.taskConfigs}
            credentials={localCredentials}
            activeTask={activeTask}
            onTaskChange={setActiveTask}
            onConfigChange={(taskType, config) =>
              setLocalSettings({
                ...localSettings,
                taskConfigs: {
                  ...localSettings.taskConfigs,
                  [taskType]: config,
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
            uiLanguage={localSettings.uiLanguage}
            onMainLanguageChange={(language) =>
              setLocalSettings(prev => ({ ...prev, mainLanguage: language }))
            }
            onSubLanguagesChange={(languages) =>
              setLocalSettings(prev => ({ ...prev, subLanguages: languages }))
            }
            onDefaultSubLanguageChange={(language) =>
              setLocalSettings(prev => ({ ...prev, defaultSubLanguage: language }))
            }
            onUiLanguageChange={(language) =>
              setLocalSettings(prev => ({ ...prev, uiLanguage: language }))
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
            backupStatus={credentialsStore.backupStatus}
            backupSyncing={credentialsStore.isSyncing}
            onBackupRefresh={() => credentialsStore.fetchBackupStatus()}
            onBackupUpload={async (password) => {
              await credentialsStore.backupToServer(password, localCredentials);
            }}
            onBackupRestore={async (password) => {
              const creds = await credentialsStore.restoreFromServer(password);
              setLocalCredentials(creds);
            }}
            onBackupDelete={async (password) => {
              await credentialsStore.deleteServerBackup(password);
            }}
            nativeOutputMode={localSettings.nativeOutputMode}
            onNativeOutputModeChange={(enabled) =>
              setLocalSettings(prev => ({ ...prev, nativeOutputMode: enabled }))
            }
            toolCallHistoryLimit={localSettings.toolCallHistoryLimit}
            onToolCallHistoryLimitChange={(limit) =>
              setLocalSettings(prev => ({ ...prev, toolCallHistoryLimit: limit }))
            }
            thinkingHistoryLimit={localSettings.thinkingHistoryLimit}
            onThinkingHistoryLimitChange={(limit) =>
              setLocalSettings(prev => ({ ...prev, thinkingHistoryLimit: limit }))
            }
          />
        )}
        </div>
      </div>
    </BaseModal>
  );
};

export default SettingsModal;
