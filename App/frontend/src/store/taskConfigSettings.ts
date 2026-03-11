export type ProviderType = 'openai' | 'gemini' | 'claude' | 'openrouter' | 'custom' | 'xai';
export type AITaskType = 'agent' | 'translation' | 'editAssistant' | 'imagePrompt' | 'summary' | 'subAgent';
export type CustomKind = 'openai_completion' | 'openai_response' | 'claude';
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
  custom_kind?: CustomKind | null;
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

export interface TaskConfigSettings {
  general: TaskAIConfig;
  overrides: Partial<Record<AITaskType, TaskAIConfig>>;
}

export const TASK_CONFIG_TASK_TYPES: AITaskType[] = [
  'agent',
  'translation',
  'editAssistant',
  'imagePrompt',
  'summary',
  'subAgent',
];

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

function normalizeTaskConfigSettingsInternal(settings: TaskConfigSettings): TaskConfigSettings {
  const general = normalizeEffectiveTaskConfig(settings.general);
  const overrides: Partial<Record<AITaskType, TaskAIConfig>> = {};

  for (const taskType of TASK_CONFIG_TASK_TYPES) {
    const override = settings.overrides[taskType];
    if (!override) continue;
    overrides[taskType] = normalizeEffectiveTaskConfig(override);
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
    delete advanced.custom_kind;
    delete advanced.custom_thinking_template_id;
  } else {
    advanced.custom_kind = advanced.custom_kind ?? 'openai_completion';
    if (advanced.custom_kind !== 'openai_completion') {
      delete advanced.custom_thinking_template_id;
    }
  }

  if (advanced.thinking_mode !== 'model') {
    delete advanced.thinking_config;
    delete advanced.custom_thinking_template_id;
  }

  if (normalized.provider !== 'openai' && !(normalized.provider === 'custom' && advanced.custom_kind === 'openai_response')) {
    delete advanced.verbosity;
  }

  normalized.advanced = advanced;
  return normalized;
}

export function resolveTaskConfig(settings: TaskConfigSettings, taskType: AITaskType): TaskAIConfig {
  const normalized = normalizeTaskConfigSettingsInternal(settings);
  return cloneValue(normalized.overrides[taskType] ?? normalized.general);
}

export function resolveAllTaskConfigs(settings: TaskConfigSettings): Record<AITaskType, TaskAIConfig> {
  const normalized = normalizeTaskConfigSettingsInternal(settings);
  return Object.fromEntries(
    TASK_CONFIG_TASK_TYPES.map((taskType) => [taskType, cloneValue(normalized.overrides[taskType] ?? normalized.general)])
  ) as Record<AITaskType, TaskAIConfig>;
}

export function hasTaskOverride(settings: TaskConfigSettings, taskType: AITaskType): boolean {
  return Object.prototype.hasOwnProperty.call(settings.overrides, taskType);
}

export function getTaskOverride(settings: TaskConfigSettings, taskType: AITaskType): TaskAIConfig | undefined {
  return settings.overrides[taskType];
}
