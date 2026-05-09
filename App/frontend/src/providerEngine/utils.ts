import type { TFunction } from 'i18next';
import { Claude, CustomProvider, Gemini, NovelAI, OpenAI, OpenRouter, Settings as GenericProviderIcon, XAI } from '../components/icons';
import type {
  PublicCondition,
  PublicFieldSpec,
  PublicImageModelDescriptor,
  PublicLLMSpec,
  PublicObjectSpec,
  PublicProviderSpec,
  PublicSchemaNode,
} from './types';

type JsonObject = Record<string, unknown>;
const SUPPORTED_REGEX_FLAGS = new Set(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y']);
const CONDITION_REGEX_CACHE = new Map<string, RegExp | null>();

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function cloneValue<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneValue(child)])
    ) as T;
  }
  return value;
}

export function getPathValue(value: unknown, path: string | null | undefined): unknown {
  if (!path) return undefined;
  return String(path)
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((current, segment) => {
      if (!isPlainObject(current)) return undefined;
      return current[segment];
    }, value);
}

function compileConditionRegex(pattern: string): RegExp | null {
  const cached = CONDITION_REGEX_CACHE.get(pattern);
  if (cached !== undefined) return cached;

  let source = pattern;
  let flags = '';
  let match = source.match(/^\(\?([A-Za-z]+)\)/);

  while (match) {
    for (const flag of match[1]) {
      if (SUPPORTED_REGEX_FLAGS.has(flag) && !flags.includes(flag)) {
        flags += flag;
      }
    }
    source = source.slice(match[0].length);
    match = source.match(/^\(\?([A-Za-z]+)\)/);
  }

  try {
    const compiled = new RegExp(source, flags);
    CONDITION_REGEX_CACHE.set(pattern, compiled);
    return compiled;
  } catch {
    CONDITION_REGEX_CACHE.set(pattern, null);
    return null;
  }
}

function evaluateCondition(condition: PublicCondition, rootValue: JsonObject, flags: Record<string, unknown>): boolean {
  if (condition.op === 'flag') {
    return Boolean(flags[String(condition.flag || '')]);
  }

  const candidate = getPathValue(rootValue, condition.path);
  switch (condition.op) {
    case 'eq':
      return candidate === condition.value;
    case 'neq':
      return candidate !== condition.value;
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(candidate);
    case 'not_in':
      return Array.isArray(condition.value) && !condition.value.includes(candidate);
    case 'truthy':
      return Boolean(candidate);
    case 'falsy':
      return !candidate;
    case 'regex': {
      if (typeof candidate !== 'string') return false;
      const regex = compileConditionRegex(condition.pattern || '');
      return regex ? regex.test(candidate) : false;
    }
    case 'not_regex': {
      if (typeof candidate !== 'string') return true;
      const regex = compileConditionRegex(condition.pattern || '');
      return regex ? !regex.test(candidate) : true;
    }
    default:
      return false;
  }
}

export function isNodeVisible(node: PublicSchemaNode, rootValue: JsonObject, flags: Record<string, unknown> = {}): boolean {
  if (node.expose === false) return false;
  const conditions = 'when' in node ? node.when : [];
  if (!conditions.length) return true;
  return conditions.every((condition) => evaluateCondition(condition, rootValue, flags));
}

export function isNodeActive(node: PublicSchemaNode, rootValue: JsonObject, flags: Record<string, unknown> = {}): boolean {
  const conditions = 'when' in node ? node.when : [];
  if (!conditions.length) return true;
  return conditions.every((condition) => evaluateCondition(condition, rootValue, flags));
}

export function isNodeDisabled(node: PublicSchemaNode, rootValue: JsonObject, flags: Record<string, unknown> = {}): boolean {
  if (isObjectSpec(node)) return false;
  const conditions = node.disabled_when ?? [];
  if (!conditions.length) return false;
  return conditions.every((condition) => evaluateCondition(condition, rootValue, flags));
}

export function isObjectSpec(node: PublicSchemaNode): node is PublicObjectSpec {
  return 'fields' in node && isPlainObject(node.fields);
}

function mergeNodes(baseNode: PublicSchemaNode, overrideNode: PublicSchemaNode): PublicSchemaNode {
  if (!isObjectSpec(baseNode) || !isObjectSpec(overrideNode)) {
    return cloneValue(overrideNode);
  }
  const mergedFields: Record<string, PublicSchemaNode> = {};
  const keys = new Set([...Object.keys(baseNode.fields), ...Object.keys(overrideNode.fields)]);
  for (const key of keys) {
    const baseChild = baseNode.fields[key];
    const overrideChild = overrideNode.fields[key];
    if (!baseChild) {
      mergedFields[key] = cloneValue(overrideChild);
      continue;
    }
    if (!overrideChild) {
      mergedFields[key] = cloneValue(baseChild);
      continue;
    }
    mergedFields[key] = mergeNodes(baseChild, overrideChild);
  }
  return {
    kind: 'object',
    expose: baseNode.expose && overrideNode.expose,
    when: [...(baseNode.when || []), ...(overrideNode.when || [])],
    fields: mergedFields,
  };
}

export function mergeObjectSpecs(baseSpec: PublicObjectSpec, overrideSpec: PublicObjectSpec): PublicObjectSpec {
  return mergeNodes(baseSpec, overrideSpec) as PublicObjectSpec;
}

export function resolveLlmVariant(spec: PublicLLMSpec | null | undefined, value: JsonObject | undefined): string | null {
  if (!spec) return null;
  const hinted = spec.variant_path ? getPathValue(value, spec.variant_path) : undefined;
  const raw = typeof hinted === 'string' && hinted.trim() ? hinted.trim() : spec.default_variant;
  if (raw && spec.variants[raw]) return raw;
  const first = Object.keys(spec.variants)[0];
  return first ?? null;
}

export function resolveEffectiveLlmTaskSpec(provider: PublicProviderSpec | undefined, value: JsonObject): PublicObjectSpec | null {
  if (!provider?.llm) return null;
  const variantId = resolveLlmVariant(provider.llm, value);
  const variant = variantId ? provider.llm.variants[variantId] : undefined;
  if (!variant) return provider.llm.common_task_config;
  return mergeObjectSpecs(provider.llm.common_task_config, variant.task_config);
}

const SKIP = Symbol('skip');

function normalizeFieldValue(raw: unknown, spec: PublicFieldSpec): unknown {
  const hasDefault = Object.prototype.hasOwnProperty.call(spec, 'default');
  let value = raw;

  if (value === null || value === undefined || value === '') {
    if (spec.kind === 'literal' && Object.prototype.hasOwnProperty.call(spec, 'const')) {
      return spec.const;
    }
    if (hasDefault) return cloneValue(spec.default);
    if (spec.required) {
      if (spec.kind === 'bool') return false;
      if (spec.kind === 'array') return [];
      if (spec.kind === 'object') return {};
      return '';
    }
    return SKIP;
  }

  switch (spec.kind) {
    case 'literal':
      return Object.prototype.hasOwnProperty.call(spec, 'const') ? spec.const : value;
    case 'string':
      return String(value);
    case 'number': {
      const next = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(next) ? next : hasDefault ? cloneValue(spec.default) : SKIP;
    }
    case 'int': {
      const next = typeof value === 'number' ? value : parseInt(String(value), 10);
      return Number.isFinite(next) ? Math.trunc(next) : hasDefault ? cloneValue(spec.default) : SKIP;
    }
    case 'bool':
      return Boolean(value);
    case 'enum':
      if ((!spec.options.length || spec.options.includes(value)) && !spec.disabled_options.includes(value)) return value;
      return hasDefault ? cloneValue(spec.default) : SKIP;
    case 'object':
      return isPlainObject(value) ? cloneValue(value) : hasDefault ? cloneValue(spec.default) : {};
    case 'array':
      return Array.isArray(value) ? cloneValue(value) : hasDefault ? cloneValue(spec.default) : [];
    default:
      if (spec.disabled_options.includes(value)) {
        return hasDefault ? cloneValue(spec.default) : SKIP;
      }
      return value;
  }
}

export function normalizeByPublicSpec(value: JsonObject, spec: PublicObjectSpec, rootValue?: JsonObject): JsonObject {
  const source = isPlainObject(value) ? value : {};
  const evaluationRoot = rootValue ?? source;
  const out: JsonObject = {};
  const fields = isPlainObject(spec.fields) ? spec.fields : {};

  for (const [key, node] of Object.entries(fields)) {
    if (!isNodeActive(node, evaluationRoot)) continue;
    const raw = source[key];
    if (isObjectSpec(node)) {
      const child = normalizeByPublicSpec(isPlainObject(raw) ? raw : {}, node, evaluationRoot);
      if (Object.keys(child).length > 0) out[key] = child;
      continue;
    }
    const normalized = normalizeFieldValue(raw, node);
    if (normalized !== SKIP) out[key] = normalized;
  }

  return out;
}

export function getVisibleSpecEntries(spec: PublicObjectSpec | null | undefined, rootValue: JsonObject, flags: Record<string, unknown> = {}): Array<[string, PublicSchemaNode]> {
  if (!spec) return [];
  const fields = isPlainObject(spec.fields) ? spec.fields : {};
  return Object.entries(fields)
    .filter(([, node]) => isNodeVisible(node, rootValue, flags))
    .sort((left, right) => {
      const leftOrder = isObjectSpec(left[1]) ? null : left[1].ui?.order;
      const rightOrder = isObjectSpec(right[1]) ? null : right[1].ui?.order;
      return (leftOrder ?? 999) - (rightOrder ?? 999) || left[0].localeCompare(right[0]);
    });
}

export function buildDraftValueFromFieldSpec(spec: PublicFieldSpec): string {
  if (spec.ui?.widget === 'json' || spec.kind === 'object') {
    return JSON.stringify(
      Object.prototype.hasOwnProperty.call(spec, 'default') && isPlainObject(spec.default) ? spec.default : {},
      null,
      2
    );
  }
  if (Object.prototype.hasOwnProperty.call(spec, 'default') && spec.default !== null && spec.default !== undefined) {
    return String(spec.default);
  }
  return '';
}

export function buildCredentialDrafts(specs: Record<string, PublicProviderSpec>): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.values(specs).map((provider) => {
      const draft: Record<string, string> = {};
      for (const [fieldName, node] of Object.entries(provider.credentials.fields)) {
        if (node.expose === false) continue;
        if (isObjectSpec(node)) continue;
        draft[fieldName] = buildDraftValueFromFieldSpec(node);
      }
      return [provider.id, draft];
    })
  );
}

export function normalizeCredentialDraft(provider: PublicProviderSpec, draft: Record<string, string>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [fieldName, node] of Object.entries(provider.credentials.fields)) {
    if (node.expose === false) continue;
    if (isObjectSpec(node)) continue;
    const raw = draft[fieldName] ?? '';

    if (node.ui?.widget === 'json' || node.kind === 'object') {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const parsed = JSON.parse(trimmed);
      if (!isPlainObject(parsed)) {
        throw new Error(`${fieldName} must be a JSON object`);
      }
      if (Object.keys(parsed).length > 0 || node.required) {
        normalized[fieldName] = parsed;
      }
      continue;
    }

    const trimmed = raw.trim();
    if (trimmed) {
      normalized[fieldName] = trimmed;
    }
  }
  return normalized;
}

export function validateCredentialDraftJson(provider: PublicProviderSpec, draft: Record<string, string>): string | null {
  for (const [fieldName, node] of Object.entries(provider.credentials.fields)) {
    if (node.expose === false) continue;
    if (isObjectSpec(node)) continue;
    if (!(node.ui?.widget === 'json' || node.kind === 'object')) continue;
    const raw = draft[fieldName] ?? '';
    if (!raw.trim()) continue;
    try {
      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed)) {
        return fieldName;
      }
    } catch {
      return fieldName;
    }
  }
  return null;
}

export function buildDefaultObjectValue(spec: PublicObjectSpec | null | undefined): JsonObject {
  if (!spec) return {};
  const out: JsonObject = {};
  for (const [key, node] of Object.entries(spec.fields)) {
    if (isObjectSpec(node)) {
      const child = buildDefaultObjectValue(node);
      if (Object.keys(child).length > 0) out[key] = child;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(node, 'default')) {
      out[key] = cloneValue(node.default);
    }
  }
  return out;
}

export function getStoredProviderSettings(
  config: Record<string, unknown>,
  providerId: string
): Record<string, unknown> {
  const providerSettings = config.providerSettings;
  if (!isPlainObject(providerSettings)) return {};
  const value = providerSettings[providerId];
  return isPlainObject(value) ? value : {};
}

export function setStoredProviderSettings<T extends Record<string, unknown>>(
  config: T,
  providerId: string,
  nextSettings: Record<string, unknown>
): T {
  const providerSettings = isPlainObject(config.providerSettings)
    ? (config.providerSettings as Record<string, unknown>)
    : {};
  return {
    ...config,
    providerSettings: {
      ...providerSettings,
      [providerId]: cloneValue(nextSettings),
    },
  };
}

export function projectImageModels(provider: PublicProviderSpec | undefined): PublicImageModelDescriptor[] {
  return provider?.image?.models ?? [];
}

export function toImageModelInfo(model: PublicImageModelDescriptor) {
  return {
    id: model.id,
    name: model.name,
    description: model.description ?? null,
    canonical_slug: model.canonical_slug ?? null,
    owned_by: model.owned_by ?? null,
    icon_url: model.icon_url ?? null,
    tags: model.tags ?? null,
    category: model.category ?? null,
    prompt_type: model.prompt_type,
    supports_image_input: model.supports_image_input,
    supports_mask_input: Boolean(model.supports_mask_input),
    supports_multi_image_input: Boolean(model.supports_multi_image_input),
    supported_aspect_ratios: model.geometry.supported_aspect_ratios,
    supported_image_sizes: model.geometry.supported_resolutions,
    default_aspect_ratio: model.geometry.default_aspect_ratio,
    default_image_size: model.geometry.default_resolution,
    ui_resolution_mode: model.geometry.resolution_mode,
    supported_geometry_pairs: model.geometry.supported_geometry_pairs ?? null,
    architecture: model.architecture
      ? {
          input_modalities: model.architecture.input_modalities ?? undefined,
          output_modalities: model.architecture.output_modalities ?? undefined,
        }
      : null,
    pricing: model.pricing ?? null,
    capabilities: model.capabilities ?? null,
    supported_parameters: model.supported_parameters ?? null,
  };
}

const iconMap = {
  openai: OpenAI,
  nanogpt: GenericProviderIcon,
  gemini: Gemini,
  claude: Claude,
  openrouter: OpenRouter,
  xai: XAI,
  novelai: NovelAI,
  custom: CustomProvider,
};

export function resolveProviderIcon(iconKey: string | null | undefined) {
  return iconMap[(iconKey || '') as keyof typeof iconMap] ?? GenericProviderIcon;
}

export function translateFieldLabel(t: TFunction, field: PublicFieldSpec): string {
  const key = field.ui?.label_key;
  return key ? t(key) : '';
}

export function translateFieldHelp(t: TFunction, field: PublicFieldSpec): string {
  const key = field.ui?.help_key;
  return key ? t(key) : '';
}

export function translateFieldPlaceholder(t: TFunction, field: PublicFieldSpec): string {
  const key = field.ui?.placeholder_key;
  return key ? t(key) : '';
}

export function buildSelectOptions(t: TFunction, field: PublicFieldSpec): Array<{ value: string; label: string; disabled?: boolean }> {
  return field.options.map((option) => {
    const value = String(option);
    const prefix = field.ui?.option_label_prefix;
    return {
      value,
      label: prefix ? t(`${prefix}.${value}`) : value,
      disabled: field.disabled_options.includes(option),
    };
  });
}
