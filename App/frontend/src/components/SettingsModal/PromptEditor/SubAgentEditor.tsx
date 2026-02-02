import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCredentialsStore } from '../../../store/credentialsStore';
import { useSubAgentStore } from '../../../store/subAgentStore';
import type { SubAgentAllowedMode, SubAgentDefinition } from '../../../types/subAgents';
import TaskConfigForm from '../TaskConfigForm';
import { IconButton } from '../../IconButton';
import { TextButton } from '../../TextButton';
import { ChevronLeft, ChevronRight, Trash, Save, Sliders, Clock } from '../../icons';
import { schemaRegistry } from '../../../toolCall/schemas/schemaRegistry';
import TemplateEditor from './TemplateEditor';
import VersionHistoryModal from '../../Modal/VersionHistoryModal';
import { usePromptEditor } from '../hooks/usePromptEditor';

import './SubAgentEditor.css';

type PromptTab = 'systemPrompt' | 'userPrompt' | 'prefill';

const MODE_OPTIONS: Array<{ mode: SubAgentAllowedMode; labelKey: string }> = [
  { mode: 'storyObject', labelKey: 'settings.promptEditor.subAgentModes.storyObject' },
  { mode: 'novelEditor', labelKey: 'settings.promptEditor.subAgentModes.novelEditor' },
  { mode: 'outlineManager', labelKey: 'settings.promptEditor.subAgentModes.outlineManager' },
  { mode: 'subAgent', labelKey: 'settings.promptEditor.subAgentModes.subAgent' },
];

function normalizeStringOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function snapshotForChangeDetection(agent: SubAgentDefinition): string {
  return JSON.stringify({
    display_name: agent.display_name,
    description: agent.description ?? null,
    enabled: agent.enabled,
    allowed_agent_modes: [...agent.allowed_agent_modes].sort(),
    allowed_tool_names: [...agent.allowed_tool_names].sort(),
    llm_config: agent.llm_config,
  });
}

const SubAgentPromptEditors: React.FC<{ subAgentId: string }> = ({ subAgentId }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<PromptTab>('systemPrompt');
  const [showVersions, setShowVersions] = useState(false);

  const system = usePromptEditor('subAgent', 'systemPrompt', subAgentId);
  const user = usePromptEditor('subAgent', 'userPrompt', subAgentId);
  const prefill = usePromptEditor('subAgent', 'prefill', subAgentId);

  const current = activeTab === 'systemPrompt' ? system : activeTab === 'userPrompt' ? user : prefill;

  return (
    <section className="sub-agent-editor__section">
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
    return selectedId ? subAgents.find((s) => s.sub_agent_id === selectedId) : undefined;
  }, [selectedId, subAgents]);

  const allTools = useMemo(() => schemaRegistry.getAll().map((s) => s.name).sort(), []);

  const [editedDisplayName, setEditedDisplayName] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [editedEnabled, setEditedEnabled] = useState(true);
  const [editedModes, setEditedModes] = useState<SubAgentAllowedMode[]>([]);
  const [editedTools, setEditedTools] = useState<string[]>([]);
  const [toolFilter, setToolFilter] = useState('');
  const [editedConfig, setEditedConfig] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const originalSnapshotRef = useRef<string>('');

  useEffect(() => {
    if (!agent) {
      setEditedDisplayName('');
      setEditedDescription('');
      setEditedEnabled(true);
      setEditedModes([]);
      setEditedTools([]);
      setEditedConfig(null);
      originalSnapshotRef.current = '';
      setError('');
      return;
    }

    setEditedDisplayName(agent.display_name);
    setEditedDescription(agent.description ?? '');
    setEditedEnabled(agent.enabled);
    setEditedModes(agent.allowed_agent_modes);
    setEditedTools(agent.allowed_tool_names);
    setEditedConfig(agent.llm_config);
    originalSnapshotRef.current = snapshotForChangeDetection(agent);
    setError('');
    setToolFilter('');
  }, [agent?.sub_agent_id]);

  const currentSnapshot = useMemo(() => {
    if (!agent) return '';
    return JSON.stringify({
      display_name: editedDisplayName,
      description: normalizeStringOrNull(editedDescription),
      enabled: editedEnabled,
      allowed_agent_modes: [...editedModes].sort(),
      allowed_tool_names: [...editedTools].sort(),
      llm_config: editedConfig,
    });
  }, [agent, editedDisplayName, editedDescription, editedEnabled, editedModes, editedTools, editedConfig]);

  const hasChanges = Boolean(agent) && currentSnapshot !== originalSnapshotRef.current;

  const filteredTools = useMemo(() => {
    const q = toolFilter.trim().toLowerCase();
    if (!q) return allTools;
    return allTools.filter((name) => name.toLowerCase().includes(q));
  }, [allTools, toolFilter]);

  const toggleMode = (mode: SubAgentAllowedMode) => {
    setEditedModes((prev) => (prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]));
  };

  const toggleTool = (toolName: string) => {
    setEditedTools((prev) => (prev.includes(toolName) ? prev.filter((n) => n !== toolName) : [...prev, toolName]));
  };

  const handleSave = async () => {
    if (!agent) return;

    const name = editedDisplayName.trim();
    if (!name) {
      setError(t('settings.promptEditor.subAgentSave.nameRequired'));
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      const updated = await updateSubAgent(agent.sub_agent_id, {
        display_name: name,
        description: normalizeStringOrNull(editedDescription),
        enabled: editedEnabled,
        allowed_agent_modes: editedModes,
        allowed_tool_names: editedTools,
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
      await deleteSubAgent(agent.sub_agent_id);
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
          <h3 className="sub-agent-editor__title">{agent.display_name}</h3>
          <span className="sub-agent-editor__id">{agent.sub_agent_id}</span>
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
        <section className="sub-agent-editor__section">
          <h4 className="sub-agent-editor__section-title">{t('settings.promptEditor.subAgentSettings.title')}</h4>

          <div className="sub-agent-editor__field-row">
            <label className="sub-agent-editor__label">{t('settings.promptEditor.subAgentSettings.displayName')}</label>
            <input
              className="sub-agent-editor__input"
              value={editedDisplayName}
              onChange={(e) => setEditedDisplayName(e.target.value)}
            />
          </div>

          <div className="sub-agent-editor__field-row">
            <label className="sub-agent-editor__label">{t('settings.promptEditor.subAgentSettings.enabled')}</label>
            <input
              type="checkbox"
              checked={editedEnabled}
              onChange={(e) => setEditedEnabled(e.target.checked)}
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
              <label key={opt.mode} className="sub-agent-editor__chip">
                <input
                  type="checkbox"
                  checked={editedModes.includes(opt.mode)}
                  onChange={() => toggleMode(opt.mode)}
                />
                <span>{t(opt.labelKey)}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="sub-agent-editor__section">
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
              <label key={toolName} className="sub-agent-editor__tool-item">
                <input
                  type="checkbox"
                  checked={editedTools.includes(toolName)}
                  onChange={() => toggleTool(toolName)}
                />
                <span className="sub-agent-editor__tool-name">{toolName}</span>
              </label>
            ))}
          </div>
        </section>

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

        <SubAgentPromptEditors subAgentId={agent.sub_agent_id} />

        {error && <div className="sub-agent-editor__error">{error}</div>}
      </div>
    </div>
  );
};

export default SubAgentEditor;
