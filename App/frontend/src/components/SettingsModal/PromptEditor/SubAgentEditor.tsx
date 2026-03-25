import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useMcpStore } from '../../../store/mcpStore';
import { usePresetStore } from '../../../store/presetStore';
import { useResolvedTaskConfig, useSettings } from '../../../store/settingsStore';
import { useSubAgentStore } from '../../../store/subAgentStore';
import type {
  SubAgentAllowedInvocation,
  SubAgentCreatePayload,
  SubAgentDefinition,
  SubAgentToolGrant,
  SubAgentToolGrantCatalogItem,
} from '../../../types/subAgents';
import type { TaskAIConfig } from '../../../store/settingsStore';
import TaskConfigForm from '../TaskConfigForm';
import ToggleSwitch from '../../common/ToggleSwitch';
import { Trash, Clock, Eye } from '../../icons';
import { subAgentService } from '../../../api/subAgentService';
import TemplateEditor from './TemplateEditor';
import EditorPanelHeader from './EditorPanelHeader';
import HeaderOverflowMenu from './HeaderOverflowMenu';
import VersionHistoryModal from '../../Modal/VersionHistoryModal';
import { scenarioService } from '../../../api/scenarioService';
import { validateTemplate } from '../../../templateEngine/engine';
import { mapTaskTypeToSchemaType } from '../../../templateEngine/validator';
import {
  SUB_AGENT_CALL_PREFIX,
  isValidAgentName,
  toCallToolName,
} from '../../../subAgent/tools/SubAgentCallTools';
import PromptPreviewModal from './PromptPreviewModal';
import type { ScenarioDocument } from '../../../types/scenarios';

import { confirm, alert as showAlert } from '../../../store/dialogStore';
import './SubAgentEditor.css';

type PromptTab = 'systemPrompt' | 'userPrompt';
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
  tool_grants: SubAgentToolGrant[];
  allowed_sub_agent_ids: string[];
  allowed_mcp_server_ids: string[];
  use_custom_llm_config: boolean;
  llm_config_override: TaskAIConfig | null;
}

export interface SubAgentDefinitionDraft {
  draftKey: string;
  subAgentId: string | null;
  isNew: boolean;
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

export function normalizeAgentName(value: string): string {
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
    tool_grants: [...data.tool_grants]
      .map((item) => ({
        feature_key: item.feature_key,
        categories: [...item.categories].sort(),
      }))
      .sort((a, b) => a.feature_key.localeCompare(b.feature_key)),
    allowed_sub_agent_ids: [...data.allowed_sub_agent_ids].sort(),
    allowed_mcp_server_ids: [...data.allowed_mcp_server_ids].sort(),
    use_custom_llm_config: data.use_custom_llm_config,
    llm_config_override: data.llm_config_override,
  });
}

export function computeSubAgentDraft(next: SubAgentDefinitionDraft): SubAgentDefinitionDraft {
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
  return { ...next, dirty: next.isNew || dirty, error };
}

export function buildEmptySubAgentDraft(draftKey: string): SubAgentDefinitionDraft {
  const base: SubAgentDraftData = {
    agent_name: '',
    display_name: '',
    description: '',
    enabled: true,
    allowed_invocation_modes: ['planMode', 'agentMode', 'subAgent'],
    tool_grants: [],
    allowed_sub_agent_ids: [],
    allowed_mcp_server_ids: [],
    use_custom_llm_config: false,
    llm_config_override: null,
  };
  return computeSubAgentDraft({
    draftKey,
    subAgentId: null,
    isNew: true,
    original: base,
    current: {
      ...base,
      allowed_invocation_modes: [...base.allowed_invocation_modes],
      tool_grants: [],
      allowed_sub_agent_ids: [],
      allowed_mcp_server_ids: [],
    },
    dirty: true,
    error: '',
  });
}

export function hydrateSubAgentDraft(definition: SubAgentDefinition, draftKey: string): SubAgentDefinitionDraft {
  const base: SubAgentDraftData = {
    agent_name: definition.agent_name,
    display_name: definition.display_name,
    description: definition.description,
    enabled: definition.enabled,
    allowed_invocation_modes: [...definition.allowed_invocation_modes],
    tool_grants: [...definition.tool_grants].map((item) => ({
      feature_key: item.feature_key,
      categories: [...item.categories],
    })),
    allowed_sub_agent_ids: [...definition.allowed_sub_agent_ids],
    allowed_mcp_server_ids: [...definition.allowed_mcp_server_ids],
    use_custom_llm_config: definition.use_custom_llm_config,
    llm_config_override: definition.llm_config_override,
  };
  return computeSubAgentDraft({
    draftKey,
    subAgentId: definition.id,
    isNew: false,
    original: {
      ...base,
      allowed_invocation_modes: [...base.allowed_invocation_modes],
      tool_grants: [...base.tool_grants].map((item) => ({ feature_key: item.feature_key, categories: [...item.categories] })),
      allowed_sub_agent_ids: [...base.allowed_sub_agent_ids],
      allowed_mcp_server_ids: [...base.allowed_mcp_server_ids],
    },
    current: {
      ...base,
      allowed_invocation_modes: [...base.allowed_invocation_modes],
      tool_grants: [...base.tool_grants].map((item) => ({ feature_key: item.feature_key, categories: [...item.categories] })),
      allowed_sub_agent_ids: [...base.allowed_sub_agent_ids],
      allowed_mcp_server_ids: [...base.allowed_mcp_server_ids],
    },
    dirty: false,
    error: '',
  });
}

export function buildSubAgentPayload(draft: SubAgentDefinitionDraft): SubAgentCreatePayload {
  return {
    agent_name: normalizeAgentName(draft.current.agent_name),
    display_name: draft.current.display_name.trim(),
    description: draft.current.description.trim(),
    enabled: draft.current.enabled,
    allowed_invocation_modes: draft.current.allowed_invocation_modes,
    tool_grants: draft.current.tool_grants.map((item) => ({
      feature_key: item.feature_key,
      categories: [...item.categories],
    })),
    allowed_sub_agent_ids: draft.current.allowed_sub_agent_ids,
    allowed_mcp_server_ids: draft.current.allowed_mcp_server_ids,
    use_custom_llm_config: draft.current.use_custom_llm_config,
    llm_config_override: draft.current.llm_config_override,
  };
}

const SubAgentPromptEditors: React.FC<{
  isNew: boolean;
  agentNameForHistory: string;
  agentNameForPreview: string;
  scenarioDraft: { scenario: ScenarioDocument; isLoading: boolean; loadError?: string } | null;
  onScenarioChange: (scenario: ScenarioDocument) => void;
  onReloadScenario: () => Promise<void>;
}> = ({ isNew, agentNameForHistory, agentNameForPreview, scenarioDraft, onScenarioChange, onReloadScenario }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<PromptTab>('systemPrompt');
  const [showVersions, setShowVersions] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [validationByTab, setValidationByTab] = useState<Record<PromptTab, TemplateValidationResult | null>>({
    systemPrompt: null,
    userPrompt: null,
  });

  useEffect(() => {
    setValidationByTab({
      systemPrompt: null,
      userPrompt: null,
    });
  }, [agentNameForHistory]);

  const activeContent = useMemo(() => {
    const scenario = scenarioDraft?.scenario;
    if (!scenario) return '';
    if (activeTab === 'systemPrompt') return scenario.system_template || '';

    if (activeTab === 'userPrompt') {
      const idx =
        scenario.blocks.findIndex(
          (b) => b.type === 'rangeMapping' && b.rangeMapping?.start_index === 0 && b.rangeMapping?.end_index === -1
        ) ?? -1;
      const fallbackIdx = idx >= 0 ? idx : scenario.blocks.findIndex((b) => b.type === 'rangeMapping');
      const block = fallbackIdx >= 0 ? scenario.blocks[fallbackIdx] : null;
      return block?.type === 'rangeMapping' ? block.rangeMapping?.user_template || '' : '';
    }

    return '';
  }, [activeTab, scenarioDraft?.scenario]);

  useEffect(() => {
    if (!scenarioDraft || scenarioDraft.isLoading) return;

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
  }, [activeContent, activeTab, agentNameForHistory, agentNameForPreview, scenarioDraft?.isLoading, scenarioDraft]);

  const currentVersionHistoryProps = useMemo(() => {
    return {
      title: 'Scenario Version History',
      loadVersions: () => scenarioService.getScenarioVersions('subAgent', agentNameForHistory),
      restoreVersion: async (vn: number) => {
        await scenarioService.restoreScenarioVersion('subAgent', agentNameForHistory, vn);
        await onReloadScenario();
      },
    };
  }, [agentNameForHistory, onReloadScenario]);

  const applyActiveTabChange = (text: string) => {
    if (!scenarioDraft) return;
    const scenario = scenarioDraft.scenario;

    const normalizeOrders = (s: ScenarioDocument): ScenarioDocument => ({
      ...s,
      blocks: (s.blocks || []).map((b, i) => ({ ...b, block_order: i })),
    });

    const safeUUID = (): string => {
      try {
        return crypto.randomUUID();
      } catch {
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
    };

    if (activeTab === 'systemPrompt') {
      onScenarioChange({ ...scenario, system_template: text });
      return;
    }

    if (activeTab === 'userPrompt') {
      const blocks = [...(scenario.blocks || [])];
      let idx = blocks.findIndex(
        (b) => b.type === 'rangeMapping' && b.rangeMapping?.start_index === 0 && b.rangeMapping?.end_index === -1
      );
      if (idx < 0) idx = blocks.findIndex((b) => b.type === 'rangeMapping');
      if (idx < 0) {
        blocks.push({
          id: safeUUID(),
          block_order: blocks.length,
          enabled: true,
          type: 'rangeMapping',
          rangeMapping: {
            start_index: 0,
            end_index: -1,
            user_template: '',
            assistant_template: '{{input.subAgentMessage}}',
          },
        });
        idx = blocks.length - 1;
      }
      const cur = blocks[idx];
      const range = cur.type === 'rangeMapping' && cur.rangeMapping
        ? cur.rangeMapping
        : { start_index: 0, end_index: -1, user_template: '', assistant_template: '{{input.subAgentMessage}}' };
      blocks[idx] = {
        ...cur,
        type: 'rangeMapping',
        rangeMapping: {
          ...range,
          start_index: range.start_index ?? 0,
          end_index: range.end_index ?? -1,
          user_template: text,
          assistant_template: range.assistant_template || '{{input.subAgentMessage}}',
        },
      };
      onScenarioChange(normalizeOrders({ ...scenario, blocks }));
    }
  };

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
        </div>

        <div className="sub-agent-editor__section-actions">
          <HeaderOverflowMenu
            items={[
              {
                key: 'preview-sub-agent-prompt',
                icon: <Eye size="sm" />,
                label: t('settings.promptEditor.preview.title'),
                onClick: () => setShowPreview(true),
                disabled: !scenarioDraft || scenarioDraft.isLoading,
              },
              {
                key: 'sub-agent-prompt-versions',
                icon: <Clock size="sm" />,
                label: t('settings.promptEditor.versionHistory'),
                onClick: () => setShowVersions(true),
                disabled: isNew || !scenarioDraft || scenarioDraft.isLoading,
              },
            ]}
          />
        </div>
      </div>

      <TemplateEditor
        content={activeContent || ''}
        onContentChange={(text) => applyActiveTabChange(text)}
        validation={validationByTab[activeTab]}
        isLoading={!scenarioDraft || scenarioDraft.isLoading}
        placeholder={t('settings.promptEditor.enterPromptTemplate')}
      />

      {showVersions && !isNew && (
        <VersionHistoryModal
          isOpen={showVersions}
          onClose={() => setShowVersions(false)}
          onRestoreVersion={() => onReloadScenario()}
          textVersionProps={currentVersionHistoryProps}
        />
      )}

      {showPreview && (
        <PromptPreviewModal
          isOpen={showPreview}
          onClose={() => setShowPreview(false)}
          templateContent={activeContent || ''}
          taskType="subAgent"
          taskSubtype={agentNameForPreview || agentNameForHistory}
          injectedInputKey={activeTab === 'userPrompt' ? 'agentMessage' : null}
          isMemoryPrompt={false}
        />
      )}
    </section>
  );
};

interface SubAgentEditorProps {
  draft: SubAgentDefinitionDraft | null;
  onDraftChange: (draft: SubAgentDefinitionDraft) => void;
  promptIdentityName: string | null;
  scenarioDraft: { scenario: ScenarioDocument; isLoading: boolean; loadError?: string } | null;
  onScenarioChange: (scenario: ScenarioDocument) => void;
  onReloadScenario: () => Promise<void>;
  onDeleted?: (subAgentId: string) => void;
  onDiscardNew?: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

const SubAgentEditor: React.FC<SubAgentEditorProps> = ({
  draft,
  onDraftChange,
  promptIdentityName,
  scenarioDraft,
  onScenarioChange,
  onReloadScenario,
  onDeleted,
  onDiscardNew,
  isSidebarCollapsed,
  onToggleSidebar,
}) => {
  const { t } = useTranslation();
  const { subAgents, deleteSubAgent } = useSubAgentStore();
  const settings = useSettings();
  const activePresetId = usePresetStore((state) => state.activePresetId);
  const { servers: mcpServers, ensureLoaded: ensureMcpLoaded } = useMcpStore(useShallow((state) => ({
    servers: state.servers,
    ensureLoaded: state.ensureLoaded,
  })));
  const globalSubAgentConfig = useResolvedTaskConfig('subAgent');

  const agent = useMemo(() => {
    return draft?.subAgentId ? subAgents.find((s) => s.id === draft.subAgentId) : undefined;
  }, [draft?.subAgentId, subAgents]);

  const [toolGrantCatalog, setToolGrantCatalog] = useState<SubAgentToolGrantCatalogItem[]>([]);
  useEffect(() => {
    subAgentService.listToolGrantCatalog().then(setToolGrantCatalog).catch(() => {});
  }, []);

  useEffect(() => {
    if (!activePresetId) return;
    void ensureMcpLoaded(activePresetId).catch(() => {});
  }, [activePresetId, ensureMcpLoaded]);

  const [activeTab, setActiveTab] = useState<SubAgentEditorTab>('general');

  useEffect(() => {
    setActiveTab('general');
  }, [draft?.draftKey]);

  useEffect(() => {
    if (!draft) return;
    if (!draft.current.use_custom_llm_config) return;
    if (draft.current.llm_config_override) return;
    updateDraft((cur) => ({
      ...cur,
      current: { ...cur.current, llm_config_override: globalSubAgentConfig },
    }));
  }, [draft?.current.use_custom_llm_config, draft?.current.llm_config_override, globalSubAgentConfig]);

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

  const setToolGrantChecked = (featureKey: string, category: string, checked: boolean) => {
    updateDraft((cur) => {
      const prev = cur.current.tool_grants;
      const currentGrant = prev.find((item) => item.feature_key === featureKey);
      const currentCategories = currentGrant ? [...currentGrant.categories] : [];
      const hasCategory = currentCategories.includes(category as any);
      const nextCategories = checked && !hasCategory
        ? [...currentCategories, category as any]
        : !checked && hasCategory
          ? currentCategories.filter((value) => value !== category)
          : currentCategories;
      const nextGrants = prev
        .filter((item) => item.feature_key !== featureKey)
        .concat(nextCategories.length > 0 ? [{ feature_key: featureKey as any, categories: nextCategories as any }] : [])
        .sort((a, b) => a.feature_key.localeCompare(b.feature_key));
      return { ...cur, current: { ...cur.current, tool_grants: nextGrants } };
    });
  };

  const hasToolGrant = (featureKey: string, category: string): boolean => {
    if (!draft) return false;
    const currentGrant = draft.current.tool_grants.find((item) => item.feature_key === featureKey);
    return Boolean(currentGrant?.categories.includes(category as any));
  };

  const setSubAgentAllowedChecked = (subAgentId: string, checked: boolean) => {
    updateDraft((cur) => {
      const prev = cur.current.allowed_sub_agent_ids;
      const has = prev.includes(subAgentId);
      const nextIds = checked && !has ? [...prev, subAgentId] : !checked && has ? prev.filter((id) => id !== subAgentId) : prev;
      return { ...cur, current: { ...cur.current, allowed_sub_agent_ids: nextIds } };
    });
  };

  const setMcpAllowedChecked = (serverId: string, checked: boolean) => {
    updateDraft((cur) => {
      const prev = cur.current.allowed_mcp_server_ids;
      const has = prev.includes(serverId);
      const nextIds = checked && !has ? [...prev, serverId] : !checked && has ? prev.filter((id) => id !== serverId) : prev;
      return { ...cur, current: { ...cur.current, allowed_mcp_server_ids: nextIds } };
    });
  };

  const handleDelete = async () => {
    if (!draft) return;
    if (draft.isNew || !draft.subAgentId) {
      onDiscardNew?.();
      return;
    }
    const ok = await confirm({
      title: t('common.delete'),
      message: t('settings.promptEditor.subAgentDelete.confirm', { name: draft.current.display_name }),
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await deleteSubAgent(draft.subAgentId);
      onDeleted?.(draft.subAgentId);
    } catch (err: any) {
      await showAlert({
        title: 'Delete Failed',
        message: err?.message || t('settings.promptEditor.subAgentDelete.deleteFailed'),
        variant: 'danger',
      });
    }
  };

  if (!draft) {
    return (
      <div className="sub-agent-editor sub-agent-editor--empty">
        <EditorPanelHeader
          title={t('settings.promptEditor.subAgents')}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
        />
        <div className="sub-agent-editor__empty-state">
          <p>{t('settings.promptEditor.subAgentSelectToEdit')}</p>
          <p className="sub-agent-editor__empty-hint">{t('settings.promptEditor.subAgentSelectToEditHint')}</p>
        </div>
      </div>
    );
  }

  const agentNameForPreview =
    normalizeAgentName(draft.current.agent_name)
    || normalizeAgentName(draft.original.agent_name)
    || agent?.agent_name
    || '';

  return (
    <div className="sub-agent-editor">
      <EditorPanelHeader
        title={draft.current.display_name}
        subtitle={toCallToolName(agentNameForPreview)}
        actions={
          <HeaderOverflowMenu
            items={[
              {
                key: draft.isNew ? 'discard-sub-agent' : 'delete-sub-agent',
                icon: <Trash size="sm" />,
                label: draft.isNew ? 'Discard' : t('common.delete'),
                onClick: handleDelete,
                variant: 'danger',
              },
            ]}
          />
        }
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
      />

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
              <label className="sub-agent-editor__label">{t('common.enabled')}</label>
              <ToggleSwitch
                checked={draft.current.enabled}
                onChange={(checked) => updateDraft((cur) => ({ ...cur, current: { ...cur.current, enabled: checked } }))}
                label={t('common.enabled')}
              />
            </div>

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
            <div className="sub-agent-editor__tool-grid">
              {toolGrantCatalog.map((item) => (
                <div key={item.feature_key} className="sub-agent-editor__field-row" style={{ alignItems: 'flex-start' }}>
                  <label className="sub-agent-editor__label">{item.display_name}</label>
                  <div className="sub-agent-editor__chip-grid">
                    {item.supported_categories.map((category) => (
                      <ToggleSwitch
                        key={`${item.feature_key}:${category}`}
                        checked={hasToolGrant(item.feature_key, category)}
                        onChange={(checked) => setToolGrantChecked(item.feature_key, category, checked)}
                        label={category}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {toolGrantCatalog.length === 0 && (
                <div className="sub-agent-editor__hint">No tool grant catalog available.</div>
              )}
            </div>
          </section>

          <section className="sub-agent-editor__section">
            <h4 className="sub-agent-editor__section-title">{t('settings.promptEditor.subAgentSettings.allowedSubAgents')}</h4>
            <div className="sub-agent-editor__sub-agent-grid">
              {subAgents
                .filter((s) => !draft.subAgentId || s.id !== draft.subAgentId)
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

          <section className="sub-agent-editor__section">
            <h4 className="sub-agent-editor__section-title">Allowed MCP Servers</h4>
            <div className="sub-agent-editor__sub-agent-grid">
              {mcpServers
                .filter((server) => server.enabled)
                .sort((a, b) => a.display_name.localeCompare(b.display_name))
                .map((server) => (
                  <ToggleSwitch
                    key={server.id}
                    checked={draft.current.allowed_mcp_server_ids.includes(server.id)}
                    onChange={(checked) => setMcpAllowedChecked(server.id, checked)}
                    label={server.display_name}
                  />
                ))}
              {mcpServers.filter((server) => server.enabled).length === 0 && (
                <div className="sub-agent-editor__hint">No enabled MCP servers.</div>
              )}
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
                customThinkingTemplates={settings.customThinkingTemplates}
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
              isNew={draft.isNew}
              agentNameForHistory={promptIdentityName}
              agentNameForPreview={agentNameForPreview}
              scenarioDraft={scenarioDraft}
              onScenarioChange={onScenarioChange}
              onReloadScenario={onReloadScenario}
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
