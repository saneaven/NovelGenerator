import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCredentialsStore } from '../../../store/credentialsStore';
import { useSubAgentStore } from '../../../store/subAgentStore';
import type { SubAgentAllowedMode, SubAgentDefinition } from '../../../types/subAgents';
import TaskConfigForm from '../TaskConfigForm';
import { IconButton } from '../../IconButton';
import { TextButton } from '../../TextButton';
import ToggleSwitch from '../../common/ToggleSwitch';
import { ChevronLeft, ChevronRight, Trash, Save, Sliders, Clock, Eye } from '../../icons';
import { schemaRegistry } from '../../../toolCall/schemas/schemaRegistry';
import TemplateEditor from './TemplateEditor';
import VersionHistoryModal from '../../Modal/VersionHistoryModal';
import { usePromptEditor } from '../hooks/usePromptEditor';
import { SUB_AGENT_CALL_PREFIX, isValidAgentName, toCallToolName } from '../../../subAgent/tools/SubAgentCallTools';
import PromptPreviewModal from './PromptPreviewModal';
import type { PromptNode } from './promptTree';

import './SubAgentEditor.css';

type PromptTab = 'systemPrompt' | 'userPrompt' | 'prefill';
type SubAgentEditorTab = 'general' | 'toolCalls' | 'provider' | 'prompts';

const MODE_OPTIONS: Array<{ mode: SubAgentAllowedMode; labelKey: string }> = [
  { mode: 'storyObject', labelKey: 'settings.promptEditor.subAgentModes.storyObject' },
  { mode: 'novelEditor', labelKey: 'settings.promptEditor.subAgentModes.novelEditor' },
  { mode: 'outlineManager', labelKey: 'settings.promptEditor.subAgentModes.outlineManager' },
  { mode: 'subAgent', labelKey: 'settings.promptEditor.subAgentModes.subAgent' },
];

function normalizeString(value: string): string {
  return value.trim();
}

function snapshotForChangeDetection(agent: SubAgentDefinition): string {
  return JSON.stringify({
    agent_name: agent.agent_name,
    display_name: agent.display_name,
    description: agent.description,
    enabled: agent.enabled,
    allowed_agent_modes: [...agent.allowed_agent_modes].sort(),
    allowed_tool_names: [...agent.allowed_tool_names].sort(),
    allowed_sub_agent_ids: [...agent.allowed_sub_agent_ids].sort(),
    llm_config: agent.llm_config,
  });
}

const SubAgentPromptEditors: React.FC<{ agentName: string }> = ({ agentName }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<PromptTab>('systemPrompt');
  const [showVersions, setShowVersions] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const system = usePromptEditor('subAgent', 'systemPrompt', agentName);
  const user = usePromptEditor('subAgent', 'userPrompt', agentName);
  const prefill = usePromptEditor('subAgent', 'prefill', agentName);

  const current = activeTab === 'systemPrompt' ? system : activeTab === 'userPrompt' ? user : prefill;

  const previewNode: PromptNode = useMemo(() => ({
    id: `subAgent-${agentName}-${activeTab}`,
    label: `${agentName}/${activeTab}`,
    type: 'prompt',
    taskType: 'subAgent',
    category: activeTab,
    name: agentName,
  }), [agentName, activeTab]);

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
        />

        <IconButton
          icon={<Clock size="sm" />}
          onClick={() => setShowVersions(true)}
          title={t('settings.promptEditor.versionHistory')}
          size="sm"
        />
      </div>

      <TemplateEditor
        content={current.content}
        onContentChange={current.setContent}
        validation={current.validation}
        isLoading={current.isLoading}
        isSaving={current.isSaving}
        hasChanges={current.hasChanges}
        onSave={current.onSave}
        placeholder={t('settings.promptEditor.enterPromptTemplate')}
      />

      {showVersions && (
        <VersionHistoryModal
          isOpen={showVersions}
          onClose={() => setShowVersions(false)}
          onRestoreVersion={() => current.reload()}
          textVersionProps={current.versionHistoryProps}
        />
      )}

      {showPreview && (
        <PromptPreviewModal
          isOpen={showPreview}
          onClose={() => setShowPreview(false)}
          templateContent={current.content}
          promptNode={previewNode}
        />
      )}
    </section>
  );
};

interface SubAgentEditorProps {
  selectedId: string | null;
  onDeleted: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

const SubAgentEditor: React.FC<SubAgentEditorProps> = ({
  selectedId,
  onDeleted,
  isSidebarCollapsed,
  onToggleSidebar,
}) => {
  const { t } = useTranslation();
  const credentials = useCredentialsStore((s) => s.credentials);
  const { subAgents, updateSubAgent, deleteSubAgent } = useSubAgentStore();

  const agent = useMemo(() => {
    return selectedId ? subAgents.find((s) => s.id === selectedId) : undefined;
  }, [selectedId, subAgents]);

  const allStaticTools = useMemo(() => {
    return schemaRegistry
      .getAll()
      .map((s) => s.name)
      .filter((name) => !name.startsWith('call_') && name !== 'return_sub_agent_result')
      .sort();
  }, []);

  const [editedAgentName, setEditedAgentName] = useState('');
  const [editedDisplayName, setEditedDisplayName] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [editedEnabled, setEditedEnabled] = useState(true);
  const [editedModes, setEditedModes] = useState<SubAgentAllowedMode[]>([]);
  const [editedTools, setEditedTools] = useState<string[]>([]);
  const [editedAllowedSubAgentIds, setEditedAllowedSubAgentIds] = useState<string[]>([]);
  const [toolFilter, setToolFilter] = useState('');
  const [editedConfig, setEditedConfig] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<SubAgentEditorTab>('general');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const originalSnapshotRef = useRef<string>('');

  useEffect(() => {
    if (!agent) {
      setEditedAgentName('');
      setEditedDisplayName('');
      setEditedDescription('');
      setEditedEnabled(true);
      setEditedModes([]);
      setEditedTools([]);
      setEditedAllowedSubAgentIds([]);
      setEditedConfig(null);
      originalSnapshotRef.current = '';
      setError('');
      return;
    }

    setEditedAgentName(agent.agent_name);
    setEditedDisplayName(agent.display_name);
    setEditedDescription(agent.description);
    setEditedEnabled(agent.enabled);
    setEditedModes(agent.allowed_agent_modes);
    setEditedTools(agent.allowed_tool_names.filter((n) => !n.startsWith('call_') && n !== 'return_sub_agent_result'));
    setEditedAllowedSubAgentIds(agent.allowed_sub_agent_ids ?? []);
    setEditedConfig(agent.llm_config);
    originalSnapshotRef.current = snapshotForChangeDetection(agent);
    setError('');
    setToolFilter('');
  }, [agent?.id]);

  const currentSnapshot = useMemo(() => {
    if (!agent) return '';
    return JSON.stringify({
      agent_name: normalizeString(editedAgentName),
      display_name: editedDisplayName,
      description: normalizeString(editedDescription),
      enabled: editedEnabled,
      allowed_agent_modes: [...editedModes].sort(),
      allowed_tool_names: [...editedTools].sort(),
      allowed_sub_agent_ids: [...editedAllowedSubAgentIds].sort(),
      llm_config: editedConfig,
    });
  }, [agent, editedAgentName, editedDisplayName, editedDescription, editedEnabled, editedModes, editedTools, editedAllowedSubAgentIds, editedConfig]);

  const hasChanges = Boolean(agent) && currentSnapshot !== originalSnapshotRef.current;

  const filteredTools = useMemo(() => {
    const q = toolFilter.trim().toLowerCase();
    if (!q) return allStaticTools;
    return allStaticTools.filter((name) => name.toLowerCase().includes(q));
  }, [allStaticTools, toolFilter]);

  const setModeChecked = (mode: SubAgentAllowedMode, checked: boolean) => {
    setEditedModes((prev) => {
      const has = prev.includes(mode);
      if (checked && !has) return [...prev, mode];
      if (!checked && has) return prev.filter((m) => m !== mode);
      return prev;
    });
  };

  const setToolChecked = (toolName: string, checked: boolean) => {
    setEditedTools((prev) => {
      const has = prev.includes(toolName);
      if (checked && !has) return [...prev, toolName];
      if (!checked && has) return prev.filter((n) => n !== toolName);
      return prev;
    });
  };

  const setSubAgentAllowedChecked = (subAgentId: string, checked: boolean) => {
    setEditedAllowedSubAgentIds((prev) => {
      const has = prev.includes(subAgentId);
      if (checked && !has) return [...prev, subAgentId];
      if (!checked && has) return prev.filter((id) => id !== subAgentId);
      return prev;
    });
  };

  const handleSave = async () => {
    if (!agent) return;

    let agent_name = editedAgentName.trim();
    if (agent_name.startsWith(SUB_AGENT_CALL_PREFIX)) {
      agent_name = agent_name.slice(SUB_AGENT_CALL_PREFIX.length);
    }
    const name = editedDisplayName.trim();
    const desc = editedDescription.trim();
    if (!agent_name) {
      setError(t('settings.promptEditor.subAgentSave.idRequired'));
      return;
    }
    if (agent_name.length > 50) {
      setError(t('settings.promptEditor.subAgentSave.idTooLong'));
      return;
    }
    if (!isValidAgentName(agent_name)) {
      setError(t('settings.promptEditor.subAgentSave.invalidId'));
      return;
    }
    if (!name) {
      setError(t('settings.promptEditor.subAgentSave.nameRequired'));
      return;
    }
    if (!desc) {
      setError(t('settings.promptEditor.subAgentSave.descriptionRequired'));
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      const updated = await updateSubAgent(agent.id, {
        agent_name,
        display_name: name,
        description: desc,
        enabled: editedEnabled,
        allowed_agent_modes: editedModes,
        allowed_tool_names: editedTools.filter((n) => !n.startsWith('call_') && n !== 'return_sub_agent_result'),
        allowed_sub_agent_ids: editedAllowedSubAgentIds,
        llm_config: editedConfig,
      });
      originalSnapshotRef.current = snapshotForChangeDetection(updated);
    } catch (err: any) {
      setError(err?.message || t('settings.promptEditor.subAgentSave.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!agent) return;
    const ok = window.confirm(t('settings.promptEditor.subAgentDelete.confirm', { name: agent.display_name }));
    if (!ok) return;
    try {
      await deleteSubAgent(agent.id);
      onDeleted();
    } catch (err: any) {
      setError(err?.message || t('settings.promptEditor.subAgentDelete.deleteFailed'));
    }
  };

  if (!agent) {
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

  return (
    <div className="sub-agent-editor">
      <div className="sub-agent-editor__header">
        <div className="sub-agent-editor__title-row">
          <div className="sub-agent-editor__title-line">
            <h3 className="sub-agent-editor__title">{agent.display_name}</h3>
            <div className="sub-agent-editor__enabled-toggle">
              <ToggleSwitch
                checked={editedEnabled}
                onChange={setEditedEnabled}
                label={t('common.enabled')}
              />
            </div>
          </div>
          <div className="sub-agent-editor__id-block">
            <div className="sub-agent-editor__id-line">
              <span className="sub-agent-editor__id-key">{t('settings.promptEditor.subAgentIds.tool')}</span>
              <span className="sub-agent-editor__id-value">{toCallToolName(editedAgentName || agent.agent_name)}</span>
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
          <TextButton
            iconLeft={<Trash size="sm" />}
            variant="secondary"
            onClick={handleDelete}
          >
            {t('common.delete')}
          </TextButton>
          <TextButton
            iconLeft={<Save size="sm" />}
            variant="primary"
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            loading={isSaving}
          >
            {t('common.save')}
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
            <h4 className="sub-agent-editor__section-title">{t('settings.promptEditor.subAgentSettings.title')}</h4>

            <div className="sub-agent-editor__field-row">
              <label className="sub-agent-editor__label">{t('settings.promptEditor.subAgentSettings.toolId')}</label>
              <div>
                <div className="sub-agent-editor__agent-name-row">
                  <span className="sub-agent-editor__agent-name-prefix">{SUB_AGENT_CALL_PREFIX}</span>
                  <input
                    className="sub-agent-editor__input sub-agent-editor__input--mono"
                    value={editedAgentName}
                    onChange={(e) => {
                      const next = e.target.value;
                      setEditedAgentName(next.startsWith(SUB_AGENT_CALL_PREFIX) ? next.slice(SUB_AGENT_CALL_PREFIX.length) : next);
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
                value={editedDisplayName}
                onChange={(e) => setEditedDisplayName(e.target.value)}
              />
            </div>

            <div className="sub-agent-editor__field-row sub-agent-editor__field-row--textarea">
              <label className="sub-agent-editor__label">{t('settings.promptEditor.subAgentSettings.description')}</label>
              <textarea
                className="sub-agent-editor__textarea"
                value={editedDescription}
                onChange={(e) => setEditedDescription(e.target.value)}
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
                  checked={editedModes.includes(opt.mode)}
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
                  checked={editedTools.includes(toolName)}
                  onChange={(checked) => setToolChecked(toolName, checked)}
                  label={toolName}
                />
              ))}
            </div>
            <div className="sub-agent-editor__hint">
              {t('settings.promptEditor.subAgentSettings.returnResultAlwaysAvailable')}
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
                    checked={editedAllowedSubAgentIds.includes(s.id)}
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
            {editedConfig && (
              <TaskConfigForm
                taskType="agent"
                config={editedConfig}
                credentials={credentials}
                onChange={(cfg) => setEditedConfig(cfg)}
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
          <SubAgentPromptEditors agentName={agent.agent_name} />
        </div>

        {error && <div className="sub-agent-editor__error">{error}</div>}
      </div>
    </div>
  );
};

export default SubAgentEditor;
