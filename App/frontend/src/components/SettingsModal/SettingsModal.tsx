import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { BaseModal } from '../BaseModal';
import { BaseSidebar } from '../BaseSidebar';
import { useSettings, useSettingsStore } from '../../store/settingsStore';
import { useSidebarStore } from '../../store/sidebarStore';
import type { ProviderCredentials, Settings, AITaskType, SearchMemoryTarget } from '../../store/settingsStore';
import { buildLockedSectionReset } from '../../store/settingsUpdatePayload';
import { hasTaskOverride, resolveAllTaskConfigs, TASK_CONFIG_TASK_TYPES } from '../../store/taskConfigSettings';
import { resolveMemorySettings, resolveSearchSettings } from '../../store/searchMemorySettings';
import CredentialsPanel from './CredentialsPanel';
import GeneralPanel from './GeneralPanel';
import DemoGeneralPanel from './DemoGeneralPanel';
import LanguagePanel from './LanguagePanel';
import PromptsTemplatesPanel, { type PromptsTemplatesPanelHandle } from './PromptEditor/PromptsTemplatesPanel';
import ThemePanel from './ThemePanel';
import AdvancedPanel from './AdvancedPanel';
import ImageGenPanel from './ImageGenPanel';
import ProfilePanel from './ProfilePanel';
import SearchMemoryPanel from './SearchMemoryPanel';
import LLMLogViewer from './LLMLogViewer';
import { SettingsToastProvider, type SettingsToastApi, type SettingsToastKind } from './SettingsToastContext';
import { Settings as SettingsIcon, Lock, Image, Document, Globe, Palette, Wrench, HamburgerMenu, People, List, Star } from '../icons';
import { TextButton } from '../TextButton';
import { confirm, alert as showAlert } from '../../store/dialogStore';
import apiClient from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { useProviderSpecStore } from '../../providerEngine/store';
import { buildCredentialDrafts, normalizeCredentialDraft, validateCredentialDraftJson } from '../../providerEngine/utils';
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

type GeneralConfigTarget = 'general' | AITaskType;
type SearchMemoryConfigTarget = 'general' | SearchMemoryTarget;

const DEMO_LOCKED_TABS = new Set<MainTab>(['credentials', 'searchMemory', 'imageGen', 'prompts', 'advanced']);
type NormalizedProviderConfig = Record<string, unknown>;

function buildEmptyCredentialDraft(specs: Record<string, any>): ProviderCredentials {
  return buildCredentialDrafts(specs);
}

function snapshotNormalized(
  draft: ProviderCredentials,
  specs: Record<string, any>
): Record<string, NormalizedProviderConfig> {
  return Object.fromEntries(
    Object.values(specs).map((provider: any) => [
      provider.id,
      normalizeCredentialDraft(provider, draft[provider.id] ?? {}),
    ])
  );
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

function calculateUnsavedCount(params: {
  settingsJson: string;
  credentialsJson: string;
  settingsSnapshot: string;
  credentialsSnapshot: string;
  demoModeEnabled: boolean;
  promptUnsavedCount: number;
}): number {
  const settingsDirty = params.settingsJson !== params.settingsSnapshot;
  const credentialsDirty = !params.demoModeEnabled && params.credentialsJson !== params.credentialsSnapshot;
  return params.promptUnsavedCount + (settingsDirty ? 1 : 0) + (credentialsDirty ? 1 : 0);
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const saveSettingsToServer = useSettingsStore((s) => s.saveToServer);
  const setStoreTheme = useSettingsStore((s) => s.setTheme);
  const settings = useSettings();
  const user = useAuthStore((state) => state.user);
  const providerSpecs = useProviderSpecStore((state) => state.specs);
  const providerSpecsLoaded = useProviderSpecStore((state) => state.loaded);
  const providerSpecsLoading = useProviderSpecStore((state) => state.loading);
  const providerSpecsError = useProviderSpecStore((state) => state.error);
  const loadProviderSpecs = useProviderSpecStore((state) => state.load);
  const [localSettings, setLocalSettings] = useState<Settings>(settings);
  const [localCredentials, setLocalCredentials] = useState<ProviderCredentials>({});
  const [storedProviders, setStoredProviders] = useState<string[]>([]);
  const [isSyncingCredentials, setIsSyncingCredentials] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [promptUnsavedCount, setPromptUnsavedCount] = useState(0);
  const promptUnsavedCountRef = useRef(0);
  const [hasMountedPromptsPanel, setHasMountedPromptsPanel] = useState(false);
  const [promptsPanelKey, setPromptsPanelKey] = useState(0);
  const [toast, setToast] = useState<{ kind: SettingsToastKind; message: string } | null>(null);
  const [showLlmLogViewer, setShowLlmLogViewer] = useState(false);
  const toastTimeoutRef = useRef<number | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>('profile');
  const [activeGeneralTarget, setActiveGeneralTarget] = useState<GeneralConfigTarget>('general');
  const [activeSearchMemoryTarget, setActiveSearchMemoryTarget] = useState<SearchMemoryConfigTarget>('general');
  const promptsPanelRef = useRef<PromptsTemplatesPanelHandle | null>(null);
  const [settingsSnapshot, setSettingsSnapshot] = useState<string>('');
  const [credentialsSnapshot, setCredentialsSnapshot] = useState<string>('');
  const localSettingsSnapshot = useMemo(() => JSON.stringify(localSettings), [localSettings]);
  const localCredentialsSnapshot = useMemo(() => JSON.stringify(localCredentials), [localCredentials]);
  const unsavedCount = useMemo(
    () => calculateUnsavedCount({
      settingsJson: localSettingsSnapshot,
      credentialsJson: localCredentialsSnapshot,
      settingsSnapshot,
      credentialsSnapshot,
      demoModeEnabled: localSettings.demoModeEnabled,
      promptUnsavedCount,
    }),
    [localCredentialsSnapshot, localSettings.demoModeEnabled, localSettingsSnapshot, promptUnsavedCount, settingsSnapshot, credentialsSnapshot]
  );

  // Mobile sidebar state from store
  const openSidebar = useSidebarStore((state) => state.openSidebar);
  const closeSidebar = useSidebarStore((state) => state.closeSidebar);
  const isAdmin = Boolean(user?.is_admin);

  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settings);
      setActiveGeneralTarget('general');
      setActiveSearchMemoryTarget('general');
      setSettingsSnapshot(JSON.stringify(settings));
      promptUnsavedCountRef.current = 0;
      setPromptUnsavedCount(0);
      setHasMountedPromptsPanel(mainTab === 'prompts' && !settings.demoModeEnabled);
      void loadProviderSpecs()
        .then(() => {
          const emptyDraft = buildEmptyCredentialDraft(useProviderSpecStore.getState().specs);
          setLocalCredentials(emptyDraft);
          setCredentialsSnapshot(JSON.stringify(emptyDraft));
        })
        .catch(() => {
          setLocalCredentials({});
          setCredentialsSnapshot(JSON.stringify({}));
        });
      void apiClient
        .get<{ providers: string[] }>('/api/v1/credentials')
        .then((resp) => setStoredProviders(Array.isArray(resp.providers) ? resp.providers : []))
        .catch(() => setStoredProviders([]));
      setToast(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, loadProviderSpecs, settings]);

  const handlePromptUnsavedCountChange = useCallback((count: number) => {
    promptUnsavedCountRef.current = count;
    setPromptUnsavedCount(count);
  }, []);

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

  const handleOpenAdminConsole = useCallback(() => {
    closeSidebar('__global__');
    navigate('/admin');
  }, [closeSidebar, navigate]);

  const toastApi = useMemo<SettingsToastApi>(() => {
    return {
      show: showToast,
      success: (message, durationMs) => showToast('success', message, durationMs),
      error: (message, durationMs) => showToast('error', message, durationMs),
    };
  }, [showToast]);

  const isDemoLockedTab = useCallback(
    (tab: MainTab) => localSettings.demoModeEnabled && DEMO_LOCKED_TABS.has(tab),
    [localSettings.demoModeEnabled]
  );

  const handleLockedTabAttempt = useCallback(() => {
    showToast('error', t('settings.general.demo.lockedTabToast'));
  }, [showToast, t]);

  const handleMainTabSelect = useCallback(
    (tab: MainTab, closeMobileSidebar = false) => {
      if (isDemoLockedTab(tab)) {
        handleLockedTabAttempt();
        return;
      }
      setMainTab(tab);
      if (closeMobileSidebar) {
        closeSidebar('__global__');
      }
    },
    [closeSidebar, handleLockedTabAttempt, isDemoLockedTab]
  );

  const resolvedTaskConfigs = useMemo(
    () => resolveAllTaskConfigs(localSettings.taskConfigSettings),
    [localSettings.taskConfigSettings]
  );

  const validateTaskModels = (): { target: GeneralConfigTarget; message: string } | null => {
    const generalModel = localSettings.taskConfigSettings.general.model;
    if (typeof generalModel !== 'string' || !generalModel.trim()) {
      return {
        target: 'general',
        message: t('settings.general.validation.modelRequired', { task: t('settings.general.generalLabel') }),
      };
    }

    for (const taskType of TASK_CONFIG_TASK_TYPES) {
      if (!hasTaskOverride(localSettings.taskConfigSettings, taskType)) continue;
      const model = resolvedTaskConfigs[taskType]?.model;
      if (typeof model !== 'string' || !model.trim()) {
        const label = t(`settings.general.tasks.${taskType}.label`);
        return {
          target: taskType,
          message: t('settings.general.validation.modelRequired', { task: label }),
        };
      }
    }

    return null;
  };

  const validateSearchMemorySettings = (): { tab: MainTab; target: SearchMemoryConfigTarget; message: string } | null => {
    if (!localSettings.searchMemorySettings.enabled) return null;

    const searchSettings = resolveSearchSettings(localSettings.searchMemorySettings);
    const memorySettings = resolveMemorySettings(localSettings.searchMemorySettings);
    const checks: Array<{
      target: SearchMemoryConfigTarget;
      label: string;
      provider: string;
      model: string;
    }> = [
      {
        target: 'search',
        label: t('settings.searchMemory.targets.search.label'),
        provider: searchSettings.embedding.provider,
        model: searchSettings.embedding.model,
      },
      {
        target: 'memory',
        label: t('settings.searchMemory.targets.memory.label'),
        provider: memorySettings.embedding.provider,
        model: memorySettings.embedding.model,
      },
    ];

    for (const check of checks) {
      if (!check.provider.trim() || !check.model.trim()) {
        return {
          tab: 'searchMemory',
          target: check.target,
          message: t('settings.searchMemory.validation.missingEmbedding', { target: check.label }),
        };
      }
    }

    return null;
  };

  const validateCustomCredentialJson = (): { tab: MainTab; message: string } | null => {
    for (const provider of Object.values(providerSpecs)) {
      const invalidField = validateCredentialDraftJson(provider, localCredentials[provider.id] ?? {});
      if (!invalidField) continue;
      const fieldNode = provider.credentials.fields[invalidField];
      const labelKey = fieldNode && !('fields' in fieldNode) ? fieldNode.ui?.label_key : '';
      const label = labelKey ? t(labelKey) : invalidField;
      return {
        tab: 'credentials',
        message: t('settings.credentials.validation.invalidJsonObject', { field: label }),
      };
    }
    return null;
  };

  const syncCredentialDraftDiff = useCallback(
    async (prevDraft: ProviderCredentials, nextDraft: ProviderCredentials) => {
      setIsSyncingCredentials(true);
      try {
        const prev = snapshotNormalized(prevDraft, providerSpecs);
        const next = snapshotNormalized(nextDraft, providerSpecs);
        const changedProviders = Object.keys(providerSpecs).filter(
          (provider) => stableStringify(prev[provider] ?? {}) !== stableStringify(next[provider] ?? {})
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
    [providerSpecs]
  );

  const handleDemoModeChange = useCallback(
    async (enabled: boolean) => {
      if (enabled === localSettings.demoModeEnabled) {
        return;
      }

      if (!enabled) {
        setLocalSettings((prev) => ({ ...prev, demoModeEnabled: false }));
        return;
      }

      const nextSettings = { ...buildLockedSectionReset(localSettings, settings), demoModeEnabled: true };
      const lockedSettingsDirty = localSettingsSnapshot !== JSON.stringify(buildLockedSectionReset(localSettings, settings));
      const credentialsDirty = localCredentialsSnapshot !== credentialsSnapshot;
      const promptsDirty = promptUnsavedCount > 0;

      if (lockedSettingsDirty || credentialsDirty || promptsDirty) {
        const shouldDiscard = await confirm({
          title: t('settings.general.demo.discardChangesTitle'),
          message: t('settings.general.demo.discardChangesMessage'),
          variant: 'warning',
          confirmLabel: t('common.confirm'),
          cancelLabel: t('common.cancel'),
        });
        if (!shouldDiscard) {
          return;
        }
      }

      setLocalSettings(nextSettings);
      const emptyDraft = buildEmptyCredentialDraft(providerSpecs);
      setLocalCredentials(emptyDraft);
      setCredentialsSnapshot(JSON.stringify(emptyDraft));
      promptUnsavedCountRef.current = 0;
      setPromptUnsavedCount(0);
      setHasMountedPromptsPanel(false);
      setPromptsPanelKey((prev) => prev + 1);
      setMainTab('general');
      setActiveSearchMemoryTarget('general');
    },
    [credentialsSnapshot, localCredentialsSnapshot, localSettings, localSettingsSnapshot, promptUnsavedCount, settings, t]
  );

  const handleSave = async () => {
    if (isSaving) return;

    setIsSaving(true);
    try {
      const settingsDirty = localSettingsSnapshot !== settingsSnapshot;
      const credentialsDirty =
        !localSettings.demoModeEnabled &&
        localCredentialsSnapshot !== credentialsSnapshot;

      if (settingsDirty || credentialsDirty) {
        if (!localSettings.demoModeEnabled) {
          const taskModelError = validateTaskModels();
          if (taskModelError) {
            setMainTab('general');
            setActiveGeneralTarget(taskModelError.target);
            showToast('error', taskModelError.message);
            return;
          }

          const searchMemoryError = validateSearchMemorySettings();
          if (searchMemoryError) {
            setMainTab(searchMemoryError.tab);
            setActiveSearchMemoryTarget(searchMemoryError.target);
            showToast('error', searchMemoryError.message);
            return;
          }

          const customJsonError = validateCustomCredentialJson();
          if (customJsonError) {
            setMainTab(customJsonError.tab);
            showToast('error', customJsonError.message);
            return;
          }
        }

        const promptSavePromise =
          localSettings.demoModeEnabled
            ? Promise.resolve({ attempted: 0, saved: 0, failed: 0, failures: [] })
            : promptsPanelRef.current?.saveAllDrafts?.() ??
              Promise.resolve({ attempted: 0, saved: 0, failed: 0, failures: [] });

        try {
          let savedSettings = localSettings;
          if (settingsDirty) {
            savedSettings = await saveSettingsToServer(localSettings);
            setLocalSettings(savedSettings);
            setSettingsSnapshot(JSON.stringify(savedSettings));
          }

          if (credentialsDirty) {
            const prevCredentials = credentialsSnapshot
              ? (JSON.parse(credentialsSnapshot) as ProviderCredentials)
              : buildEmptyCredentialDraft(providerSpecs);
            await syncCredentialDraftDiff(prevCredentials, localCredentials);
            setCredentialsSnapshot(localCredentialsSnapshot);
          }

          if (settingsDirty || credentialsDirty) {
            showToast('success', t('settings.savedSuccessfully'));
          }
        } catch (error) {
          console.error('Failed to save settings:', error);
          const message = error instanceof Error ? error.message : t('settings.saveError');
          showToast('error', message);
        }

        const promptSummary = await promptSavePromise;
        if (promptSummary.attempted > 0 && promptSummary.failed === 0) {
          promptUnsavedCountRef.current = 0;
          setPromptUnsavedCount(0);
          showToast('success', `Saved ${promptSummary.saved} prompt items`);
        } else if (promptSummary.failed > 0) {
          showToast('error', `Saved ${promptSummary.saved}/${promptSummary.attempted} prompt items. ${promptSummary.failed} failed.`);
          const lines = promptSummary.failures.map((f) => `- ${f.item.label}: ${f.error}`);
          showAlert({ title: 'Save Error', message: `Some prompt items failed to save:\n\n${lines.join('\n')}`, variant: 'warning' });
        }
        return;
      }

      const promptSummary =
        localSettings.demoModeEnabled
          ? { attempted: 0, saved: 0, failed: 0, failures: [] }
          : await (
            promptsPanelRef.current?.saveAllDrafts?.() ??
            Promise.resolve({ attempted: 0, saved: 0, failed: 0, failures: [] })
          );

      if (promptSummary.attempted > 0 && promptSummary.failed === 0) {
        promptUnsavedCountRef.current = 0;
        setPromptUnsavedCount(0);
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
    return calculateUnsavedCount({
      settingsJson: localSettingsSnapshot,
      credentialsJson: localCredentialsSnapshot,
      settingsSnapshot,
      credentialsSnapshot,
      demoModeEnabled: localSettings.demoModeEnabled,
      promptUnsavedCount: promptUnsavedCountRef.current,
    });
  }, [credentialsSnapshot, localCredentialsSnapshot, localSettings.demoModeEnabled, localSettingsSnapshot, settingsSnapshot]);

  const closeWithoutSaving = useCallback(() => {
    setLocalSettings(settings);
    setLocalCredentials(buildEmptyCredentialDraft(providerSpecs));
    setPromptUnsavedCount(0);
    setHasMountedPromptsPanel(false);
    onClose();
  }, [onClose, providerSpecs, settings]);

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
    if (mainTab === 'prompts' && !localSettings.demoModeEnabled) {
      setHasMountedPromptsPanel(true);
    }
  }, [isOpen, localSettings.demoModeEnabled, mainTab]);

  useEffect(() => {
    if (!isOpen) return;
    if (isDemoLockedTab(mainTab)) {
      setMainTab('general');
    }
  }, [isDemoLockedTab, isOpen, mainTab]);

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
            <TextButton variant="primary" onClick={handleSave} disabled={isSaving || unsavedCount === 0} loading={isSaving}>
              {isSaving ? (
                t('settings.saving')
              ) : (
                <>
                  {t('settings.saveSettings')}
                  {unsavedCount > 0 && <span className="settings-save-badge">{unsavedCount}</span>}
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
              onClick={() => { handleMainTabSelect('profile', true); }}
            >
              <People size="md" />
              <span>{t('settings.tabs.profile')}</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'credentials' ? 'active' : ''} ${isDemoLockedTab('credentials') ? 'settings-sidebar-item--locked' : ''}`}
              onClick={() => { handleMainTabSelect('credentials', true); }}
              aria-disabled={isDemoLockedTab('credentials')}
              data-locked={isDemoLockedTab('credentials') ? 'true' : undefined}
            >
              <Lock size="md" />
              <span>{t('settings.tabs.credentials')}</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'general' ? 'active' : ''}`}
              onClick={() => { handleMainTabSelect('general', true); }}
            >
              <SettingsIcon size="md" />
              <span>{t('settings.tabs.general')}</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'searchMemory' ? 'active' : ''} ${isDemoLockedTab('searchMemory') ? 'settings-sidebar-item--locked' : ''}`}
              onClick={() => { handleMainTabSelect('searchMemory', true); }}
              aria-disabled={isDemoLockedTab('searchMemory')}
              data-locked={isDemoLockedTab('searchMemory') ? 'true' : undefined}
            >
              <List size="md" />
              <span>{t('settings.tabs.searchMemory')}</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'imageGen' ? 'active' : ''} ${isDemoLockedTab('imageGen') ? 'settings-sidebar-item--locked' : ''}`}
              onClick={() => { handleMainTabSelect('imageGen', true); }}
              aria-disabled={isDemoLockedTab('imageGen')}
              data-locked={isDemoLockedTab('imageGen') ? 'true' : undefined}
            >
              <Image size="md" />
              <span>{t('settings.tabs.imageGen')}</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'prompts' ? 'active' : ''} ${isDemoLockedTab('prompts') ? 'settings-sidebar-item--locked' : ''}`}
              onClick={() => { handleMainTabSelect('prompts', true); }}
              aria-disabled={isDemoLockedTab('prompts')}
              data-locked={isDemoLockedTab('prompts') ? 'true' : undefined}
            >
              <Document size="md" />
              <span>{t('settings.tabs.prompts')}</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'language' ? 'active' : ''}`}
              onClick={() => { handleMainTabSelect('language', true); }}
            >
              <Globe size="md" />
              <span>{t('settings.tabs.language')}</span>
            </button>
          </li>
          <li>
            <button
              className={`settings-mobile-sidebar-item ${mainTab === 'theme' ? 'active' : ''}`}
              onClick={() => { handleMainTabSelect('theme', true); }}
            >
              <Palette size="md" />
              <span>{t('settings.tabs.theme')}</span>
            </button>
          </li>
          <li>
              <button
                className={`settings-mobile-sidebar-item ${mainTab === 'advanced' ? 'active' : ''} ${isDemoLockedTab('advanced') ? 'settings-sidebar-item--locked' : ''}`}
                onClick={() => { handleMainTabSelect('advanced', true); }}
                aria-disabled={isDemoLockedTab('advanced')}
                data-locked={isDemoLockedTab('advanced') ? 'true' : undefined}
              >
              <Wrench size="md" />
              <span>{t('settings.tabs.advanced')}</span>
            </button>
          </li>
          {isAdmin && (
            <li className="settings-mobile-sidebar-separator">
              <button
                className="settings-mobile-sidebar-item settings-mobile-sidebar-item--navigation"
                onClick={handleOpenAdminConsole}
              >
                <Star size="md" />
                <span>Admin Console</span>
              </button>
            </li>
          )}
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
                onClick={() => handleMainTabSelect('profile')}
              >
                <People size="md" />
                <span>{t('settings.tabs.profile')}</span>
              </button>
            </li>
            <li>
              <button
                className={`settings-desktop-sidebar-item ${mainTab === 'credentials' ? 'active' : ''} ${isDemoLockedTab('credentials') ? 'settings-sidebar-item--locked' : ''}`}
                onClick={() => handleMainTabSelect('credentials')}
                aria-disabled={isDemoLockedTab('credentials')}
                data-locked={isDemoLockedTab('credentials') ? 'true' : undefined}
              >
                <Lock size="md" />
                <span>{t('settings.tabs.credentials')}</span>
              </button>
            </li>
            <li>
              <button
                className={`settings-desktop-sidebar-item ${mainTab === 'general' ? 'active' : ''}`}
                onClick={() => handleMainTabSelect('general')}
              >
                <SettingsIcon size="md" />
                <span>{t('settings.tabs.general')}</span>
              </button>
            </li>
            <li>
              <button
                className={`settings-desktop-sidebar-item ${mainTab === 'searchMemory' ? 'active' : ''} ${isDemoLockedTab('searchMemory') ? 'settings-sidebar-item--locked' : ''}`}
                onClick={() => handleMainTabSelect('searchMemory')}
                aria-disabled={isDemoLockedTab('searchMemory')}
                data-locked={isDemoLockedTab('searchMemory') ? 'true' : undefined}
              >
                <List size="md" />
                <span>{t('settings.tabs.searchMemory')}</span>
              </button>
            </li>
            <li>
              <button
                className={`settings-desktop-sidebar-item ${mainTab === 'imageGen' ? 'active' : ''} ${isDemoLockedTab('imageGen') ? 'settings-sidebar-item--locked' : ''}`}
                onClick={() => handleMainTabSelect('imageGen')}
                aria-disabled={isDemoLockedTab('imageGen')}
                data-locked={isDemoLockedTab('imageGen') ? 'true' : undefined}
              >
                <Image size="md" />
                <span>{t('settings.tabs.imageGen')}</span>
              </button>
            </li>
            <li>
              <button
                className={`settings-desktop-sidebar-item ${mainTab === 'prompts' ? 'active' : ''} ${isDemoLockedTab('prompts') ? 'settings-sidebar-item--locked' : ''}`}
                onClick={() => handleMainTabSelect('prompts')}
                aria-disabled={isDemoLockedTab('prompts')}
                data-locked={isDemoLockedTab('prompts') ? 'true' : undefined}
              >
                <Document size="md" />
                <span>{t('settings.tabs.prompts')}</span>
              </button>
            </li>
            <li>
              <button
                className={`settings-desktop-sidebar-item ${mainTab === 'language' ? 'active' : ''}`}
                onClick={() => handleMainTabSelect('language')}
              >
                <Globe size="md" />
                <span>{t('settings.tabs.language')}</span>
              </button>
            </li>
            <li>
              <button
                className={`settings-desktop-sidebar-item ${mainTab === 'theme' ? 'active' : ''}`}
                onClick={() => handleMainTabSelect('theme')}
              >
                <Palette size="md" />
                <span>{t('settings.tabs.theme')}</span>
              </button>
            </li>
            <li>
              <button
                className={`settings-desktop-sidebar-item ${mainTab === 'advanced' ? 'active' : ''} ${isDemoLockedTab('advanced') ? 'settings-sidebar-item--locked' : ''}`}
                onClick={() => handleMainTabSelect('advanced')}
                aria-disabled={isDemoLockedTab('advanced')}
                data-locked={isDemoLockedTab('advanced') ? 'true' : undefined}
              >
                <Wrench size="md" />
                <span>{t('settings.tabs.advanced')}</span>
              </button>
            </li>
            {isAdmin && (
              <li className="settings-desktop-sidebar-separator">
                <button
                  className="settings-desktop-sidebar-item settings-desktop-sidebar-item--navigation"
                  onClick={handleOpenAdminConsole}
                >
                  <Star size="md" />
                  <span>Admin Console</span>
                </button>
              </li>
            )}
          </ul>
        </aside>

        {/* Panel Content */}
        <div className={`settings-panel-content${mainTab === 'prompts' || mainTab === 'general' || mainTab === 'searchMemory' ? ' settings-panel-content--fill' : ''}`}>
        {mainTab === 'profile' && <ProfilePanel />}

        {mainTab === 'credentials' && !localSettings.demoModeEnabled && (
          <CredentialsPanel
            credentials={localCredentials}
            storedProviders={storedProviders}
            isSyncing={isSyncingCredentials}
            onChange={setLocalCredentials}
          />
        )}

        {mainTab === 'searchMemory' && !localSettings.demoModeEnabled && (
          <SearchMemoryPanel
            settings={localSettings.searchMemorySettings}
            activeTarget={activeSearchMemoryTarget}
            onTargetChange={setActiveSearchMemoryTarget}
            onChange={(searchMemorySettings) =>
              setLocalSettings((prev) => ({
                ...prev,
                searchMemorySettings,
              }))
            }
            mainLanguage={localSettings.mainLanguage}
          />
        )}

        {mainTab === 'general' && (
          localSettings.demoModeEnabled ? (
            <DemoGeneralPanel
              enabled={localSettings.demoModeEnabled}
              onEnabledChange={(enabled) => { void handleDemoModeChange(enabled); }}
            />
          ) : (
            <GeneralPanel
              taskConfigSettings={localSettings.taskConfigSettings}
              activeTarget={activeGeneralTarget}
              onTargetChange={setActiveGeneralTarget}
              onTaskConfigSettingsChange={(taskConfigSettings) =>
                setLocalSettings((prev) => ({
                  ...prev,
                  taskConfigSettings,
                }))
              }
              llmCacheSettings={localSettings.llmCacheSettings}
              providerSpecs={providerSpecs}
              providerSpecsLoaded={providerSpecsLoaded}
              providerSpecsLoading={providerSpecsLoading}
              providerSpecsError={providerSpecsError}
              onLlmCacheSettingsChange={(llmCacheSettings) =>
                setLocalSettings((prev) => ({
                  ...prev,
                  llmCacheSettings,
                }))
              }
              customThinkingTemplates={localSettings.customThinkingTemplates}
              onTemplatesChange={(templates) =>
                setLocalSettings(prev => ({ ...prev, customThinkingTemplates: templates }))
              }
            />
          )
        )}

        {mainTab === 'imageGen' && !localSettings.demoModeEnabled && (
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
              setStoreTheme(theme);
            }}
          />
        )}

        {hasMountedPromptsPanel && !localSettings.demoModeEnabled && (
          <div
            style={{
              display: mainTab === 'prompts' ? 'flex' : 'none',
              flex: 1,
              minHeight: 0,
            }}
          >
            <PromptsTemplatesPanel
              key={promptsPanelKey}
              ref={promptsPanelRef}
              onUnsavedCountChange={handlePromptUnsavedCountChange}
            />
          </div>
        )}

        {mainTab === 'advanced' && !localSettings.demoModeEnabled && (
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
            llmLoggingEnabled={localSettings.llmLoggingEnabled}
            onLlmLoggingEnabledChange={(enabled) =>
              setLocalSettings(prev => ({ ...prev, llmLoggingEnabled: enabled }))
            }
            onViewLlmLogs={() => setShowLlmLogViewer(true)}
          />
        )}
        </div>
      </div>
      </BaseModal>

    {showLlmLogViewer && (
      <LLMLogViewer onClose={() => setShowLlmLogViewer(false)} />
    )}

    </SettingsToastProvider>
  );
};

export default SettingsModal;
