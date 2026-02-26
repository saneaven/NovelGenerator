import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseModal } from '../BaseModal';
import { BaseSidebar } from '../BaseSidebar';
import { useSettings, useSettingsStore } from '../../store/settingsStore';
import { useSidebarStore } from '../../store/sidebarStore';
import type { ProviderCredentials, Settings, AITaskType } from '../../store/settingsStore';
import CredentialsPanel from './CredentialsPanel';
import GeneralPanel from './GeneralPanel';
import LanguagePanel from './LanguagePanel';
import PromptsTemplatesPanel, { type PromptsTemplatesPanelHandle } from './PromptEditor/PromptsTemplatesPanel';
import ThemePanel from './ThemePanel';
import AdvancedPanel from './AdvancedPanel';
import ImageGenPanel from './ImageGenPanel';
import ProfilePanel from './ProfilePanel';
import SearchMemoryPanel from './SearchMemoryPanel';
import { SettingsToastProvider, type SettingsToastApi, type SettingsToastKind } from './SettingsToastContext';
import { Settings as SettingsIcon, Lock, Image, Document, Globe, Palette, Wrench, HamburgerMenu, People, List } from '../icons';
import { TextButton } from '../TextButton';
import { confirm, alert as showAlert } from '../../store/dialogStore';
import apiClient from '../../api/client';
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

type ProviderName = keyof ProviderCredentials;

const DEFAULT_CREDENTIAL_DRAFT: ProviderCredentials = {
  openai: { apiKey: '' },
  gemini: { apiKey: '' },
  claude: { apiKey: '' },
  openrouter: { apiKey: '' },
  custom: { baseUrl: '', apiKey: '', additionalHeadersJson: '{}', additionalBodyJson: '{}' },
  xai: { apiKey: '' },
  novelai: { apiKey: '' },
};

const PROVIDERS: ProviderName[] = ['openai', 'gemini', 'claude', 'openrouter', 'custom', 'xai', 'novelai'];

type NormalizedProviderConfig = Record<string, unknown>;

function parseJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function normalizeProviderDraft(provider: ProviderName, draft: ProviderCredentials): NormalizedProviderConfig {
  if (provider === 'custom') {
    const apiKey = (draft.custom.apiKey || '').trim();
    const baseUrl = (draft.custom.baseUrl || '').trim();
    const parsedHeaders = parseJsonObject(draft.custom.additionalHeadersJson);
    const additionalHeaders = Object.fromEntries(
      Object.entries(parsedHeaders).filter(([, value]) => typeof value === 'string')
    ) as Record<string, string>;
    const additionalBody = parseJsonObject(draft.custom.additionalBodyJson);

    const normalized: NormalizedProviderConfig = {};
    if (apiKey) normalized.api_key = apiKey;
    if (baseUrl) normalized.base_url = baseUrl;
    if (Object.keys(additionalHeaders).length > 0) normalized.additional_headers = additionalHeaders;
    if (Object.keys(additionalBody).length > 0) normalized.additional_body = additionalBody;
    return normalized;
  }

  const apiKey = ((draft as any)[provider]?.apiKey || '').trim();
  return apiKey ? { api_key: apiKey } : {};
}

function snapshotNormalized(draft: ProviderCredentials): Record<ProviderName, NormalizedProviderConfig> {
  return {
    openai: normalizeProviderDraft('openai', draft),
    gemini: normalizeProviderDraft('gemini', draft),
    claude: normalizeProviderDraft('claude', draft),
    openrouter: normalizeProviderDraft('openrouter', draft),
    custom: normalizeProviderDraft('custom', draft),
    xai: normalizeProviderDraft('xai', draft),
    novelai: normalizeProviderDraft('novelai', draft),
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function isEmptyConfig(config: NormalizedProviderConfig): boolean {
  return Object.keys(config).length === 0;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const settingsStore = useSettingsStore();
  const settings = useSettings();
  const [localSettings, setLocalSettings] = useState<Settings>(settings);
  const [localCredentials, setLocalCredentials] = useState<ProviderCredentials>(DEFAULT_CREDENTIAL_DRAFT);
  const [storedProviders, setStoredProviders] = useState<string[]>([]);
  const [isSyncingCredentials, setIsSyncingCredentials] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [promptUnsavedCount, setPromptUnsavedCount] = useState(0);
  const [hasMountedPromptsPanel, setHasMountedPromptsPanel] = useState(false);
  const [toast, setToast] = useState<{ kind: SettingsToastKind; message: string } | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>('profile');
  const [activeTask, setActiveTask] = useState<AITaskType>('agent');
  const promptsPanelRef = useRef<PromptsTemplatesPanelHandle | null>(null);
  const settingsSnapshotRef = useRef<string>('');
  const credentialsSnapshotRef = useRef<string>('');

  // Mobile sidebar state from store
  const openSidebar = useSidebarStore((state) => state.openSidebar);
  const closeSidebar = useSidebarStore((state) => state.closeSidebar);

  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settings);
      setLocalCredentials(DEFAULT_CREDENTIAL_DRAFT);
      settingsSnapshotRef.current = JSON.stringify(settings);
      credentialsSnapshotRef.current = JSON.stringify(DEFAULT_CREDENTIAL_DRAFT);
      setPromptUnsavedCount(0);
      setHasMountedPromptsPanel(mainTab === 'prompts');
      void apiClient
        .get<{ providers: string[] }>('/api/v1/credentials')
        .then((resp) => setStoredProviders(Array.isArray(resp.providers) ? resp.providers : []))
        .catch(() => setStoredProviders([]));
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
    const taskTypes: AITaskType[] = ['agent', 'translation', 'editAssistant', 'imagePrompt', 'summary', 'subAgent'];
    for (const taskType of taskTypes) {
      const cfg = localSettings.task_configs?.[taskType];
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
      if (!provider.trim()) {
        return {
          tab: 'searchMemory',
          message: t('settings.embeddings.validation.missingModel', { feature: c.label }),
        };
      }
    }

    return null;
  };

  const validateCustomCredentialJson = (): { tab: MainTab; message: string } | null => {
    const targets: Array<{ label: string; raw: string | undefined; requireStringValues: boolean }> = [
      {
        label: t('settings.credentials.custom.additionalHeaders'),
        raw: localCredentials.custom?.additionalHeadersJson,
        requireStringValues: true,
      },
      {
        label: t('settings.credentials.custom.additionalBody'),
        raw: localCredentials.custom?.additionalBodyJson,
        requireStringValues: false,
      },
    ];

    for (const target of targets) {
      let parsed: unknown;
      try {
        const value = (target.raw || '').trim();
        parsed = value ? JSON.parse(value) : {};
      } catch {
        return {
          tab: 'credentials',
          message: t('settings.credentials.validation.invalidJson', { field: target.label }),
        };
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
          tab: 'credentials',
          message: t('settings.credentials.validation.invalidJsonObject', { field: target.label }),
        };
      }

      if (target.requireStringValues) {
        const hasInvalidValue = Object.values(parsed as Record<string, unknown>).some(
          (value) => typeof value !== 'string'
        );
        if (hasInvalidValue) {
          return {
            tab: 'credentials',
            message: t('settings.credentials.validation.invalidHeaderValue'),
          };
        }
      }
    }

    return null;
  };

  const syncCredentialDraftDiff = useCallback(
    async (prevDraft: ProviderCredentials, nextDraft: ProviderCredentials) => {
      setIsSyncingCredentials(true);
      try {
        const prev = snapshotNormalized(prevDraft);
        const next = snapshotNormalized(nextDraft);
        const changedProviders = PROVIDERS.filter(
          (provider) => stableStringify(prev[provider]) !== stableStringify(next[provider])
        );

        for (const provider of changedProviders) {
          const normalized = next[provider];
          if (isEmptyConfig(normalized)) {
            try {
              await apiClient.delete(`/api/v1/credentials/${encodeURIComponent(provider)}`);
            } catch {
              // Deleting an already-missing provider is idempotent for this flow.
            }
            continue;
          }
          await apiClient.put(`/api/v1/credentials/${encodeURIComponent(provider)}`, { config: normalized });
        }

        const refreshed = await apiClient.get<{ providers: string[] }>('/api/v1/credentials');
        setStoredProviders(Array.isArray(refreshed.providers) ? refreshed.providers : []);
      } finally {
        setIsSyncingCredentials(false);
      }
    },
    []
  );

  const handleSave = async () => {
    if (isSaving) return;

    setIsSaving(true);
    try {
      const promptSavePromise =
        promptsPanelRef.current?.saveAllDrafts?.() ??
        Promise.resolve({ attempted: 0, saved: 0, failed: 0, failures: [] });

      const settingsDirty = JSON.stringify(localSettings) !== settingsSnapshotRef.current;
      const credentialsDirty = JSON.stringify(localCredentials) !== credentialsSnapshotRef.current;

      if (settingsDirty || credentialsDirty) {
        const taskModelError = validateTaskModels();
        if (taskModelError) {
          setMainTab('general');
          setActiveTask(taskModelError.taskType);
          showToast('error', taskModelError.message);
        } else {
          const embeddingError = validateEmbeddings();
          if (embeddingError) {
            setMainTab(embeddingError.tab);
            showToast('error', embeddingError.message);
          } else {
            const customJsonError = validateCustomCredentialJson();
            if (customJsonError) {
              setMainTab(customJsonError.tab);
              showToast('error', customJsonError.message);
            } else {
              try {
                if (settingsDirty) {
                  settingsStore.updateSettings(localSettings);
                }
                const prevCredentials = credentialsSnapshotRef.current
                  ? (JSON.parse(credentialsSnapshotRef.current) as ProviderCredentials)
                  : DEFAULT_CREDENTIAL_DRAFT;
                if (settingsDirty) {
                  await settingsStore.saveToServer();
                }
                if (credentialsDirty) {
                  await syncCredentialDraftDiff(prevCredentials, localCredentials);
                }
                settingsSnapshotRef.current = JSON.stringify(localSettings);
                credentialsSnapshotRef.current = JSON.stringify(localCredentials);
                showToast('success', t('settings.savedSuccessfully'));
              } catch (error) {
                console.error('Failed to save settings:', error);
                const message = error instanceof Error ? error.message : t('settings.saveError');
                showToast('error', message);
              }
            }
          }
        }
      }

      const promptSummary = await promptSavePromise;
      if (promptSummary.attempted > 0 && promptSummary.failed === 0) {
        showToast('success', `Saved ${promptSummary.saved} prompt items`);
      } else if (promptSummary.failed > 0) {
        showToast('error', `Saved ${promptSummary.saved}/${promptSummary.attempted} prompt items. ${promptSummary.failed} failed.`);
        const lines = promptSummary.failures.map((f) => `- ${f.item.label}: ${f.error}`);
        showAlert({ title: 'Save Error', message: `Some prompt items failed to save:\n\n${lines.join('\n')}`, variant: 'warning' });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const getUnsavedCount = useCallback(() => {
    const settingsDirty = JSON.stringify(localSettings) !== settingsSnapshotRef.current;
    const credentialsDirty = JSON.stringify(localCredentials) !== credentialsSnapshotRef.current;
    const promptDirty = promptUnsavedCount;
    return promptDirty + (settingsDirty ? 1 : 0) + (credentialsDirty ? 1 : 0);
  }, [localCredentials, localSettings, promptUnsavedCount]);

  const closeWithoutSaving = useCallback(() => {
    setLocalSettings(settings);
    setLocalCredentials(DEFAULT_CREDENTIAL_DRAFT);
    onClose();
  }, [onClose, settings]);

  const handleRequestClose = useCallback(async () => {
    const unsavedCount = getUnsavedCount();
    if (unsavedCount === 0) {
      closeWithoutSaving();
      return;
    }

    const shouldSave = await confirm({ title: 'Unsaved Changes', message: `You have unsaved changes (${unsavedCount}). Save before closing?`, variant: 'warning', confirmLabel: 'Save', cancelLabel: "Don't Save" });
    if (shouldSave) {
      await handleSave();
      const remaining = getUnsavedCount();
      if (remaining === 0) {
        closeWithoutSaving();
        return;
      }

      const discard = await confirm({ title: 'Save Failed', message: 'Some changes are still unsaved. Discard them and close anyway?', variant: 'danger', confirmLabel: 'Discard' });
      if (discard) {
        closeWithoutSaving();
      }
      return;
    }

    const discard = await confirm({ title: 'Discard Changes', message: 'Discard your unsaved changes and close?', variant: 'danger', confirmLabel: 'Discard' });
    if (discard) {
      closeWithoutSaving();
    }
  }, [closeWithoutSaving, getUnsavedCount, handleSave]);

  const handleCancel = useCallback(async () => {
    const unsavedCount = getUnsavedCount();
    if (unsavedCount === 0) {
      closeWithoutSaving();
      return;
    }

    const discard = await confirm({ title: 'Discard Changes', message: `You have unsaved changes (${unsavedCount}). Discard all changes and close?`, variant: 'danger', confirmLabel: 'Discard' });
    if (discard) {
      closeWithoutSaving();
    }
  }, [closeWithoutSaving, getUnsavedCount]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSave();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (mainTab === 'prompts') {
      setHasMountedPromptsPanel(true);
    }
  }, [isOpen, mainTab]);

  return (
    <SettingsToastProvider value={toastApi}>
      <BaseModal
        isOpen={isOpen}
        onClose={handleRequestClose}
        size="full"
        showHeader={false}
        className="settings-modal"
        footer={
          <>
            <TextButton variant="secondary" onClick={handleCancel} disabled={isSaving}>
              {t('common.cancel')}
            </TextButton>
            <TextButton variant="primary" onClick={handleSave} disabled={isSaving || getUnsavedCount() === 0} loading={isSaving}>
              {isSaving ? (
                t('settings.saving')
              ) : (
                <>
                  {t('settings.saveSettings')}
                  {getUnsavedCount() > 0 && <span className="settings-save-badge">{getUnsavedCount()}</span>}
                </>
              )}
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
        <button className="close-button" onClick={handleRequestClose}>
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
        <div className={`settings-panel-content${mainTab === 'prompts' ? ' settings-panel-content--fill' : ''}`}>
        {mainTab === 'profile' && <ProfilePanel />}

        {mainTab === 'credentials' && (
          <CredentialsPanel
            credentials={localCredentials}
            storedProviders={storedProviders}
            isSyncing={isSyncingCredentials}
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
            task_configs={localSettings.task_configs}
            activeTask={activeTask}
            onTaskChange={setActiveTask}
            onConfigChange={(taskType, config) =>
              setLocalSettings({
                ...localSettings,
                task_configs: {
                  ...localSettings.task_configs,
                  [taskType]: config,
                },
              })
            }
            customThinkingTemplates={localSettings.customThinkingTemplates}
            onTemplatesChange={(templates) =>
              setLocalSettings(prev => ({ ...prev, customThinkingTemplates: templates }))
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

        {hasMountedPromptsPanel && (
          <div
            style={{
              display: mainTab === 'prompts' ? 'flex' : 'none',
              flex: 1,
              minHeight: 0,
            }}
          >
            <PromptsTemplatesPanel ref={promptsPanelRef} onUnsavedCountChange={setPromptUnsavedCount} />
          </div>
        )}

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
