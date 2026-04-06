import React, { useEffect, useMemo, useState } from 'react';
import { CustomSelect } from '../ui/CustomSelect';
import { NumberInput } from '../ui/NumberInput';
import ToggleSwitch from '../common/ToggleSwitch';
import { cloneValue } from '../../providerEngine/utils';
import type { TaskAIConfig } from '../../store/settingsStore';
import './NanoGptTaskSettings.css';

type Props = {
  config: TaskAIConfig;
  onChange: (config: TaskAIConfig) => void;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

type OptionalTextState = {
  overridden: boolean;
  value: string;
};

const NanoGptTaskSettings: React.FC<Props> = ({ config, onChange }) => {
  const providerSettings = useMemo(
    () => (isObject(config.advanced.provider_settings) ? (config.advanced.provider_settings as Record<string, unknown>) : {}),
    [config.advanced.provider_settings]
  );
  const storedCustomFields = useMemo(
    () => (isObject(providerSettings.custom_fields) ? (providerSettings.custom_fields as Record<string, unknown>) : null),
    [providerSettings]
  );
  const [customFieldsText, setCustomFieldsText] = useState(
    storedCustomFields ? JSON.stringify(storedCustomFields, null, 2) : ''
  );
  const [customFieldsError, setCustomFieldsError] = useState<string | null>(null);

  useEffect(() => {
    setCustomFieldsText(storedCustomFields ? JSON.stringify(storedCustomFields, null, 2) : '');
    setCustomFieldsError(null);
  }, [storedCustomFields]);

  const pruneEmptyBranches = (node: Record<string, unknown>): Record<string, unknown> => {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (Array.isArray(value)) {
        if (value.length > 0) next[key] = value;
        continue;
      }
      if (isObject(value)) {
        const child = pruneEmptyBranches(value);
        if (Object.keys(child).length > 0) next[key] = child;
        continue;
      }
      if (value !== undefined && value !== null && value !== '') {
        next[key] = value;
      }
    }
    return next;
  };

  const commitProviderSettings = (mutator: (next: Record<string, unknown>) => void) => {
    const next = cloneValue(providerSettings) as Record<string, unknown>;
    mutator(next);
    onChange({
      ...config,
      advanced: {
        ...config.advanced,
        provider_settings: pruneEmptyBranches(next),
      },
    });
  };

  const parseCustomFields = (text: string): { value: Record<string, unknown> | null; error: string | null } => {
    const trimmed = text.trim();
    if (!trimmed) return { value: null, error: null };
    try {
      const parsed = JSON.parse(trimmed);
      if (!isObject(parsed)) {
        return { value: null, error: 'Custom fields must be a JSON object.' };
      }
      return { value: parsed, error: null };
    } catch {
      return { value: null, error: 'Invalid JSON object.' };
    }
  };

  const billing = isObject(providerSettings.billing) ? providerSettings.billing as Record<string, unknown> : {};
  const web = isObject(providerSettings.web) ? providerSettings.web as Record<string, unknown> : {};
  const webLocation = isObject(web.user_location) ? web.user_location as Record<string, unknown> : {};
  const scraping = isObject(providerSettings.scraping) ? providerSettings.scraping as Record<string, unknown> : {};
  const youtube = isObject(providerSettings.youtube) ? providerSettings.youtube as Record<string, unknown> : {};
  const memory = isObject(providerSettings.memory) ? providerSettings.memory as Record<string, unknown> : {};

  const [webProviderState, setWebProviderState] = useState<OptionalTextState>(() => ({
    overridden: Object.prototype.hasOwnProperty.call(web, 'provider'),
    value: typeof web.provider === 'string' ? web.provider : '',
  }));
  const [webDepthState, setWebDepthState] = useState<OptionalTextState>(() => ({
    overridden: Object.prototype.hasOwnProperty.call(web, 'depth'),
    value: typeof web.depth === 'string' ? web.depth : '',
  }));
  const [locationStates, setLocationStates] = useState<Record<'country' | 'city' | 'region', OptionalTextState>>(() => ({
    country: {
      overridden: Object.prototype.hasOwnProperty.call(webLocation, 'country'),
      value: typeof webLocation.country === 'string' ? webLocation.country : '',
    },
    city: {
      overridden: Object.prototype.hasOwnProperty.call(webLocation, 'city'),
      value: typeof webLocation.city === 'string' ? webLocation.city : '',
    },
    region: {
      overridden: Object.prototype.hasOwnProperty.call(webLocation, 'region'),
      value: typeof webLocation.region === 'string' ? webLocation.region : '',
    },
  }));

  useEffect(() => {
    const storedOverridden = Object.prototype.hasOwnProperty.call(web, 'provider');
    const storedValue = typeof web.provider === 'string' ? web.provider : '';
    setWebProviderState((prev) => {
      if (!storedOverridden && prev.overridden && prev.value === '') return prev;
      if (prev.overridden === storedOverridden && prev.value === storedValue) return prev;
      return { overridden: storedOverridden, value: storedValue };
    });
  }, [web]);

  useEffect(() => {
    const storedOverridden = Object.prototype.hasOwnProperty.call(web, 'depth');
    const storedValue = typeof web.depth === 'string' ? web.depth : '';
    setWebDepthState((prev) => {
      if (!storedOverridden && prev.overridden && prev.value === '') return prev;
      if (prev.overridden === storedOverridden && prev.value === storedValue) return prev;
      return { overridden: storedOverridden, value: storedValue };
    });
  }, [web]);

  useEffect(() => {
    setLocationStates((prev) => {
      const next = { ...prev };
      let changed = false;
      (['country', 'city', 'region'] as const).forEach((key) => {
        const storedOverridden = Object.prototype.hasOwnProperty.call(webLocation, key);
        const storedValue = typeof webLocation[key] === 'string' ? String(webLocation[key]) : '';
        if (!storedOverridden && prev[key].overridden && prev[key].value === '') return;
        if (prev[key].overridden === storedOverridden && prev[key].value === storedValue) return;
        next[key] = { overridden: storedOverridden, value: storedValue };
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [webLocation]);

  const webEnabledOverridden = Object.prototype.hasOwnProperty.call(web, 'enabled');
  const webEnabled = web.enabled === true;
  const scrapingOverridden = Object.prototype.hasOwnProperty.call(scraping, 'scraping');
  const scrapingEnabled = scraping.scraping === true;
  const youtubeOverridden = Object.prototype.hasOwnProperty.call(youtube, 'youtube_transcripts');
  const youtubeEnabled = youtube.youtube_transcripts === true;
  const memoryEnabledOverridden = Object.prototype.hasOwnProperty.call(memory, 'enabled');
  const memoryEnabled = memory.enabled === true;
  const customFieldsOverridden = Boolean(customFieldsError || customFieldsText.trim() || storedCustomFields);

  const resetWebDetailDrafts = () => {
    setWebProviderState({ overridden: false, value: '' });
    setWebDepthState({ overridden: false, value: '' });
    setLocationStates({
      country: { overridden: false, value: '' },
      city: { overridden: false, value: '' },
      region: { overridden: false, value: '' },
    });
  };

  return (
    <div className="nanogpt-task-settings">
      <div className="nanogpt-task-settings__section">
        <h5>Billing</h5>
        <div className="nanogpt-task-settings__row">
          <div className="nanogpt-task-settings__label">
            <span>Billing Mode</span>
            <span className="field-hint">Leave unset to use NanoGPT&apos;s default billing behavior.</span>
          </div>
          <div className="nanogpt-task-settings__override">
            <ToggleSwitch
              checked={Object.prototype.hasOwnProperty.call(billing, 'billing_mode')}
              onChange={(checked) => {
                commitProviderSettings((next) => {
                  const nextBilling = isObject(next.billing) ? next.billing as Record<string, unknown> : {};
                  if (!checked) {
                    delete nextBilling.billing_mode;
                  } else {
                    nextBilling.billing_mode = typeof billing.billing_mode === 'string' ? billing.billing_mode : 'paygo';
                  }
                  next.billing = nextBilling;
                });
              }}
              label=""
              mode="bare"
            />
          </div>
          <CustomSelect
            value={typeof billing.billing_mode === 'string' ? billing.billing_mode : 'paygo'}
            onChange={(value) => {
              commitProviderSettings((next) => {
                const nextBilling = isObject(next.billing) ? next.billing as Record<string, unknown> : {};
                nextBilling.billing_mode = value;
                next.billing = nextBilling;
              });
            }}
            disabled={!Object.prototype.hasOwnProperty.call(billing, 'billing_mode')}
            options={[{ value: 'paygo', label: 'Pay-as-you-go' }]}
          />
        </div>

        <div className="nanogpt-task-settings__row">
          <div className="nanogpt-task-settings__label">
            <span>Service Tier</span>
            <span className="field-hint">Optional NanoGPT tier hint.</span>
          </div>
          <div className="nanogpt-task-settings__override">
            <ToggleSwitch
              checked={Object.prototype.hasOwnProperty.call(billing, 'service_tier')}
              onChange={(checked) => {
                commitProviderSettings((next) => {
                  const nextBilling = isObject(next.billing) ? next.billing as Record<string, unknown> : {};
                  if (!checked) {
                    delete nextBilling.service_tier;
                  } else {
                    nextBilling.service_tier = typeof billing.service_tier === 'string' ? billing.service_tier : 'auto';
                  }
                  next.billing = nextBilling;
                });
              }}
              label=""
              mode="bare"
            />
          </div>
          <CustomSelect
            value={typeof billing.service_tier === 'string' ? billing.service_tier : 'auto'}
            onChange={(value) => {
              commitProviderSettings((next) => {
                const nextBilling = isObject(next.billing) ? next.billing as Record<string, unknown> : {};
                nextBilling.service_tier = value;
                next.billing = nextBilling;
              });
            }}
            disabled={!Object.prototype.hasOwnProperty.call(billing, 'service_tier')}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'priority', label: 'Priority' },
            ]}
          />
        </div>
      </div>

      <div className="nanogpt-task-settings__section">
        <h5>Web</h5>
        <div className="nanogpt-task-settings__row">
          <div className="nanogpt-task-settings__label">
            <span>Web Search</span>
            <span className="field-hint">Enables NanoGPT web search for this task.</span>
          </div>
          <div className="nanogpt-task-settings__override">
            <ToggleSwitch
              checked={webEnabledOverridden}
              onChange={(checked) => {
                commitProviderSettings((next) => {
                  if (!checked) {
                    delete next.web;
                    resetWebDetailDrafts();
                    return;
                  }
                  const nextWeb = isObject(next.web) ? next.web as Record<string, unknown> : {};
                  nextWeb.enabled = web.enabled === false ? false : true;
                  next.web = nextWeb;
                });
              }}
              label=""
              mode="bare"
            />
          </div>
          <ToggleSwitch
            checked={webEnabled}
            onChange={(checked) => {
              commitProviderSettings((next) => {
                const nextWeb = isObject(next.web) ? next.web as Record<string, unknown> : {};
                nextWeb.enabled = checked;
                if (!checked) {
                  delete nextWeb.provider;
                  delete nextWeb.depth;
                  delete nextWeb.search_context_size;
                  delete nextWeb.user_location;
                  resetWebDetailDrafts();
                }
                next.web = nextWeb;
              });
            }}
            disabled={!webEnabledOverridden}
            label={webEnabled ? 'Enabled' : 'Disabled'}
            mode="bare"
          />
        </div>

        {webEnabled && (
          <>
            <div className="nanogpt-task-settings__row">
              <div className="nanogpt-task-settings__label">
                <span>Search Provider</span>
              </div>
              <div className="nanogpt-task-settings__override">
                <ToggleSwitch
                  checked={webProviderState.overridden}
                  onChange={(checked) => {
                    setWebProviderState((prev) => ({
                      overridden: checked,
                      value: prev.value,
                    }));
                    commitProviderSettings((next) => {
                      const nextWeb = isObject(next.web) ? next.web as Record<string, unknown> : {};
                      if (!checked) delete nextWeb.provider;
                      next.web = nextWeb;
                    });
                  }}
                  label=""
                  mode="bare"
                />
              </div>
                <input
                  type="text"
                  className="config-input"
                  value={webProviderState.value}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setWebProviderState((prev) => ({ ...prev, value: nextValue }));
                    commitProviderSettings((next) => {
                      const nextWeb = isObject(next.web) ? next.web as Record<string, unknown> : {};
                      if (!nextValue.trim()) delete nextWeb.provider;
                      else nextWeb.provider = nextValue;
                      next.web = nextWeb;
                    });
                  }}
                  disabled={!webProviderState.overridden}
                  placeholder="linkup"
                />
              </div>

            <div className="nanogpt-task-settings__row">
              <div className="nanogpt-task-settings__label">
                <span>Search Depth</span>
              </div>
              <div className="nanogpt-task-settings__override">
                <ToggleSwitch
                  checked={webDepthState.overridden}
                  onChange={(checked) => {
                    setWebDepthState((prev) => ({
                      overridden: checked,
                      value: prev.value,
                    }));
                    commitProviderSettings((next) => {
                      const nextWeb = isObject(next.web) ? next.web as Record<string, unknown> : {};
                      if (!checked) delete nextWeb.depth;
                      next.web = nextWeb;
                    });
                  }}
                  label=""
                  mode="bare"
                />
              </div>
                <input
                  type="text"
                  className="config-input"
                  value={webDepthState.value}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setWebDepthState((prev) => ({ ...prev, value: nextValue }));
                    commitProviderSettings((next) => {
                      const nextWeb = isObject(next.web) ? next.web as Record<string, unknown> : {};
                      if (!nextValue.trim()) delete nextWeb.depth;
                      else nextWeb.depth = nextValue;
                      next.web = nextWeb;
                    });
                  }}
                  disabled={!webDepthState.overridden}
                  placeholder="standard"
                />
              </div>

            <div className="nanogpt-task-settings__row">
              <div className="nanogpt-task-settings__label">
                <span>Search Context Size</span>
              </div>
              <div className="nanogpt-task-settings__override">
                <ToggleSwitch
                  checked={Object.prototype.hasOwnProperty.call(web, 'search_context_size')}
                  onChange={(checked) => {
                    commitProviderSettings((next) => {
                      const nextWeb = isObject(next.web) ? next.web as Record<string, unknown> : {};
                      if (!checked) delete nextWeb.search_context_size;
                      else nextWeb.search_context_size = typeof web.search_context_size === 'string' ? web.search_context_size : 'medium';
                      next.web = nextWeb;
                    });
                  }}
                  label=""
                  mode="bare"
                />
              </div>
              <CustomSelect
                value={typeof web.search_context_size === 'string' ? web.search_context_size : 'medium'}
                onChange={(value) => {
                  commitProviderSettings((next) => {
                    const nextWeb = isObject(next.web) ? next.web as Record<string, unknown> : {};
                    nextWeb.search_context_size = value;
                    next.web = nextWeb;
                  });
                }}
                disabled={!Object.prototype.hasOwnProperty.call(web, 'search_context_size')}
                options={[
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                ]}
              />
            </div>

            {(['country', 'city', 'region'] as const).map((key) => (
              <div key={key} className="nanogpt-task-settings__row">
                <div className="nanogpt-task-settings__label">
                  <span>{`User Location ${key.charAt(0).toUpperCase()}${key.slice(1)}`}</span>
                </div>
                <div className="nanogpt-task-settings__override">
                  <ToggleSwitch
                    checked={locationStates[key].overridden}
                    onChange={(checked) => {
                      setLocationStates((prev) => ({
                        ...prev,
                        [key]: {
                          overridden: checked,
                          value: prev[key].value,
                        },
                      }));
                      commitProviderSettings((next) => {
                        const nextWeb = isObject(next.web) ? next.web as Record<string, unknown> : {};
                        const nextLocation = isObject(nextWeb.user_location) ? nextWeb.user_location as Record<string, unknown> : {};
                        if (!checked) delete nextLocation[key];
                        nextWeb.user_location = nextLocation;
                        next.web = nextWeb;
                      });
                    }}
                    label=""
                    mode="bare"
                  />
                </div>
                <input
                  type="text"
                  className="config-input"
                  value={locationStates[key].value}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setLocationStates((prev) => ({
                      ...prev,
                      [key]: {
                        ...prev[key],
                        value: nextValue,
                      },
                    }));
                    commitProviderSettings((next) => {
                      const nextWeb = isObject(next.web) ? next.web as Record<string, unknown> : {};
                      const nextLocation = isObject(nextWeb.user_location) ? nextWeb.user_location as Record<string, unknown> : {};
                      if (!nextValue.trim()) delete nextLocation[key];
                      else nextLocation[key] = nextValue;
                      nextWeb.user_location = nextLocation;
                      next.web = nextWeb;
                    });
                  }}
                  disabled={!locationStates[key].overridden}
                />
              </div>
            ))}
          </>
        )}
      </div>

      <div className="nanogpt-task-settings__section">
        <h5>Other Toggles</h5>
        <div className="nanogpt-task-settings__row">
          <div className="nanogpt-task-settings__label">
            <span>Scraping</span>
          </div>
          <div className="nanogpt-task-settings__override">
            <ToggleSwitch
              checked={scrapingOverridden}
              onChange={(checked) => {
                commitProviderSettings((next) => {
                  if (!checked) {
                    delete next.scraping;
                    return;
                  }
                  next.scraping = { scraping: scraping.scraping === true };
                });
              }}
              label=""
              mode="bare"
            />
          </div>
          <ToggleSwitch
            checked={scrapingEnabled}
            onChange={(checked) => {
              commitProviderSettings((next) => {
                next.scraping = { scraping: checked };
              });
            }}
            disabled={!scrapingOverridden}
            label={scrapingEnabled ? 'Enabled' : 'Disabled'}
            mode="bare"
          />
        </div>

        <div className="nanogpt-task-settings__row">
          <div className="nanogpt-task-settings__label">
            <span>YouTube Transcripts</span>
          </div>
          <div className="nanogpt-task-settings__override">
            <ToggleSwitch
              checked={youtubeOverridden}
              onChange={(checked) => {
                commitProviderSettings((next) => {
                  if (!checked) {
                    delete next.youtube;
                    return;
                  }
                  next.youtube = { youtube_transcripts: youtube.youtube_transcripts === true };
                });
              }}
              label=""
              mode="bare"
            />
          </div>
          <ToggleSwitch
            checked={youtubeEnabled}
            onChange={(checked) => {
              commitProviderSettings((next) => {
                next.youtube = { youtube_transcripts: checked };
              });
            }}
            disabled={!youtubeOverridden}
            label={youtubeEnabled ? 'Enabled' : 'Disabled'}
            mode="bare"
          />
        </div>
      </div>

      <div className="nanogpt-task-settings__section">
        <h5>Memory</h5>
        <div className="nanogpt-task-settings__row">
          <div className="nanogpt-task-settings__label">
            <span>Memory</span>
          </div>
          <div className="nanogpt-task-settings__override">
            <ToggleSwitch
              checked={memoryEnabledOverridden}
              onChange={(checked) => {
                commitProviderSettings((next) => {
                  if (!checked) {
                    delete next.memory;
                    return;
                  }
                  const nextMemory = isObject(next.memory) ? next.memory as Record<string, unknown> : {};
                  nextMemory.enabled = memory.enabled === true;
                  next.memory = nextMemory;
                });
              }}
              label=""
              mode="bare"
            />
          </div>
          <ToggleSwitch
            checked={memoryEnabled}
            onChange={(checked) => {
              commitProviderSettings((next) => {
                const nextMemory = isObject(next.memory) ? next.memory as Record<string, unknown> : {};
                nextMemory.enabled = checked;
                if (!checked) {
                  delete nextMemory.expiration_days;
                  delete nextMemory.model_context_limit;
                }
                next.memory = nextMemory;
              });
            }}
            disabled={!memoryEnabledOverridden}
            label={memoryEnabled ? 'Enabled' : 'Disabled'}
            mode="bare"
          />
        </div>

        {memoryEnabled && (
          <>
            <div className="nanogpt-task-settings__row">
              <div className="nanogpt-task-settings__label">
                <span>Memory Expiration Days</span>
              </div>
              <div className="nanogpt-task-settings__override">
                <ToggleSwitch
                  checked={Object.prototype.hasOwnProperty.call(memory, 'expiration_days')}
                  onChange={(checked) => {
                    commitProviderSettings((next) => {
                      const nextMemory = isObject(next.memory) ? next.memory as Record<string, unknown> : {};
                      if (!checked) delete nextMemory.expiration_days;
                      else nextMemory.expiration_days = typeof memory.expiration_days === 'number' ? memory.expiration_days : 30;
                      next.memory = nextMemory;
                    });
                  }}
                  label=""
                  mode="bare"
                />
              </div>
              <NumberInput
                value={typeof memory.expiration_days === 'number' ? memory.expiration_days : undefined}
                min={1}
                max={365}
                allowEmpty={true}
                onValueChange={(value) => {
                  commitProviderSettings((next) => {
                    const nextMemory = isObject(next.memory) ? next.memory as Record<string, unknown> : {};
                    if (value == null) delete nextMemory.expiration_days;
                    else nextMemory.expiration_days = value;
                    next.memory = nextMemory;
                  });
                }}
                disabled={!Object.prototype.hasOwnProperty.call(memory, 'expiration_days')}
                className="config-input"
              />
            </div>

            <div className="nanogpt-task-settings__row">
              <div className="nanogpt-task-settings__label">
                <span>Model Context Limit</span>
              </div>
              <div className="nanogpt-task-settings__override">
                <ToggleSwitch
                  checked={Object.prototype.hasOwnProperty.call(memory, 'model_context_limit')}
                  onChange={(checked) => {
                    commitProviderSettings((next) => {
                      const nextMemory = isObject(next.memory) ? next.memory as Record<string, unknown> : {};
                      if (!checked) delete nextMemory.model_context_limit;
                      else nextMemory.model_context_limit = typeof memory.model_context_limit === 'number' ? memory.model_context_limit : 128000;
                      next.memory = nextMemory;
                    });
                  }}
                  label=""
                  mode="bare"
                />
              </div>
              <NumberInput
                value={typeof memory.model_context_limit === 'number' ? memory.model_context_limit : undefined}
                min={1}
                allowEmpty={true}
                onValueChange={(value) => {
                  commitProviderSettings((next) => {
                    const nextMemory = isObject(next.memory) ? next.memory as Record<string, unknown> : {};
                    if (value == null) delete nextMemory.model_context_limit;
                    else nextMemory.model_context_limit = value;
                    next.memory = nextMemory;
                  });
                }}
                disabled={!Object.prototype.hasOwnProperty.call(memory, 'model_context_limit')}
                className="config-input"
              />
            </div>
          </>
        )}
      </div>

      <div className="nanogpt-task-settings__section">
        <h5>Custom Fields</h5>
        <div className="nanogpt-task-settings__row nanogpt-task-settings__row--textarea">
          <div className="nanogpt-task-settings__label">
            <span>Additional NanoGPT Body Fields</span>
            <span className="field-hint">
              JSON object merged into the request body last. If keys collide, these values win.
            </span>
          </div>
          <div className="nanogpt-task-settings__override">
            <ToggleSwitch
              checked={customFieldsOverridden}
              onChange={(checked) => {
                if (!checked) {
                  setCustomFieldsText('');
                  setCustomFieldsError(null);
                  commitProviderSettings((next) => {
                    delete next.custom_fields;
                  });
                  return;
                }
                setCustomFieldsText((prev) => prev || '{}');
              }}
              label=""
              mode="bare"
            />
          </div>
          <textarea
            value={customFieldsText}
            onChange={(event) => {
              const nextText = event.target.value;
              setCustomFieldsText(nextText);
              const parsed = parseCustomFields(nextText);
              setCustomFieldsError(parsed.error);
              if (parsed.error) return;
              commitProviderSettings((next) => {
                if (!parsed.value || Object.keys(parsed.value).length === 0) {
                  delete next.custom_fields;
                } else {
                  next.custom_fields = parsed.value;
                }
              });
            }}
            disabled={!customFieldsOverridden}
            className="config-input nanogpt-task-settings__textarea"
            rows={8}
            placeholder={`{\n  "top_k": 40\n}`}
          />
        </div>
        {customFieldsError ? <p className="nanogpt-task-settings__error">{customFieldsError}</p> : null}
      </div>
    </div>
  );
};

export default NanoGptTaskSettings;
