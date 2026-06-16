/**
 * Settings types + constants — the single home for the user-settings shape.
 *
 * Moved out of the deleted `store/settingsStore.ts`. The server settings live in
 * the TanStack Query cache (`data/settings`), but the TYPES live here so that
 * pure modules (`settingsUpdatePayload`, panels) and consumers can import them
 * without depending on the data/query layer.
 *
 * Re-exports the task-config and search/memory types so this module stays the
 * one-stop import point those consumers already used via `settingsStore`.
 */

import type { SearchMemorySettings } from '../store/searchMemorySettings';
import type { TaskConfigSettings } from '../store/taskConfigSettings';

export type {
  AdvancedTaskSettings,
  AITaskType,
  CustomKind,
  ProviderPreference,
  ProviderType,
  TaskAIConfig,
  TaskConfigSettings,
  TokenizerOverride,
  ThinkingConfig,
} from '../store/taskConfigSettings';
export type {
  EmbeddingConfig,
  EmbeddingProviderType,
  MemoryConfig,
  RetrievalConfig,
  SearchGeneralConfig,
  SearchMemorySettings,
  SearchMemoryTarget,
} from '../store/searchMemorySettings';

// Types
export type ImageProviderType = string;
export type PromptType = 'natural' | 'tag_based';
export type ThemeMode = 'light' | 'dark' | 'system';

// Supported UI languages for interface localization
export const SUPPORTED_UI_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ko', name: '한국어' },
] as const;

export type UILanguageCode = typeof SUPPORTED_UI_LANGUAGES[number]['code'];

// Provider configurations (credentials only - shared across functions)
export type ProviderCredentialDraft = Record<string, string>;
export type ProviderCredentials = Record<string, ProviderCredentialDraft>;

// Custom thinking template types
export type CustomThinkingEffortValueType = 'string' | 'number' | 'boolean';

export interface CustomThinkingEffortField {
  path: string;
  value: string;
  value_type: CustomThinkingEffortValueType;
}

export interface CustomThinkingResponseField {
  path: string;
  as_var: string;
  is_stream_delta?: boolean;
}

export interface CustomThinkingHistoryField {
  path: string;
  in_var: string;
}

export interface CustomThinkingTemplate {
  id?: string;
  name: string;
  effort_fields: CustomThinkingEffortField[];
  response_fields: CustomThinkingResponseField[];
  history_fields: CustomThinkingHistoryField[];
}

// Retry configuration for error handling
export interface RetryConfig {
  enabled: boolean;                  // Enable/disable retry logic
  maxRetries: number;                // Number of retry attempts (0-10)
  retryableStatusCodes: number[];    // HTTP status codes to retry on
  retryDelayMs: number;              // Delay between retries in ms
}

// Tool call auto-approve configuration (confirmation bypass)
export type ToolCallAutoApproveCategory =
  | 'read'
  | 'write'
  | 'delete'
  | 'translate'
  | 'sub_agent'
  | 'generate'
  | 'mcp';

export const TOOL_CALL_AUTO_APPROVE_CATEGORIES: ToolCallAutoApproveCategory[] = [
  'read',
  'write',
  'delete',
  'translate',
  'sub_agent',
  'generate',
  'mcp',
];

export type ToolCallAutoApproveConfig = Record<ToolCallAutoApproveCategory, boolean>;

// Custom image style for natural language providers (prefix/postfix)
export interface NaturalImageStyle {
  id: string;
  name: string;
  prefix: string;   // Prepended to prompt
  postfix: string;  // Appended to prompt
}

// Custom image style for tag-based providers (prefix/postfix for positive and negative prompts)
export interface TagBasedImageStyle {
  id: string;
  name: string;
  positivePrefix: string;   // Prepended to positive prompt
  positivePostfix: string;  // Appended to positive prompt
  negativePrefix: string;   // Prepended to negative prompt
  negativePostfix: string;  // Appended to negative prompt
}

// Image generation configuration
export interface ImageGenConfig {
  provider: ImageProviderType;
  model: string;
  aspect_ratio: string;
  image_size: string;
  [key: string]: unknown;

  // Separate custom styles per prompt type
  naturalStyles: NaturalImageStyle[];      // For OpenAI, Gemini, xAI
  tagBasedStyles: TagBasedImageStyle[];    // For NovelAI
  selectedNaturalStyleId: string | null;
  selectedTagBasedStyleId: string | null;

  // Per-provider settings
  providerSettings: Record<string, Record<string, unknown>>;
}

// Main settings interface
export interface Settings {
  taskConfigSettings: TaskConfigSettings;

  // Image generation configuration
  imageGenConfig: ImageGenConfig;

  // Custom thinking templates (for custom provider openai_completion mode)
  customThinkingTemplates: CustomThinkingTemplate[];

  // Language settings
  mainLanguage: string;
  subLanguages: string[];
  defaultSubLanguage: string | null;
  uiLanguage: UILanguageCode; // UI localization language (i18next)

  // Theme settings
  theme: ThemeMode;

  // Retry configuration (global)
  retryConfig: RetryConfig;

  // Native output mode - skip tool calling and output raw text/XML
  nativeOutputMode: boolean;

  // Search & Memory settings
  searchMemorySettings: SearchMemorySettings;

  // LLM request logging - enable logging of LLM requests for debugging
  llmLoggingEnabled: boolean;

  // Tool call history limit - how many recent assistant messages to include tool calls for
  // 0 = none, 1-10 = last N messages, -1 = all
  toolCallHistoryLimit: number;

  // Thinking history limit - how many recent assistant messages to include thinking for
  // 0 = none, 1-10 = last N messages, -1 = all
  thinkingHistoryLimit: number;

  // Tool call auto-approve settings (all-or-none per assistant response)
  toolCallAutoApprove: ToolCallAutoApproveConfig;

  // Demo mode toggle for first-run guided experience
  demoModeEnabled: boolean;
}

export interface SettingsUpdatePayload {
  taskConfigSettings?: TaskConfigSettings;
  imageGenConfig?: ImageGenConfig;
  customThinkingTemplates?: CustomThinkingTemplate[];
  mainLanguage?: string;
  subLanguages?: string[];
  defaultSubLanguage?: string | null;
  uiLanguage?: UILanguageCode;
  theme?: ThemeMode;
  retryConfig?: RetryConfig;
  nativeOutputMode?: boolean;
  searchMemorySettings?: SearchMemorySettings;
  llmLoggingEnabled?: boolean;
  toolCallHistoryLimit?: number;
  thinkingHistoryLimit?: number;
  toolCallAutoApprove?: ToolCallAutoApproveConfig;
  demoModeEnabled?: boolean;
}

export type SettingsLoadStatus = 'idle' | 'loading' | 'ready' | 'error';
