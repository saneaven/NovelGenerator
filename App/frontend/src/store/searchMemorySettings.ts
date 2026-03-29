export type EmbeddingProviderType = string;
export type SearchMemoryTarget = 'search' | 'memory';

export interface EmbeddingConfig {
  provider: EmbeddingProviderType;
  model: string;
  dimensions: number | null;
}

export interface RetrievalConfig {
  topKPerQuery: number;
  neighborWindow: number;
  maxPrimaryItems: number;
  maxTotalItems: number;
}

export interface SearchGeneralConfig {
  embedding: EmbeddingConfig;
  retrieval: RetrievalConfig;
  keywordPageSize: number;
}

export interface MemoryConfig {
  embedding: EmbeddingConfig;
  retrieval: RetrievalConfig;
}

export interface SearchMemorySettings {
  enabled: boolean;
  general: SearchGeneralConfig;
  overrides: {
    search?: SearchGeneralConfig;
    memory?: MemoryConfig;
  };
}

const DEFAULT_EMBEDDING: EmbeddingConfig = {
  provider: 'openai',
  model: '',
  dimensions: null,
};

const DEFAULT_RETRIEVAL: RetrievalConfig = {
  topKPerQuery: 20,
  neighborWindow: 0,
  maxPrimaryItems: 20,
  maxTotalItems: 60,
};

export function makeInitialSearchMemorySettings(): SearchMemorySettings {
  return {
    enabled: false,
    general: {
      embedding: { ...DEFAULT_EMBEDDING },
      retrieval: { ...DEFAULT_RETRIEVAL },
      keywordPageSize: 20,
    },
    overrides: {},
  };
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

function normalizeEmbeddingConfig(config?: Partial<EmbeddingConfig> | null): EmbeddingConfig {
  return {
    provider: (config?.provider ?? DEFAULT_EMBEDDING.provider) as EmbeddingProviderType,
    model: typeof config?.model === 'string' ? config.model : DEFAULT_EMBEDDING.model,
    dimensions: typeof config?.dimensions === 'number' ? config.dimensions : null,
  };
}

function normalizeRetrievalConfig(config?: Partial<RetrievalConfig> | null): RetrievalConfig {
  const normalized: RetrievalConfig = {
    topKPerQuery: typeof config?.topKPerQuery === 'number' ? config.topKPerQuery : DEFAULT_RETRIEVAL.topKPerQuery,
    neighborWindow: typeof config?.neighborWindow === 'number' ? config.neighborWindow : DEFAULT_RETRIEVAL.neighborWindow,
    maxPrimaryItems: typeof config?.maxPrimaryItems === 'number' ? config.maxPrimaryItems : DEFAULT_RETRIEVAL.maxPrimaryItems,
    maxTotalItems: typeof config?.maxTotalItems === 'number' ? config.maxTotalItems : DEFAULT_RETRIEVAL.maxTotalItems,
  };
  if (normalized.maxTotalItems < normalized.maxPrimaryItems) {
    normalized.maxTotalItems = normalized.maxPrimaryItems;
  }
  return normalized;
}

function normalizeSearchGeneralConfig(config?: Partial<SearchGeneralConfig> | null): SearchGeneralConfig {
  return {
    embedding: normalizeEmbeddingConfig(config?.embedding),
    retrieval: normalizeRetrievalConfig(config?.retrieval),
    keywordPageSize: typeof config?.keywordPageSize === 'number' ? config.keywordPageSize : 20,
  };
}

function normalizeMemoryConfig(config?: Partial<MemoryConfig> | null): MemoryConfig {
  return {
    embedding: normalizeEmbeddingConfig(config?.embedding),
    retrieval: normalizeRetrievalConfig(config?.retrieval),
  };
}

function normalizeSearchMemorySettings(settings: SearchMemorySettings): SearchMemorySettings {
  const normalized: SearchMemorySettings = {
    enabled: Boolean(settings?.enabled),
    general: normalizeSearchGeneralConfig(settings?.general),
    overrides: {},
  };

  if (settings?.overrides?.search) {
    normalized.overrides.search = normalizeSearchGeneralConfig(settings.overrides.search);
  }
  if (settings?.overrides?.memory) {
    normalized.overrides.memory = normalizeMemoryConfig(settings.overrides.memory);
  }

  return normalized;
}

function resolveSearchSettingsFromNormalized(settings: SearchMemorySettings): SearchGeneralConfig {
  return cloneValue(settings.overrides.search ?? settings.general);
}

function resolveMemorySettingsFromNormalized(settings: SearchMemorySettings): MemoryConfig {
  return cloneValue(
    settings.overrides.memory ?? {
      embedding: settings.general.embedding,
      retrieval: settings.general.retrieval,
    }
  );
}

export function validateSearchMemorySettings(settings: SearchMemorySettings): SearchMemorySettings {
  const normalized = normalizeSearchMemorySettings(settings);

  if (normalized.enabled) {
    const checks = [
      ['search', resolveSearchSettingsFromNormalized(normalized).embedding],
      ['memory', resolveMemorySettingsFromNormalized(normalized).embedding],
    ] as const;
    for (const [, embedding] of checks) {
      if (!embedding.provider.trim() || !embedding.model.trim()) {
        throw new Error('Search & Memory embedding provider/model is required when enabled');
      }
    }
  }

  return normalized;
}

export function hasSearchMemoryOverride(settings: SearchMemorySettings, target: SearchMemoryTarget): boolean {
  const normalized = normalizeSearchMemorySettings(settings);
  return Object.prototype.hasOwnProperty.call(normalized.overrides, target);
}

export function makeSearchOverrideSeed(settings: SearchMemorySettings): SearchGeneralConfig {
  return cloneValue(normalizeSearchMemorySettings(settings).general);
}

export function makeMemoryOverrideSeed(settings: SearchMemorySettings): MemoryConfig {
  const normalized = normalizeSearchMemorySettings(settings);
  return {
    embedding: cloneValue(normalized.general.embedding),
    retrieval: cloneValue(normalized.general.retrieval),
  };
}

export function resolveSearchSettings(settings: SearchMemorySettings): SearchGeneralConfig {
  const normalized = normalizeSearchMemorySettings(settings);
  return resolveSearchSettingsFromNormalized(normalized);
}

export function resolveMemorySettings(settings: SearchMemorySettings): MemoryConfig {
  const normalized = normalizeSearchMemorySettings(settings);
  return resolveMemorySettingsFromNormalized(normalized);
}
