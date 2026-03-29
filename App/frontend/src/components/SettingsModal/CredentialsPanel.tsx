import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderCredentials } from '../../store/settingsStore';
import { Edit } from '../icons';
import TextButton from '../TextButton/TextButton';
import { useProviderSpecStore } from '../../providerEngine/store';
import {
  buildDraftValueFromFieldSpec,
  getVisibleSpecEntries,
  isObjectSpec,
  resolveProviderIcon,
  translateFieldHelp,
  translateFieldLabel,
  translateFieldPlaceholder,
} from '../../providerEngine/utils';
import type { PublicFieldSpec, PublicProviderSpec } from '../../providerEngine/types';
import './CredentialsPanel.css';

interface CredentialsPanelProps {
  credentials: ProviderCredentials;
  storedProviders?: string[];
  isSyncing?: boolean;
  onChange: (credentials: ProviderCredentials) => void;
}

function sortProviders(providers: PublicProviderSpec[]) {
  return [...providers].sort((left, right) => {
    const leftOrder = Math.min(left.ui.llm_order ?? 999, left.ui.embedding_order ?? 999, left.ui.image_order ?? 999);
    const rightOrder = Math.min(right.ui.llm_order ?? 999, right.ui.embedding_order ?? 999, right.ui.image_order ?? 999);
    return leftOrder - rightOrder || left.id.localeCompare(right.id);
  });
}

const CredentialsPanel: React.FC<CredentialsPanelProps> = ({
  credentials,
  storedProviders = [],
  isSyncing = false,
  onChange,
}) => {
  const { t } = useTranslation();
  const specs = useProviderSpecStore((state) => state.specs);
  const providers = useMemo(() => sortProviders(Object.values(specs)), [specs]);
  const storedSet = useMemo(() => new Set(storedProviders), [storedProviders]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (provider: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };

  const updateField = (providerId: string, fieldName: string, value: string) => {
    onChange({
      ...credentials,
      [providerId]: {
        ...(credentials[providerId] ?? {}),
        [fieldName]: value,
      },
    });
  };

  const renderField = (provider: PublicProviderSpec, fieldName: string, field: PublicFieldSpec) => {
    const value = credentials[provider.id]?.[fieldName] ?? buildDraftValueFromFieldSpec(field);
    const label = translateFieldLabel(t, field);
    const help = translateFieldHelp(t, field);
    const placeholder = translateFieldPlaceholder(t, field);

    if (field.ui?.widget === 'json' || field.kind === 'object') {
      return (
        <div key={fieldName} className="form-field">
          <label>{label}</label>
          <textarea
            value={value}
            onChange={(event) => updateField(provider.id, fieldName, event.target.value)}
            placeholder={placeholder}
            className="credential-textarea"
            spellCheck={false}
          />
          {help ? <p className="field-hint">{help}</p> : null}
        </div>
      );
    }

    const inputType = field.ui?.widget === 'password' ? 'password' : 'text';
    return (
      <div key={fieldName} className="form-field">
        <label>{label}</label>
        <input
          type={inputType}
          value={value}
          onChange={(event) => updateField(provider.id, fieldName, event.target.value)}
          placeholder={placeholder}
          className="credential-input"
        />
        {help || field.ui?.link_url ? (
          <p className="field-hint">
            {help ? `${help} ` : null}
            {field.ui?.link_url ? (
              <a href={field.ui.link_url} target="_blank" rel="noopener noreferrer">
                {field.ui.link_label || field.ui.link_url}
              </a>
            ) : null}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="credentials-panel">
      <div className="panel-header">
        <h3>{t('settings.credentials.title')}</h3>
        <p className="panel-description">{t('settings.credentials.description')}</p>
        <p className="panel-description">
          {isSyncing
            ? 'Syncing credential changes...'
            : `Stored providers: ${storedProviders.length > 0 ? storedProviders.join(', ') : 'none'}`}
        </p>
      </div>

      {providers.map((provider) => {
        const Icon = resolveProviderIcon(provider.ui.icon_key);
        const visibleFields = getVisibleSpecEntries(provider.credentials, {});
        const collapsed = storedSet.has(provider.id) && !expanded.has(provider.id);

        return (
          <div key={provider.id} className={`credential-card ${collapsed ? 'collapsed' : ''}`}>
            <div className="credential-header">
              <div className="credential-icon"><Icon size="md" /></div>
              <h3>{t(provider.ui.display_name_key)}</h3>
              {storedSet.has(provider.id) && !expanded.has(provider.id) ? (
                <span className="credential-saved-badge">Saved</span>
              ) : null}
              {storedSet.has(provider.id) ? (
                <TextButton
                  variant={expanded.has(provider.id) ? 'ghost' : 'secondary'}
                  size="sm"
                  iconLeft={!expanded.has(provider.id) ? <Edit size="sm" /> : undefined}
                  onClick={() => toggleExpand(provider.id)}
                  className="credential-overwrite-btn"
                >
                  {expanded.has(provider.id) ? 'Cancel' : 'Overwrite'}
                </TextButton>
              ) : null}
            </div>
            <div className="credential-body-wrapper">
              <div className="credential-body-collapse">
                <div className="credential-body">
                  {visibleFields.map(([fieldName, node]) => isObjectSpec(node) ? null : renderField(provider, fieldName, node))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default CredentialsPanel;
