import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ProviderSettingsFields from '../../providerEngine/ProviderSettingsFields';
import type { PublicProviderSpec } from '../../providerEngine/types';
import type { LLMCacheSettings } from '../../store/settingsStore';
import './LLMCachePanel.css';

type CacheProviderId = keyof LLMCacheSettings;

const CACHE_PROVIDER_ORDER: CacheProviderId[] = ['openai', 'claude', 'gemini', 'xai', 'nanogpt'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fallbackNoteKey(providerId: CacheProviderId): string {
  return `settings.llmCache.notes.${providerId}`;
}

function capabilityTags(
  t: ReturnType<typeof useTranslation>['t'],
  capabilities: Record<string, unknown> | null | undefined
): string[] {
  const tags: string[] = [];
  const supportsExplicit = Boolean(capabilities?.supports_explicit_checkpoints);
  const maxExplicit = Number(capabilities?.max_explicit_checkpoints ?? 0);
  const singleSelected = Boolean(capabilities?.supports_single_selected_checkpoint);
  const supportsTtl = Boolean(capabilities?.supports_ttl);
  const stickyProvider = Boolean(capabilities?.supports_sticky_provider);

  if (supportsExplicit && maxExplicit > 0) {
    tags.push(t('settings.llmCache.tags.explicitCheckpoints', { count: maxExplicit }));
  } else if (singleSelected) {
    tags.push(t('settings.llmCache.tags.singleSelectedCheckpoint'));
  } else {
    tags.push(t('settings.llmCache.tags.automaticCacheHints'));
  }

  if (supportsTtl) {
    tags.push(t('settings.llmCache.tags.ttlConfigurable'));
  }
  if (stickyProvider) {
    tags.push(t('settings.llmCache.tags.stickyProvider'));
  }

  return tags;
}

interface LLMCachePanelProps {
  settings: LLMCacheSettings;
  providerSpecs: Record<string, PublicProviderSpec>;
  onChange: (settings: LLMCacheSettings) => void;
  embedded?: boolean;
  loaded?: boolean;
  loading?: boolean;
  error?: string | null;
}

const LLMCachePanel: React.FC<LLMCachePanelProps> = ({
  settings,
  providerSpecs,
  onChange,
  embedded = false,
  loaded = false,
  loading = false,
  error = null,
}) => {
  const { t } = useTranslation();

  const providers = useMemo(
    () =>
      CACHE_PROVIDER_ORDER
        .map((providerId) => providerSpecs[providerId])
        .filter(
          (provider): provider is PublicProviderSpec =>
            Boolean(provider?.llm?.cache_settings) && provider.id !== 'openrouter'
        ),
    [providerSpecs]
  );

  return (
    <div className={`llm-cache-panel${embedded ? ' llm-cache-panel--embedded' : ''}`}>
      <div className="panel-header">
        <h3>{t('settings.llmCache.title')}</h3>
        <p className="panel-description">
          {t('settings.llmCache.description')}
        </p>
      </div>

      {!loaded && !error ? (
        <div className="loading-state">
          {loading ? t('settings.llmCache.loading') : t('settings.llmCache.initializing')}
        </div>
      ) : error ? (
        <div className="empty-state">
          <p className="empty-state__text">
            {t('settings.llmCache.loadError', { error })}
          </p>
        </div>
      ) : providers.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__text">
            {t('settings.llmCache.empty')}
          </p>
        </div>
      ) : (
        providers.map((provider) => {
          const providerId = provider.id as CacheProviderId;
          const llmSpec = provider.llm;
          const draft = isPlainObject(settings[providerId]) ? settings[providerId] : {};
          const tags = capabilityTags(t, llmSpec?.cache_capabilities);
          const notesKey = typeof llmSpec?.cache_capabilities?.notes_key === 'string'
            ? llmSpec.cache_capabilities.notes_key
            : fallbackNoteKey(providerId);
          const note = t(notesKey);

          return (
            <div key={provider.id} className="settings-panel-card llm-cache-card">
              <div className="llm-cache-card__header">
                <div>
                  <h3>{t(provider.ui.display_name_key, { defaultValue: provider.id })}</h3>
                  <p className="llm-cache-card__note">{note}</p>
                </div>
              </div>

              <div className="llm-cache-card__tags">
                {tags.map((tag) => (
                  <span key={tag} className="llm-cache-card__tag">
                    {tag}
                  </span>
                ))}
              </div>

              {llmSpec?.cache_settings ? (
                <ProviderSettingsFields
                  spec={llmSpec.cache_settings}
                  draft={draft}
                  className="llm-cache-card__fields"
                  setDraft={(nextDraft) => {
                    const currentDraft = isPlainObject(settings[providerId]) ? settings[providerId] : {};
                    const resolvedDraft = typeof nextDraft === 'function' ? nextDraft(currentDraft) : nextDraft;
                    onChange({
                      ...settings,
                      [providerId]: isPlainObject(resolvedDraft)
                        ? (resolvedDraft as unknown as LLMCacheSettings[typeof providerId])
                        : settings[providerId],
                    });
                  }}
                />
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
};

export default LLMCachePanel;
