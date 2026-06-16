import { getProviderSpec } from '../data/providers/providerSelectors';
import { cloneValue, normalizeByPublicSpec, resolveEffectiveLlmTaskSpec } from '../providerEngine/utils';

export type ProviderType = string;
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
  provider_settings?: Record<string, unknown>;
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
  normalized.provider = typeof normalized.provider === 'string' ? normalized.provider : '';
  normalized.model = typeof normalized.model === 'string' ? normalized.model : '';
  normalized.temperature = Number.isFinite(normalized.temperature) ? normalized.temperature : 0.7;
  normalized.advanced = normalized.advanced && typeof normalized.advanced === 'object'
    ? normalized.advanced
    : ({ thinking_mode: 'off' } as TaskAIConfig['advanced']);
  if (!['off', 'model', 'custom'].includes(normalized.advanced.thinking_mode)) {
    normalized.advanced.thinking_mode = 'off';
  }
  if (!normalized.advanced.provider_settings || typeof normalized.advanced.provider_settings !== 'object' || Array.isArray(normalized.advanced.provider_settings)) {
    normalized.advanced.provider_settings = {};
  }
  const provider = getProviderSpec(normalized.provider);
  const spec = resolveEffectiveLlmTaskSpec(provider, normalized as unknown as Record<string, unknown>);
  if (!provider || !spec) {
    return normalized;
  }
  return normalizeByPublicSpec(normalized as unknown as Record<string, unknown>, spec) as unknown as TaskAIConfig;
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
