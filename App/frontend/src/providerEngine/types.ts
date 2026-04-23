export type PublicConditionOp =
  | 'eq'
  | 'neq'
  | 'in'
  | 'not_in'
  | 'truthy'
  | 'falsy'
  | 'regex'
  | 'not_regex'
  | 'flag';

export interface PublicCondition {
  op: PublicConditionOp;
  path?: string | null;
  value?: unknown;
  flag?: string | null;
  pattern?: string | null;
}

export interface PublicUIHint {
  widget?: 'text' | 'password' | 'number' | 'select' | 'json' | 'toggle' | 'hidden' | 'template_select' | 'radio_cards' | 'slider' | null;
  label_key?: string | null;
  placeholder_key?: string | null;
  help_key?: string | null;
  section?: string | null;
  order?: number | null;
  link_url?: string | null;
  link_label?: string | null;
  option_label_prefix?: string | null;
}

export interface PublicFieldSpec {
  kind: 'string' | 'number' | 'int' | 'bool' | 'enum' | 'object' | 'array' | 'literal';
  expose: boolean;
  required: boolean;
  options: unknown[];
  disabled_options: unknown[];
  when: PublicCondition[];
  disabled_when: PublicCondition[];
  ui?: PublicUIHint | null;
  default?: unknown;
  const?: unknown;
  min_value?: number | null;
  max_value?: number | null;
  step?: number | null;
}

export interface PublicObjectSpec {
  kind: 'object';
  expose: boolean;
  when: PublicCondition[];
  fields: Record<string, PublicSchemaNode>;
  group_toggle?: string | null;
}

export type PublicSchemaNode = PublicFieldSpec | PublicObjectSpec;

export interface PublicLLMVariantSpec {
  id: string;
  task_config: PublicObjectSpec;
}

export interface PublicLLMSpec {
  variant_path?: string | null;
  default_variant?: string | null;
  supports_tools: boolean;
  supports_thinking: boolean;
  common_task_config: PublicObjectSpec;
  variants: Record<string, PublicLLMVariantSpec>;
}

export interface PublicEmbeddingSpec {
  config: PublicObjectSpec;
}

export interface PublicImageModelGeometrySpec {
  supported_aspect_ratios: string[];
  supported_resolutions: string[];
  default_aspect_ratio: string;
  default_resolution: string;
  resolution_mode: 'native_exact' | 'native_tier' | 'translated_fixed';
  native_size_by_ratio?: Record<string, string> | null;
  supported_geometry_pairs?: Record<string, string[]> | null;
}

export interface PublicImageModelDescriptor {
  id: string;
  name: string;
  prompt_type: 'natural' | 'tag_based';
  supports_image_input: boolean;
  supports_mask_input?: boolean;
  supports_multi_image_input?: boolean;
  geometry: PublicImageModelGeometrySpec;
  description?: string | null;
  canonical_slug?: string | null;
  owned_by?: string | null;
  icon_url?: string | null;
  tags?: string[] | null;
  category?: string | null;
  architecture?: {
    input_modalities?: string[] | null;
    output_modalities?: string[] | null;
    tokenizer?: string | null;
    instruct_type?: string | null;
  } | null;
  pricing?: {
    prompt?: string | null;
    completion?: string | null;
    image?: string | null;
  } | null;
  capabilities?: Record<string, unknown> | null;
  supported_parameters?: Record<string, unknown> | null;
}

export interface PublicImageSpec {
  prompt_type: 'natural' | 'tag_based';
  supports_image_input: boolean;
  provider_settings?: PublicObjectSpec | null;
  settings_title_key?: string | null;
  settings_description_key?: string | null;
  models: PublicImageModelDescriptor[];
  has_dynamic_models: boolean;
  catalog_cache_policy: 'static' | 'session' | 'none';
  allow_missing_credentials_for_model_listing: boolean;
}

export interface PublicProviderUI {
  display_name_key: string;
  icon_key: string;
  description_key?: string | null;
  llm_order?: number | null;
  embedding_order?: number | null;
  image_order?: number | null;
  model_browser_grouping_llm: 'flat' | 'openai_series' | 'gemini_family' | 'provider_family';
  model_browser_grouping_embedding: 'flat' | 'provider_family';
  llm_show_architecture: boolean;
  llm_show_pricing: boolean;
  llm_show_endpoints: boolean;
  embedding_show_architecture: boolean;
  embedding_show_pricing: boolean;
  embedding_show_endpoints: boolean;
}

export interface PublicProviderSpec {
  id: string;
  ui: PublicProviderUI;
  credentials: PublicObjectSpec;
  llm?: PublicLLMSpec | null;
  embedding?: PublicEmbeddingSpec | null;
  image?: PublicImageSpec | null;
}

export interface PublicProviderSpecResponse {
  providers: PublicProviderSpec[];
}
