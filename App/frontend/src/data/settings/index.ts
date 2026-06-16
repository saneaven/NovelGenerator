/**
 * Settings data layer barrel — the one-stop import point that the old
 * `store/settingsStore` provided: query hooks, the save mutation, scenario
 * helpers, all settings types/constants, and the pure search/memory helpers.
 */

// Types + constants (Settings, ThemeMode, ImageGenConfig, SUPPORTED_UI_LANGUAGES,
// TOOL_CALL_AUTO_APPROVE_CATEGORIES, re-exported task-config + search/memory types, ...).
export * from '../../domain/settings';

// Query hooks + non-React cache access.
export {
  settingsQueryOptions,
  useSettingsQuery,
  useSettings,
  useMainLanguage,
  useResolvedTaskConfig,
  useResolvedTaskConfigs,
  readSettingsFromCache,
  requireSettingsFromCache,
  setThemeInSettingsCache,
  clearSettingsCache,
} from './useSettingsQuery';

// Persistence.
export { useSaveSettingsMutation } from './mutations/useSettingsMutations';

// Scenario documents.
export { fetchScenario, readScenarioFromCache, invalidateScenario } from './useScenario';

// Pure search/memory helpers (the old store re-exported these verbatim).
export {
  hasSearchMemoryOverride,
  makeInitialSearchMemorySettings,
  makeMemoryOverrideSeed,
  makeSearchOverrideSeed,
  resolveMemorySettings,
  resolveSearchSettings,
  validateSearchMemorySettings,
} from '../../store/searchMemorySettings';
