import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../../store/settingsStore';
import { useSubAgentStore } from '../../../store/subAgentStore';
import type { SubAgentAllowedInvocation } from '../../../types/subAgents';
import type { TaskAIConfig } from '../../../store/settingsStore';
import TaskConfigForm from '../TaskConfigForm';
import { IconButton } from '../../IconButton';
import { TextButton } from '../../TextButton';
import ToggleSwitch from '../../common/ToggleSwitch';
import { ChevronLeft, ChevronRight, Trash, Sliders, Clock, Eye } from '../../icons';
// TODO: Tool schema list should come from backend API
import TemplateEditor from './TemplateEditor';
import VersionHistoryModal from '../../Modal/VersionHistoryModal';
import { promptService } from '../../../api/promptService';
import { validateTemplate } from '../../../templateEngine/engine';
import { mapTaskTypeToSchemaType } from '../../../templateEngine/validator';
import {
  SUB_AGENT_CALL_PREFIX,
  isValidAgentName,
  toCallToolName,
} from '../../../subAgent/tools/SubAgentCallTools';
import PromptPreviewModal from './PromptPreviewModal';
import type { PromptNode } from './promptTree';

import './SubAgentEditor.css';

type PromptTab = 'systemPrompt' | 'userPrompt' | 'prefill';
type SubAgentEditorTab = 'general' | 'toolCalls' | 'provider' | 'prompts';

interface TemplateValidationResult {
  valid: boolean;
  errors: Array<{ message: string; line?: number; column?: number; severity: string }>;
  warnings: Array<{ message: string; line?: number; column?: number; severity: string }>;
}

export interface SubAgentDraftData {
  agent_name: string;
  display_name: string;
  description: string;
  enabled: boolean;
  allowed_invocation_modes: SubAgentAllowedInvocation[];
  allowed_tool_names: string[];
  allowed_sub_agent_ids: string[];
  use_custom_llm_config: boolean;
  llm_config_override: TaskAIConfig | null;
}

export interface SubAgentDefinitionDraft {
  subAgentId: string;
  original: SubAgentDraftData;
  current: SubAgentDraftData;
  dirty: boolean;
  error: string;
}

const MODE_OPTIONS: Array<{ mode: SubAgentAllowedInvocation; labelKey: string }> = [
  { mode: 'planMode', labelKey: 'settings.promptEditor.subAgentModes.planMode' },
  { mode: 'agentMode', labelKey: 'settings.promptEditor.subAgentModes.agentMode' },
  { mode: 'subAgent', labelKey: 'settings.promptEditor.subAgentModes.subAgent' },
];

function normalizeAgentName(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith(SUB_AGENT_CALL_PREFIX) ? trimmed.slice(SUB_AGENT_CALL_PREFIX.length) : trimmed;
}

function snapshotForDraft(data: SubAgentDraftData): string {
  return JSON.stringify({
    agent_name: normalizeAgentName(data.agent_name),
    display_name: data.display_name,
    description: data.description,
    enabled: data.enabled,
    allowed_invocation_modes: [...data.allowed_invocation_modes].sort(),
    allowed_tool_names: [...data.allowed_tool_names].sort(),
    allowed_sub_agent_ids: [...data.allowed_sub_agent_ids].sort(),
    use_custom_llm_config: data.use_custom_llm_config,
    llm_config_override: data.llm_config_override,
  });
}

function computeSubAgentDraft(next: SubAgentDefinitionDraft): SubAgentDefinitionDraft {
  const error = (() => {
    const agent_name = normalizeAgentName(next.current.agent_name);
    if (!agent_name) return 'Tool ID is required';
    if (agent_name.length > 50) return 'Tool ID must be 50 characters or less';
    if (!isValidAgentName(agent_name)) return 'Tool ID is invalid';
    if (!next.current.display_name.trim()) return 'Display name is required';
    if (!next.current.description.trim()) return 'Description is required';
    return '';
  })();

  const dirty = snapshotForDraft(next.current) !== snapshotForDraft(next.original);
  return { ...next, dirty, error };
}

type SubAgentPromptDraftView = {
  content: string;
  isLoading: boolean;
};

type SubAgentPromptDrafts = Record<PromptTab, SubAgentPromptDraftView | null>;

const SubAgentPromptEditors: React.FC<{
  agentNameForHistory: string;
  agentNameForPreview: string;
  promptDrafts: SubAgentPromptDrafts;
  onContentChange: (tab: PromptTab, content: string) => void;
  onReload: (tab: PromptTab) => Promise<void>;
}> = ({ agentNameForHistory, agentNameForPreview, promptDrafts, onContentChange, onReload }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<PromptTab>('systemPrompt');
  const [showVersions, setShowVersions] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [validationByTab, setValidationByTab] = useState<Record<PromptTab, TemplateValidationResult | null>>({
    systemPrompt: null,
    userPrompt: null,
    prefill: null,
  });

  useEffect(() => {
    setValidationByTab({
      systemPrompt: null,
      userPrompt: null,
      prefill: null,
    });
  }, [agentNameForHistory]);

  const activeDraft = promptDrafts[activeTab];
  const activeContent = activeDraft?.content ?? '';

  useEffect(() => {
    if (!activeDraft || activeDraft.isLoading) return;

    const timer = window.setTimeout(async () => {
      const schemaType = mapTaskTypeToSchemaType('subAgent', agentNameForPreview || agentNameForHistory);
      const result = await validateTemplate(activeContent, schemaType || undefined);

      if (!result.isValid) {
        setValidationByTab((prev) => ({
          ...prev,
          [activeTab]: {
            valid: false,
            errors: [{ message: result.error || 'Unknown syntax error', severity: 'error' }],
            warnings: [],
          },
        }));
        return;
      }

      setValidationByTab((prev) => ({
        ...prev,
        [activeTab]: {
          valid: true,
          errors: [],
          warnings:
            result.warnings?.map((w) => ({
              message: w.message,
              line: w.line,
              column: w.column,
              severity: w.severity,
            })) || [],
        },
      }));
    }, 500);

    return () => window.clearTimeout(timer);
  }, [activeContent, activeDraft?.isLoading, activeTab, agentNameForHistory, agentNameForPreview]);

  const previewNode: PromptNode = useMemo(
    () => ({
      id: `subAgent-${agentNameForPreview}-${activeTab}`,
      label: `${toCallToolName(agentNameForPreview)}/${activeTab}`,
      type: 'prompt',
      taskType: 'subAgent',
      category: activeTab,
      name: agentNameForPreview,
    }),
    [activeTab, agentNameForPreview]
  );

  const currentVersionHistoryProps = useMemo(() => {
    return {
      title: 'Prompt Version History',
      loadVersions: () => promptService.getVersionHistory('subAgent', activeTab, agentNameForHistory),
      restoreVersion: async (vn: number) => {
        await promptService.restoreVersion('subAgent', activeTab, vn, agentNameForHistory);
        await onReload(activeTab);
      },
    };
  }, [activeTab, agentNameForHistory, onReload]);

  return (
    <section className="sub-agent-editor__section sub-agent-editor__section--fill">
      <div className="sub-agent-editor__section-header">
        <div className="sub-agent-editor__tabs">
          <button
            type="button"
            className={`sub-agent-editor__tab ${activeTab === 'systemPrompt' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('systemPrompt')}
          >
            {t('settings.promptEditor.subAgentPrompts.system')}
          </button>
          <button
            type="button"
            className={`sub-agent-editor__tab ${activeTab === 'userPrompt' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('userPrompt')}
          >
            {t('settings.promptEditor.subAgentPrompts.user')}
          </button>
          <button
            type="button"
            className={`sub-agent-editor__tab ${activeTab === 'prefill' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('prefill')}
          >
            {t('settings.promptEditor.subAgentPrompts.prefill')}
          </button>
        </div>

        <IconButton
          icon={<Eye size="sm" />}
          onClick={() => setShowPreview(true)}
          title={t('settings.promptEditor.preview.title')}
          size="sm"
          disabled={!activeDraft || activeDraft.isLoading}
        />

        <IconButton
          icon={<Clock size="sm" />}
          onClick={() => setShowVersions(true)}
          title={t('settings.promptEditor.versionHistory')}
          size="sm"
          disabled={!activeDraft || activeDraft.isLoading}
        />
      </div>

      <TemplateEditor
        content={activeDraft?.content || ''}
        onContentChange={(text) => onContentChange(activeTab, text)}
        validation={validationByTab[activeTab]}
        isLoading={!activeDraft || activeDraft.isLoading}
        placeholder={t('settings.promptEditor.enterPromptTemplate')}
      />

      {showVersions && (
        <VersionHistoryModal
          isOpen={showVersions}
          onClose={() => setShowVersions(false)}
          onRestoreVersion={() => onReload(activeTab)}
          textVersionProps={currentVersionHistoryProps}
        />
      )}

      {showPreview && (
        <PromptPreviewModal
          isOpen={showPreview}
          onClose={() => setShowPreview(false)}
          templateContent={activeDraft?.content || ''}
          promptNode={previewNode}
        />
      )}
    </section>
  );
};

interface SubAgentEditorProps {
  selectedId: string | null;
  draft: SubAgentDefinitionDraft | null;
  onDraftChange: (draft: SubAgentDefinitionDraft) => void;
  promptIdentityName: string | null;
  promptDrafts: SubAgentPromptDrafts;
  onPromptContentChange: (tab: PromptTab, content: string) => void;
  onReloadPrompt: (tab: PromptTab) => Promise<void>;
  onDeleted?: (subAgentId: string) => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

const SubAgentEditor: React.FC<SubAgentEditorProps> = ({
  selectedId,
  draft,
  onDraftChange,
  promptIdentityName,
  promptDrafts,
  onPromptContentChange,
  onReloadPrompt,
  onDeleted,
  isSidebarCollapsed,
  onToggleSidebar,
}) => {
  const { t } = useTranslation();
  const settings = useSettings();
  const { subAgents, deleteSubAgent } = useSubAgentStore();
  const globalSubAgentConfig = settings.task_configs.subAgent;

  const agent = useMemo(() => {
    return selectedId ? subAgents.find((s) => s.id === selectedId) : undefined;
  }, [selectedId, subAgents]);

  // TODO: fetch tool list from backend API
  const allStaticTools = useMemo(() => {
    return [] as string[];
  }, []);

  const [toolFilter, setToolFilter] = useState('');
  const [activeTab, setActiveTab] = useState<SubAgentEditorTab>('general');

  useEffect(() => {
    setToolFilter('');
    setActiveTab('general');
  }, [selectedId]);

  useEffect(() => {
    if (!draft) return;
    if (!draft.current.use_custom_llm_config) return;
    if (draft.current.llm_config_override) return;
    updateDraft((cur) => ({
      ...cur,
      current: { ...cur.current, llm_config_override: globalSubAgentConfig },
    }));
  }, [draft?.current.use_custom_llm_config, draft?.current.llm_config_override, globalSubAgentConfig]);

  const filteredTools = useMemo(() => {
    const q = toolFilter.trim().toLowerCase();
    if (!q) return allStaticTools;
    return allStaticTools.filter((name) => name.toLowerCase().includes(q));
  }, [allStaticTools, toolFilter]);

  const updateDraft = (updater: (cur: SubAgentDefinitionDraft) => SubAgentDefinitionDraft) => {
    if (!draft) return;
    onDraftChange(computeSubAgentDraft(updater(draft)));
  };

  const setModeChecked = (mode: SubAgentAllowedInvocation, checked: boolean) => {
    updateDraft((cur) => {
      const prev = cur.current.allowed_invocation_modes;
      const has = prev.includes(mode);
      const nextModes = checked && !has ? [...prev, mode] : !checked && has ? prev.filter((m) => m !== mode) : prev;
      return { ...cur, current: { ...cur.current, allowed_invocation_modes: nextModes } };
    });
  };

  const setToolChecked = (toolName: string, checked: boolean) => {
    updateDraft((cur) => {
      const prev = cur.current.allowed_tool_names;
      const has = prev.includes(toolName);
      const nextTools = checked && !has ? [...prev, toolName] : !checked && has ? prev.filter((n) => n !== toolName) : prev;
      return { ...cur, current: { ...cur.current, allowed_tool_names: nextTools } };
    });
  };

  const setSubAgentAllowedChecked = (subAgentId: string, checked: boolean) => {
    updateDraft((cur) => {
      const prev = cur.current.allowed_sub_agent_ids;
      const has = prev.includes(subAgentId);
      const nextIds = checked && !has ? [...prev, subAgentId] : !checked && has ? prev.filter((id) => id !== subAgentId) : prev;
      return { ...cur, current: { ...cur.current, allowed_sub_agent_ids: nextIds } };
    });
  };

  const handleDelete = async () => {
    if (!draft) return;
    const ok = window.confirm(t('settings.promptEditor.subAgentDelete.confirm', { name: draft.current.display_name }));
    if (!ok) return;
    try {
      await deleteSubAgent(draft.subAgentId);
      onDeleted?.(draft.subAgentId);
    } catch (err: any) {
      window.alert(err?.message || t('settings.promptEditor.subAgentDelete.deleteFailed'));
    }
  };

  if (!agent || !draft) {
    return (
      <div className="sub-agent-editor sub-agent-editor--empty">
        <div className="sub-agent-editor__header">
          <div className="sub-agent-editor__title-row">
            <h3 className="sub-agent-editor__title">{t('settings.promptEditor.subAgents')}</h3>
          </div>
          <div className="sub-agent-editor__actions">
            {onToggleSidebar && (
              <IconButton
                icon={isSidebarCollapsed ? <ChevronLeft size="sm" /> : <ChevronRight size="sm" />}
                onClick={onToggleSidebar}
                title={isSidebarCollapsed ? t('settings.promptEditor.expandSidebar') : t('settings.promptEditor.collapseSidebar')}
                size="sm"
              />
            )}
          </div>
        </div>
        <div className="sub-agent-editor__empty-state">
          <p>{t('settings.promptEditor.subAgentSelectToEdit')}</p>
          <p className="sub-agent-editor__empty-hint">{t('settings.promptEditor.subAgentSelectToEditHint')}</p>
        </div>
      </div>
    );
  }

  const agentNameForPreview =
    normalizeAgentName(draft.current.agent_name) || normalizeAgentName(draft.original.agent_name) || agent.agent_name;

  return (
    <div className="sub-agent-editor">
      <div className="sub-agent-editor__header">
        <div className="sub-agent-editor__title-row">
          <div className="sub-agent-editor__title-line">
            <h3 className="sub-agent-editor__title">{draft.current.display_name}</h3>
            <div className="sub-agent-editor__enabled-toggle">
              <ToggleSwitch
                checked={draft.current.enabled}
                onChange={(checked) => updateDraft((cur) => ({ ...cur, current: { ...cur.current, enabled: checked } }))}
                label={t('common.enabled')}
              />
            </div>
          </div>
          <div className="sub-agent-editor__id-block">
            <div className="sub-agent-editor__id-line">
              <span className="sub-agent-editor__id-key">{t('settings.promptEditor.subAgentIds.tool')}</span>
              <span className="sub-agent-editor__id-value">{toCallToolName(agentNameForPreview)}</span>
            </div>
            <div className="sub-agent-editor__id-line">
              <span className="sub-agent-editor__id-key">{t('settings.promptEditor.subAgentIds.uuid')}</span>
              <span className="sub-agent-editor__id-value">{agent.id}</span>
            </div>
          </div>
        </div>
        <div className="sub-agent-editor__actions">
          {onToggleSidebar && (
            <IconButton
              icon={isSidebarCollapsed ? <ChevronLeft size="sm" /> : <ChevronRight size="sm" />}
              onClick={onToggleSidebar}
              title={isSidebarCollapsed ? t('settings.promptEditor.expandSidebar') : t('settings.promptEditor.collapseSidebar')}
              size="sm"
            />
          )}
          <TextButton iconLeft={<Trash size="sm" />} variant="secondary" onClick={handleDelete}>
            {t('common.delete')}
          </TextButton>
        </div>
      </div>

      <div className="sub-agent-editor__content">
        <div
          className="sub-agent-editor__main-tabs"
          role="tablist"
          aria-label={t('settings.promptEditor.subAgentEditorTabs.ariaLabel')}
        >
          <button
            type="button"
            id="sub-agent-editor-tab-general"
            role="tab"
            className={`sub-agent-editor__tab ${activeTab === 'general' ? 'is-active' : ''}`}
            aria-selected={activeTab === 'general'}
            aria-controls="sub-agent-editor-panel-general"
            onClick={() => setActiveTab('general')}
          >
            {t('settings.promptEditor.subAgentEditorTabs.general')}
          </button>
          <button
            type="button"
            id="sub-agent-editor-tab-toolCalls"
            role="tab"
            className={`sub-agent-editor__tab ${activeTab === 'toolCalls' ? 'is-active' : ''}`}
            aria-selected={activeTab === 'toolCalls'}
            aria-controls="sub-agent-editor-panel-toolCalls"
            onClick={() => setActiveTab('toolCalls')}
          >
            {t('settings.promptEditor.subAgentEditorTabs.toolCalls')}
          </button>
          <button
            type="button"
            id="sub-agent-editor-tab-provider"
            role="tab"
            className={`sub-agent-editor__tab ${activeTab === 'provider' ? 'is-active' : ''}`}
            aria-selected={activeTab === 'provider'}
            aria-controls="sub-agent-editor-panel-provider"
            onClick={() => setActiveTab('provider')}
          >
            {t('settings.promptEditor.subAgentEditorTabs.provider')}
          </button>
          <button
            type="button"
            id="sub-agent-editor-tab-prompts"
            role="tab"
            className={`sub-agent-editor__tab ${activeTab === 'prompts' ? 'is-active' : ''}`}
            aria-selected={activeTab === 'prompts'}
            aria-controls="sub-agent-editor-panel-prompts"
            onClick={() => setActiveTab('prompts')}
          >
            {t('settings.promptEditor.subAgentEditorTabs.prompts')}
          </button>
        </div>

        <div
          id="sub-agent-editor-panel-general"
          className="sub-agent-editor__tab-panel"
          role="tabpanel"
          aria-labelledby="sub-agent-editor-tab-general"
          hidden={activeTab !== 'general'}
        >
          <section className="sub-agent-editor__section">
            <h4 className="sub-agent-editor__section-title">{t('settings.promptEditor.subAgentSettings.identity')}</h4>

            <div className="sub-agent-editor__field-row">
              <label className="sub-agent-editor__label">{t('settings.promptEditor.subAgentSettings.toolId')}</label>
              <div>
                <div className="sub-agent-editor__agent-name-row">
                  <span className="sub-agent-editor__agent-name-prefix">{SUB_AGENT_CALL_PREFIX}</span>
                  <input
                    className="sub-agent-editor__input sub-agent-editor__input--mono"
                    value={draft.current.agent_name}
                    onChange={(e) => {
                      const next = e.target.value;
                      updateDraft((cur) => ({
                        ...cur,
                        current: {
                          ...cur.current,
                          agent_name: next.startsWith(SUB_AGENT_CALL_PREFIX) ? next.slice(SUB_AGENT_CALL_PREFIX.length) : next,
                        },
                      }));
                    }}
                  />
                </div>
                <div className="sub-agent-editor__hint">{t('settings.promptEditor.subAgentSettings.toolIdHint')}</div>
              </div>
            </div>

            <div className="sub-agent-editor__field-row">
              <label className="sub-agent-editor__label">{t('settings.promptEditor.subAgentSettings.displayName')}</label>
              <input
                className="sub-agent-editor__input"
                value={draft.current.display_name}
                onChange={(e) => updateDraft((cur) => ({ ...cur, current: { ...cur.current, display_name: e.target.value } }))}
              />
            </div>

            <div className="sub-agent-editor__field-row sub-agent-editor__field-row--textarea">
              <label className="sub-agent-editor__label">{t('settings.promptEditor.subAgentSettings.description')}</label>
              <textarea
                className="sub-agent-editor__textarea"
                value={draft.current.description}
                onChange={(e) => updateDraft((cur) => ({ ...cur, current: { ...cur.current, description: e.target.value } }))}
                rows={3}
              />
            </div>
          </section>

          <section className="sub-agent-editor__section">
            <h4 className="sub-agent-editor__section-title">{t('settings.promptEditor.subAgentSettings.allowedModes')}</h4>
            <div className="sub-agent-editor__chip-grid">
              {MODE_OPTIONS.map((opt) => (
                <ToggleSwitch
                  key={opt.mode}
                  checked={draft.current.allowed_invocation_modes.includes(opt.mode)}
                  onChange={(checked) => setModeChecked(opt.mode, checked)}
                  label={t(opt.labelKey)}
                />
              ))}
            </div>
          </section>
        </div>

        <div
          id="sub-agent-editor-panel-toolCalls"
          className="sub-agent-editor__tab-panel sub-agent-editor__tab-panel--fill"
          role="tabpanel"
          aria-labelledby="sub-agent-editor-tab-toolCalls"
          hidden={activeTab !== 'toolCalls'}
        >
          <section className="sub-agent-editor__section sub-agent-editor__section--fill">
            <h4 className="sub-agent-editor__section-title">{t('settings.promptEditor.subAgentSettings.allowedTools')}</h4>
            <div className="sub-agent-editor__tool-filter">
              <Sliders size="sm" />
              <input
                className="sub-agent-editor__tool-filter-input"
                value={toolFilter}
                onChange={(e) => setToolFilter(e.target.value)}
                placeholder={t('settings.promptEditor.subAgentSettings.toolFilterPlaceholder')}
              />
            </div>

            <div className="sub-agent-editor__tool-grid">
              {filteredTools.map((toolName) => (
                <ToggleSwitch
                  key={toolName}
                  checked={draft.current.allowed_tool_names.includes(toolName)}
                  onChange={(checked) => setToolChecked(toolName, checked)}
                  label={toolName}
                />
              ))}
            </div>
          </section>

          <section className="sub-agent-editor__section">
            <h4 className="sub-agent-editor__section-title">{t('settings.promptEditor.subAgentSettings.allowedSubAgents')}</h4>
            <div className="sub-agent-editor__sub-agent-grid">
              {subAgents
                .filter((s) => s.id !== agent.id)
                .sort((a, b) => a.display_name.localeCompare(b.display_name))
                .map((s) => (
                  <ToggleSwitch
                    key={s.id}
                    checked={draft.current.allowed_sub_agent_ids.includes(s.id)}
                    onChange={(checked) => setSubAgentAllowedChecked(s.id, checked)}
                    label={toCallToolName(s.agent_name)}
                    disabled={!s.enabled}
                  />
                ))}
            </div>
          </section>
        </div>

        <div
          id="sub-agent-editor-panel-provider"
          className="sub-agent-editor__tab-panel"
          role="tabpanel"
          aria-labelledby="sub-agent-editor-tab-provider"
          hidden={activeTab !== 'provider'}
        >
          <section className="sub-agent-editor__section">
            <h4 className="sub-agent-editor__section-title">{t('settings.promptEditor.subAgentSettings.llmConfig')}</h4>
            <ToggleSwitch
              checked={draft.current.use_custom_llm_config}
              onChange={(checked) => {
                updateDraft((cur) => ({
                  ...cur,
                  current: {
                    ...cur.current,
                    use_custom_llm_config: checked,
                    llm_config_override:
                      checked && !cur.current.llm_config_override ? globalSubAgentConfig : cur.current.llm_config_override,
                  },
                }));
              }}
              label={t('settings.promptEditor.subAgentSettings.useCustomLlmConfig')}
            />
            <div className="sub-agent-editor__hint">{t('settings.promptEditor.subAgentSettings.useCustomLlmConfigHint')}</div>

            {!draft.current.use_custom_llm_config ? (
              <div className="sub-agent-editor__hint">
                {t('settings.promptEditor.subAgentSettings.globalLlmConfigSummary', {
                  provider: globalSubAgentConfig.provider,
                  model: globalSubAgentConfig.model,
                  temperature: globalSubAgentConfig.temperature,
                })}
              </div>
            ) : (
              <TaskConfigForm
                taskType="subAgent"
                config={draft.current.llm_config_override ?? globalSubAgentConfig}
                onChange={(cfg) =>
                  updateDraft((cur) => ({
                    ...cur,
                    current: { ...cur.current, llm_config_override: cfg },
                  }))
                }
              />
            )}
          </section>
        </div>

        <div
          id="sub-agent-editor-panel-prompts"
          className="sub-agent-editor__tab-panel sub-agent-editor__tab-panel--fill"
          role="tabpanel"
          aria-labelledby="sub-agent-editor-tab-prompts"
          hidden={activeTab !== 'prompts'}
        >
          {promptIdentityName ? (
            <SubAgentPromptEditors
              agentNameForHistory={promptIdentityName}
              agentNameForPreview={agentNameForPreview}
              promptDrafts={promptDrafts}
              onContentChange={onPromptContentChange}
              onReload={onReloadPrompt}
            />
          ) : (
            <section className="sub-agent-editor__section">
              <div className="sub-agent-editor__hint">Select a Sub Agent to edit prompts.</div>
            </section>
          )}
        </div>

        {draft.error && <div className="sub-agent-editor__error">{draft.error}</div>}
      </div>
    </div>
  );
};

export default SubAgentEditor;
