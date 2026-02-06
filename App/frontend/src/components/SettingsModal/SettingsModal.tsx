import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseModal } from '../BaseModal';
import { BaseSidebar } from '../BaseSidebar';
import { useSettings, useSettingsStore } from '../../store/settingsStore';
import { useCredentialsStore } from '../../store/credentialsStore';
import { useSidebarStore } from '../../store/sidebarStore';
import type { ProviderCredentials, Settings, AITaskType } from '../../store/settingsStore';
import CredentialsPanel from './CredentialsPanel';
import GeneralPanel from './GeneralPanel';
import LanguagePanel from './LanguagePanel';
import PromptsTemplatesPanel from './PromptEditor/PromptsTemplatesPanel';
import ThemePanel from './ThemePanel';
import AdvancedPanel from './AdvancedPanel';
import ImageGenPanel from './ImageGenPanel';
import ProfilePanel from './ProfilePanel';
import SearchMemoryPanel from './SearchMemoryPanel';
import { SettingsToastProvider, type SettingsToastApi, type SettingsToastKind } from './SettingsToastContext';
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
  | 'searchMemory'
  | 'general'
  | 'imageGen'
  | 'prompts'
  | 'language'
  | 'theme'
  | 'advanced';

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const settingsStore = useSettingsStore();
  const settings = useSettings();
  const credentialsStore = useCredentialsStore();
  const [localSettings, setLocalSettings] = useState<Settings>(settings);
  const [localCredentials, setLocalCredentials] = useState<ProviderCredentials>(credentialsStore.credentials);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ kind: SettingsToastKind; message: string } | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>('profile');
  const [activeTask, setActiveTask] = useState<AITaskType>('agent');

  // Mobile sidebar state from store
  const openSidebar = useSidebarStore((state) => state.openSidebar);
  const closeSidebar = useSidebarStore((state) => state.closeSidebar);

  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settings);
      setLocalCredentials(credentialsStore.credentials);
      credentialsStore.fetchBackupStatus().catch(() => {
        // Ignore - status is best-effort
      });
      setToast(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const showToast = useCallback((kind: SettingsToastKind, message: string, durationMs?: number) => {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }

    setToast({ kind, message });
    const ms = durationMs ?? (kind === 'success' ? 2000 : 4000);
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, ms);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  const toastApi = useMemo<SettingsToastApi>(() => {
    return {
      show: showToast,
      success: (message, durationMs) => showToast('success', message, durationMs),
      error: (message, durationMs) => showToast('error', message, durationMs),
    };
  }, [showToast]);

  const validateTaskModels = (): { taskType: AITaskType; message: string } | null => {
    const taskTypes: AITaskType[] = ['agent', 'translation', 'editAssistant', 'imagePrompt', 'summary'];
    for (const taskType of taskTypes) {
      const cfg = localSettings.taskConfigs?.[taskType];
      const model = (cfg as any)?.model;
      if (typeof model !== 'string' || !model.trim()) {
        const label = t(`settings.general.tasks.${taskType}.label`);
        return {
          taskType,
          message: t('settings.general.validation.modelRequired', { task: label }),
        };
      }
    }
    return null;
  };

  const validateEmbeddings = (): { tab: MainTab; message: string } | null => {
    if (!localSettings.ragSearchEnabled) return null;

    const checks: Array<{ feature: 'ragSearch' | 'agentMemory'; label: string }> = [
      { feature: 'ragSearch', label: t('settings.ragSearch.title') },
      { feature: 'agentMemory', label: t('settings.agentMemory.title') },
    ];

    for (const c of checks) {
      const profile = (localSettings.embeddingConfigs as any)?.[c.feature];
      const provider = (profile?.provider as string | undefined) ?? '';
      const model = (profile?.model as string | undefined) ?? '';

      if (!model.trim()) {
        return {
          tab: 'searchMemory',
          message: t('settings.embeddings.validation.missingModel', { feature: c.label }),
        };
      }

      if (provider === 'custom') {
        if (!localCredentials.custom?.apiKey?.trim()) {
          return {
            tab: 'credentials',
            message: t('settings.embeddings.validation.missingApiKey', { feature: c.label, provider: 'custom' }),
          };
        }
        if (!localCredentials.custom?.baseUrl?.trim()) {
          return {
            tab: 'credentials',
            message: t('settings.embeddings.validation.missingBaseUrl', { feature: c.label }),
          };
        }
      } else {
        const key = (localCredentials as any)?.[provider]?.apiKey;
        if (typeof key !== 'string' || !key.trim()) {
          return {
            tab: 'credentials',
            message: t('settings.embeddings.validation.missingApiKey', { feature: c.label, provider }),
          };
        }
      }
    }

    return null;
  };

  const handleSave = async () => {
    const taskModelError = validateTaskModels();
    if (taskModelError) {
      setMainTab('general');
      setActiveTask(taskModelError.taskType);
      showToast('error', taskModelError.message);
      return;
    }

    const embeddingError = validateEmbeddings();
    if (embeddingError) {
      setMainTab(embeddingError.tab);
      showToast('error', embeddingError.message);
      return;
    }

    setIsSaving(true);
    try {
      settingsStore.updateSettings(localSettings);
      credentialsStore.setCredentials(localCredentials);

      await settingsStore.saveToServer();
      showToast('success', t('settings.savedSuccessfully'));
    } catch (error) {
      console.error('Failed to save settings:', error);
      const message = error instanceof Error ? error.message : t('settings.saveError');
      showToast('error', message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setLocalSettings(settings);
    setLocalCredentials(credentialsStore.credentials);
    onClose();
  };

  return (
    <SettingsToastProvider value={toastApi}>
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
        {toast && (
          <div className={`settings-toast settings-toast--${toast.kind}`}>
            {toast.message}
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
              className={`settings-mobile-sidebar-item ${mainTab === 'searchMemory' ? 'active' : ''}`}
              onClick={() => { setMainTab('searchMemory'); closeSidebar('__global__'); }}
            >
              <List size="md" />
              <span>{t('settings.tabs.searchMemory')}</span>
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
                className={`settings-desktop-sidebar-item ${mainTab === 'searchMemory' ? 'active' : ''}`}
                onClick={() => setMainTab('searchMemory')}
              >
                <List size="md" />
                <span>{t('settings.tabs.searchMemory')}</span>
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

        {mainTab === 'searchMemory' && (
          <SearchMemoryPanel
            enabled={localSettings.ragSearchEnabled}
            onEnabledChange={(enabled) => setLocalSettings(prev => ({ ...prev, ragSearchEnabled: enabled }))}
            ragSearchProfile={localSettings.embeddingConfigs.ragSearch}
            onRagSearchProfileChange={(next) =>
              setLocalSettings((prev) => ({
                ...prev,
                embeddingConfigs: { ...prev.embeddingConfigs, ragSearch: next },
              }))
            }
            agentMemoryProfile={localSettings.embeddingConfigs.agentMemory}
            onAgentMemoryProfileChange={(next) =>
              setLocalSettings((prev) => ({
                ...prev,
                embeddingConfigs: { ...prev.embeddingConfigs, agentMemory: next },
              }))
            }
            keywordPageSize={localSettings.ragSearchKeywordPageSize}
            onKeywordPageSizeChange={(value) => setLocalSettings(prev => ({ ...prev, ragSearchKeywordPageSize: value }))}
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
            agentMemoryTopKPerQuery={localSettings.agentMemoryTopKPerQuery}
            onAgentMemoryTopKPerQueryChange={(value) => setLocalSettings(prev => ({ ...prev, agentMemoryTopKPerQuery: value }))}
            agentMemoryNeighborWindow={localSettings.agentMemoryNeighborWindow}
            onAgentMemoryNeighborWindowChange={(value) => setLocalSettings(prev => ({ ...prev, agentMemoryNeighborWindow: value }))}
            agentMemoryMaxPrimaryMessages={localSettings.agentMemoryMaxPrimaryMessages}
            onAgentMemoryMaxPrimaryMessagesChange={(value) => setLocalSettings(prev => ({ ...prev, agentMemoryMaxPrimaryMessages: value }))}
            agentMemoryMaxTotalMessages={localSettings.agentMemoryMaxTotalMessages}
            onAgentMemoryMaxTotalMessagesChange={(value) => setLocalSettings(prev => ({ ...prev, agentMemoryMaxTotalMessages: value }))}
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
            toolCallAutoApprove={localSettings.toolCallAutoApprove}
            onToolCallAutoApproveChange={(config) =>
              setLocalSettings(prev => ({ ...prev, toolCallAutoApprove: config }))
            }
          />
        )}
        </div>
      </div>
      </BaseModal>
    </SettingsToastProvider>
  );
};

export default SettingsModal;
