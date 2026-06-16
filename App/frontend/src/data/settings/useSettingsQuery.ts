/**
 * User settings as a TanStack Query.
 *
 * Replaces the `settingsStore` server half. Settings load once per session
 * (the old store guarded re-loads with `status === 'ready'`), so
 * `staleTime: Infinity` serves every consumer from a single fetch. The 9 unused
 * draft setters from the old store are dropped entirely; `setTheme` survives as
 * a live cache patch (`setThemeInSettingsCache`) and persistence flows through
 * `useSaveSettingsMutation`.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { settingsService } from '../../api/settingsService';
import { queryClient } from '../queryClient';
import { settingsKeys } from '../keys/settingsKeys';
import {
  resolveAllTaskConfigs,
  resolveTaskConfig,
} from '../../store/taskConfigSettings';
import type { AITaskType } from '../../store/taskConfigSettings';
import type { Settings, ThemeMode } from '../../domain/settings';

const SETTINGS_NOT_LOADED_ERROR =
  'Settings are not loaded. Make sure you are in an authenticated route and settings have been loaded from the server.';

function requireSettings(settings: Settings | undefined): Settings {
  if (!settings) {
    throw new Error(SETTINGS_NOT_LOADED_ERROR);
  }
  return settings;
}

/** Shared options so non-React callers (`fetchQuery`) use the same key/fetcher. */
export const settingsQueryOptions = {
  queryKey: settingsKeys.settings(),
  queryFn: () => settingsService.getSettings(),
  staleTime: Infinity,
} as const;

export function useSettingsQuery() {
  return useQuery(settingsQueryOptions);
}

/**
 * The loaded settings, or throw — preserves the old `getSettings()` contract.
 * Safe because `ProtectedLayout` gates app render on a successful settings load.
 */
export function useSettings(): Settings {
  return requireSettings(useSettingsQuery().data);
}

/** The configured main (authoring) language. */
export function useMainLanguage(): string {
  return useSettings().mainLanguage;
}

/** Resolved AI task config for a task type (override ?? general, normalized). */
export function useResolvedTaskConfig(taskType: AITaskType) {
  const taskConfigSettings = useSettings().taskConfigSettings;
  return useMemo(
    () => resolveTaskConfig(taskConfigSettings, taskType),
    [taskConfigSettings, taskType],
  );
}

/** Resolved AI task configs for every task type. */
export function useResolvedTaskConfigs() {
  const taskConfigSettings = useSettings().taskConfigSettings;
  return useMemo(
    () => resolveAllTaskConfigs(taskConfigSettings),
    [taskConfigSettings],
  );
}

// --- Non-React cache access (for runtime/imperative call sites) ---

/** Read settings from cache without subscribing; undefined until loaded. */
export function readSettingsFromCache(): Settings | undefined {
  return queryClient.getQueryData<Settings>(settingsKeys.settings());
}

/** Read settings from cache or throw — mirrors the old `getState().getSettings()`. */
export function requireSettingsFromCache(): Settings {
  return requireSettings(readSettingsFromCache());
}

/**
 * Patch theme into the settings cache for live preview (no server write).
 * Matches the old `setTheme` setter, which mutated local state only; the
 * SettingsModal persists it on Save via `useSaveSettingsMutation`.
 */
export function setThemeInSettingsCache(theme: ThemeMode): void {
  queryClient.setQueryData<Settings>(settingsKeys.settings(), (prev) =>
    prev ? { ...prev, theme } : prev,
  );
}

/** Drop all settings-domain queries (settings + scenarios + searchMemory). For logout. */
export function clearSettingsCache(): void {
  queryClient.removeQueries({ queryKey: settingsKeys.all });
}
