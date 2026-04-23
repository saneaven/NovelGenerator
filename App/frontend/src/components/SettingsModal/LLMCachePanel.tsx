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

function fallbackNote(providerId: CacheProviderId): string {
  switch (providerId) {
    case 'claude':
      return 'Supports multiple explicit cache checkpoints. When cache points exist, this provider uses explicit checkpoint serialization.';
    case 'gemini':
      return 'Supports implicit caching and one runtime-selected explicit checkpoint backed by cached content handles.';
    case 'nanogpt':
      return 'Supports one runtime-selected checkpoint plus TTL and optional sticky-provider routing.';
    case 'xai':
      return 'Uses conversation-level cache hints only. Disabling this only turns off app-managed cache hints.';
    case 'openai':
    default:
      return 'Uses thread-level prompt cache hints only. Disabling this only turns off app-managed cache hints.';
  }
}

function capabilityTags(capabilities: Record<string, unknown> | null | undefined): string[] {
  const tags: string[] = [];
  const supportsExplicit = Boolean(capabilities?.supports_explicit_checkpoints);
  const maxExplicit = Number(capabilities?.max_explicit_checkpoints ?? 0);
  const singleSelected = Boolean(capabilities?.supports_single_selected_checkpoint);
  const supportsTtl = Boolean(capabilities?.supports_ttl);
  const stickyProvider = Boolean(capabilities?.supports_sticky_provider);

  if (supportsExplicit && maxExplicit > 0) {
    tags.push(`Explicit checkpoints (${maxExplicit} max)`);
  } else if (singleSelected) {
    tags.push('Single selected checkpoint');
  } else {
    tags.push('Automatic cache hints');
  }

  if (supportsTtl) {
    tags.push('TTL configurable');
  }
  if (stickyProvider) {
    tags.push('Sticky provider');
  }

  return tags;
}

interface LLMCachePanelProps {
  settings: LLMCacheSettings;
  providerSpecs: Record<string, PublicProviderSpec>;
  onChange: (settings: LLMCacheSettings) => void;
}

const LLMCachePanel: React.FC<LLMCachePanelProps> = ({
  settings,
  providerSpecs,
  onChange,
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
    <div className="llm-cache-panel">
      <div className="panel-header">
        <h3>{t('settings.tabs.llmCache', { defaultValue: 'LLM Cache' })}</h3>
        <p className="panel-description">
          {t('settings.llmCache.description', {
            defaultValue:
              'Configure provider-level prompt caching behavior. Providers differ: some reuse automatic cache hints, some support explicit cache checkpoints, and some select one checkpoint at runtime.',
          })}
        </p>
      </div>

      {providers.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__text">
            {t('settings.llmCache.empty', { defaultValue: 'No cache-capable LLM providers are available.' })}
          </p>
        </div>
      ) : (
        providers.map((provider) => {
          const providerId = provider.id as CacheProviderId;
          const llmSpec = provider.llm;
          const draft = isPlainObject(settings[providerId]) ? settings[providerId] : {};
          const tags = capabilityTags(llmSpec?.cache_capabilities);
          const notesKey = typeof llmSpec?.cache_capabilities?.notes_key === 'string'
            ? llmSpec.cache_capabilities.notes_key
            : '';
          const note = notesKey
            ? t(notesKey, { defaultValue: fallbackNote(providerId) })
            : fallbackNote(providerId);

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
