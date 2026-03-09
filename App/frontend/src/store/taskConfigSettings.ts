export type ProviderType = 'openai' | 'gemini' | 'claude' | 'openrouter' | 'custom' | 'xai';
export type AITaskType = 'agent' | 'translation' | 'editAssistant' | 'imagePrompt' | 'summary' | 'subAgent';
export type RequestFormat = 'openai_sdk' | 'claude_sdk' | 'openai_responses';
export type TokenizerOverride = 'openai' | 'claude' | 'gemini';

export interface ProviderPreference {
  only?: string[] | null;
  ignore?: string[] | null;
}

export interface ThinkingConfig {
  effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null;
  max_tokens?: number | null;
  gemini_thinking_level?: 'minimal' | 'low' | 'medium' | 'high' | null;
  gemini_budget_tokens?: number | null;
}

export interface AdvancedTaskSettings {
  thinking_mode: 'off' | 'model' | 'custom';
  thinking_config?: ThinkingConfig | null;
  custom_thinking_template_id?: string | null;
  tokenizer_override?: TokenizerOverride | null;
  request_format?: RequestFormat | null;
  verbosity?: 'low' | 'medium' | 'high' | null;
}

export interface TaskAIConfig {
  provider: ProviderType;
  model: string;
  temperature: number;
  provider_preference?: ProviderPreference | null;
  max_output_tokens?: number | null;
  context_window_tokens?: number | null;
  advanced: AdvancedTaskSettings;
}

export interface ProviderPreferenceOverride {
  only?: string[] | null;
  ignore?: string[] | null;
}

export interface ThinkingConfigOverride {
  effort?: ThinkingConfig['effort'];
  max_tokens?: number | null;
  gemini_thinking_level?: ThinkingConfig['gemini_thinking_level'];
  gemini_budget_tokens?: number | null;
}

export interface AdvancedTaskSettingsOverride {
  thinking_mode?: AdvancedTaskSettings['thinking_mode'] | null;
  thinking_config?: ThinkingConfigOverride | null;
  custom_thinking_template_id?: string | null;
  tokenizer_override?: TokenizerOverride | null;
  request_format?: RequestFormat | null;
  verbosity?: 'low' | 'medium' | 'high' | null;
}

export interface TaskAIConfigOverride {
  provider?: ProviderType | null;
  model?: string | null;
  temperature?: number | null;
  provider_preference?: ProviderPreferenceOverride | null;
  max_output_tokens?: number | null;
  context_window_tokens?: number | null;
  advanced?: AdvancedTaskSettingsOverride | null;
}

export interface TaskConfigSettings {
  general: TaskAIConfig;
  overrides: Partial<Record<AITaskType, TaskAIConfigOverride>>;
}

export const TASK_CONFIG_TASK_TYPES: AITaskType[] = [
  'agent',
  'translation',
  'editAssistant',
  'imagePrompt',
  'summary',
  'subAgent',
];

function deepMerge<T>(base: T, override: unknown): T {
  if (
    base !== null &&
    typeof base === 'object' &&
    !Array.isArray(base) &&
    override !== null &&
    typeof override === 'object' &&
    !Array.isArray(override)
  ) {
    const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
      if (key in merged) {
        merged[key] = deepMerge(merged[key], value);
      } else {
        merged[key] = cloneValue(value);
      }
    }
    return merged as T;
  }
  return cloneValue(override) as T;
}

function cloneValue<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, cloneValue(child)])
    ) as T;
  }
  return value;
}

function pruneEmptyObjects<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => pruneEmptyObjects(item)) as T;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => [key, pruneEmptyObjects(child)] as const)
      .filter(([, child]) => !(child && typeof child === 'object' && !Array.isArray(child) && Object.keys(child).length === 0));
    return Object.fromEntries(entries) as T;
  }
  return value;
}

function diffValues(base: unknown, effective: unknown): unknown {
  if (
    base !== null &&
    typeof base === 'object' &&
    !Array.isArray(base) &&
    effective !== null &&
    typeof effective === 'object' &&
    !Array.isArray(effective)
  ) {
    const patch: Record<string, unknown> = {};
    const keys = new Set([
      ...Object.keys(base as Record<string, unknown>),
      ...Object.keys(effective as Record<string, unknown>),
    ]);

    for (const key of keys) {
      const baseRecord = base as Record<string, unknown>;
      const effectiveRecord = effective as Record<string, unknown>;
      if (!(key in effectiveRecord)) {
        patch[key] = null;
        continue;
      }
      if (!(key in baseRecord)) {
        patch[key] = cloneValue(effectiveRecord[key]);
        continue;
      }

      const child = diffValues(baseRecord[key], effectiveRecord[key]);
      if (child !== NO_DIFF) {
        patch[key] = child;
      }
    }

    return Object.keys(patch).length > 0 ? patch : NO_DIFF;
  }

  return Object.is(base, effective) ? NO_DIFF : cloneValue(effective);
}

const NO_DIFF = Symbol('NO_DIFF');

function normalizeTaskConfigSettingsInternal(settings: TaskConfigSettings): TaskConfigSettings {
  const general = normalizeEffectiveTaskConfig(settings.general);
  const overrides: Partial<Record<AITaskType, TaskAIConfigOverride>> = {};

  for (const taskType of TASK_CONFIG_TASK_TYPES) {
    const override = settings.overrides[taskType];
    if (!override) continue;
    const effective = normalizeEffectiveTaskConfig(deepMerge(general, override));
    overrides[taskType] = diffTaskOverride(general, effective);
  }

  return {
    general,
    overrides,
  };
}

export function normalizeEffectiveTaskConfig(config: TaskAIConfig): TaskAIConfig {
  const normalized = cloneValue(config);
  const advanced = cloneValue(normalized.advanced);

  if (normalized.provider !== 'openrouter') {
    delete normalized.provider_preference;
  }

  if (normalized.provider !== 'openrouter' && normalized.provider !== 'custom') {
    delete advanced.tokenizer_override;
  }

  if (normalized.provider !== 'custom') {
    delete advanced.request_format;
    delete advanced.custom_thinking_template_id;
  } else if (advanced.request_format !== 'openai_sdk') {
    delete advanced.custom_thinking_template_id;
  }

  if (advanced.thinking_mode !== 'model') {
    delete advanced.thinking_config;
    delete advanced.custom_thinking_template_id;
  }

  if (normalized.provider !== 'openai' && !(normalized.provider === 'custom' && advanced.request_format === 'openai_responses')) {
    delete advanced.verbosity;
  }

  normalized.advanced = advanced;
  return normalized;
}

export function diffTaskOverride(general: TaskAIConfig, effective: TaskAIConfig): TaskAIConfigOverride {
  const patch = diffValues(normalizeEffectiveTaskConfig(general), normalizeEffectiveTaskConfig(effective));
  if (patch === NO_DIFF) {
    return {};
  }
  return pruneEmptyObjects(patch as TaskAIConfigOverride);
}

export function resolveTaskConfig(settings: TaskConfigSettings, taskType: AITaskType): TaskAIConfig {
  const normalized = normalizeTaskConfigSettingsInternal(settings);
  const override = normalized.overrides[taskType] ?? {};
  return normalizeEffectiveTaskConfig(deepMerge(normalized.general, override));
}

export function resolveAllTaskConfigs(settings: TaskConfigSettings): Record<AITaskType, TaskAIConfig> {
  const normalized = normalizeTaskConfigSettingsInternal(settings);
  return Object.fromEntries(
    TASK_CONFIG_TASK_TYPES.map((taskType) => [taskType, resolveTaskConfig(normalized, taskType)])
  ) as Record<AITaskType, TaskAIConfig>;
}

export function hasTaskOverride(settings: TaskConfigSettings, taskType: AITaskType): boolean {
  return Object.prototype.hasOwnProperty.call(settings.overrides, taskType);
}

export function getTaskOverride(settings: TaskConfigSettings, taskType: AITaskType): TaskAIConfigOverride | undefined {
  return settings.overrides[taskType];
}
