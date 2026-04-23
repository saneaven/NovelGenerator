import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import PromptTreeNav from './PromptTreeNav';
import FragmentTreeNav from './FragmentTreeNav';
import VariableListNav from './VariableListNav';
import VariableEditor from './VariableEditor';
import SubAgentListNav from './SubAgentListNav';
import SubAgentEditor from './SubAgentEditor';
import McpServerListNav from './McpServerListNav';
import McpServersEditor from './McpServersEditor';
import TemplateEditor from './TemplateEditor';
import ScenarioBlocksEditor from './ScenarioBlocksEditor';
import EditorPanelHeader from './EditorPanelHeader';
import HeaderOverflowMenu from './HeaderOverflowMenu';
import PromptPreviewModal from './PromptPreviewModal';
import VersionHistoryModal from '../../Modal/VersionHistoryModal';
import PresetSelector from '../PresetSelector';
import PresetModal from '../PresetModal';
import { usePresetStore } from '../../../store/presetStore';
import { scenarioService } from '../../../api/scenarioService';
import { fragmentService } from '../../../api/fragmentService';
import { PROMPT_TREE, getFirstPromptNode, findPromptNode, type PromptNode } from './promptTree';
import { TextButton } from '../../TextButton';
import { ChevronDown, Close, Copy, Document, Eye, Trash } from '../../icons';
import { DropdownMenu, DropdownItem } from '../../ui/DropdownMenu';
import { confirm, alert as showAlert } from '../../../store/dialogStore';
import './PromptsTemplatesPanel.css';
import TemplateSyntaxHint from './TemplateSyntaxHint';
import type { PresetListItem } from '../../../types/presets';
import { useSettingsToast } from '../SettingsToastContext';
import {
  getDraftFragmentFullPath,
  getFragmentDraftLabel,
  isFragmentDraftDirty,
  toFragmentReference,
} from './draftUtils';
import {
  makeScenarioDraftKey,
  type DirtyItem,
  type SaveSummary,
  type SubTab,
} from './draftTypes';
import { useScenarioDrafts } from '../hooks/useScenarioDrafts';
import { useFragmentDrafts } from '../hooks/useFragmentDrafts';
import { useVariableDrafts } from '../hooks/useVariableDrafts';
import { useSubAgentDrafts } from '../hooks/useSubAgentDrafts';
import { useMcpDrafts } from '../hooks/useMcpDrafts';

export interface PromptsTemplatesPanelHandle {
  hasUnsavedChanges: () => boolean;
  getUnsavedCount: () => number;
  getDirtyItems: () => DirtyItem[];
  saveAllDrafts: () => Promise<SaveSummary>;
  discardAllDrafts: () => void;
}

interface PromptsTemplatesPanelProps {
  onUnsavedCountChange?: (count: number) => void;
}

const PromptsTemplatesPanel = forwardRef<PromptsTemplatesPanelHandle, PromptsTemplatesPanelProps>(({ onUnsavedCountChange }, ref) => {
  const { t } = useTranslation();
  const toast = useSettingsToast();
  const activePresetId = usePresetStore((s) => s.activePresetId);
  const getPresetById = usePresetStore((s) => s.getPresetById);

  // --- Domain hooks ---
  const scenarios = useScenarioDrafts();
  const fragments = useFragmentDrafts();
  const variables = useVariableDrafts();
  const subAgents = useSubAgentDrafts();
  const mcp = useMcpDrafts();

  // --- Local UI state ---
  const [subTab, setSubTab] = useState<SubTab>('prompts');
  const [selectedPrompt, setSelectedPrompt] = useState<PromptNode | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const blocksHeaderActionsRef = useRef<HTMLDivElement>(null);

  // --- Modal state ---
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showSystemPreview, setShowSystemPreview] = useState(false);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [presetModalMode, setPresetModalMode] = useState<'create' | 'duplicate' | 'edit'>('create');
  const [presetModalSource, setPresetModalSource] = useState<PresetListItem | null>(null);

  // --- Derived values ---
  const selectedPromptKey = useMemo(() => {
    if (!selectedPrompt || selectedPrompt.type !== 'promptView') return null;
    if (!selectedPrompt.taskType || !selectedPrompt.taskSubtype) return null;
    return makeScenarioDraftKey(selectedPrompt.taskType, selectedPrompt.taskSubtype);
  }, [selectedPrompt]);

  const currentScenarioDraft = selectedPromptKey ? scenarios.scenarioDrafts[selectedPromptKey] : null;

  const savingRef = useRef(false);

  // --- Initialize first prompt on mount ---
  useEffect(() => {
    const firstPrompt = getFirstPromptNode();
    if (firstPrompt) setSelectedPrompt(firstPrompt);
  }, []);

  // --- Clear all drafts on preset switch ---
  useEffect(() => {
    scenarios.resetAll();
    fragments.resetAll();
    variables.resetAll();
    subAgents.resetAll();
    mcp.resetAll();
    setShowVersionHistory(false);
  }, [activePresetId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Load scenario draft when prompt selection changes ---
  useEffect(() => {
    if (!selectedPrompt || selectedPrompt.type !== 'promptView') return;
    if (!selectedPrompt.taskType || !selectedPrompt.taskSubtype) return;
    scenarios.ensureScenarioDraftLoaded(
      selectedPrompt.taskType,
      selectedPrompt.taskSubtype,
      selectedPrompt.label,
      selectedPrompt.id
    );
  }, [scenarios.ensureScenarioDraftLoaded, selectedPrompt?.id, selectedPrompt?.label, selectedPrompt?.taskSubtype, selectedPrompt?.taskType, selectedPrompt?.type]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Composed unsaved count ---
  const unsavedCount = useMemo(() => {
    return scenarios.dirtyCount + fragments.dirtyCount + variables.dirtyCount + subAgents.dirtyCount + mcp.dirtyCount;
  }, [scenarios.dirtyCount, fragments.dirtyCount, variables.dirtyCount, subAgents.dirtyCount, mcp.dirtyCount]);

  useLayoutEffect(() => {
    onUnsavedCountChange?.(unsavedCount);
  }, [onUnsavedCountChange, unsavedCount]);

  // --- Composed getDirtyItems ---
  const getDirtyItems = useCallback((): DirtyItem[] => {
    return [
      ...scenarios.getDirtyScenarios(),
      ...subAgents.getDirtySubAgents(),
      ...fragments.getDirtyFragments(),
      ...variables.getDirtyVariables(),
      ...mcp.getDirtyMcp(),
    ];
  }, [scenarios.getDirtyScenarios, subAgents.getDirtySubAgents, fragments.getDirtyFragments, variables.getDirtyVariables, mcp.getDirtyMcp]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Composed saveAllDrafts ---
  const saveAllDrafts = useCallback(async (): Promise<SaveSummary> => {
    if (savingRef.current) {
      return { attempted: 0, saved: 0, failed: 0, failures: [] };
    }
    savingRef.current = true;
    try {
      let attempted = 0;
      let saved = 0;
      const allFailures: SaveSummary['failures'] = [];

      // Order matters: scenarios first, then sub-agents (scenarios + definitions), then fragments, variables, mcp
      const scenarioResult = await scenarios.saveScenarios();
      attempted += scenarioResult.attempted;
      saved += scenarioResult.saved;
      allFailures.push(...scenarioResult.failures);

      const subAgentResult = await subAgents.saveSubAgents();
      attempted += subAgentResult.attempted;
      saved += subAgentResult.saved;
      allFailures.push(...subAgentResult.failures);

      const fragmentResult = await fragments.saveFragments();
      attempted += fragmentResult.attempted;
      saved += fragmentResult.saved;
      allFailures.push(...fragmentResult.failures);

      const variableResult = await variables.saveVariables();
      attempted += variableResult.attempted;
      saved += variableResult.saved;
      allFailures.push(...variableResult.failures);

      const mcpResult = await mcp.saveMcp(activePresetId);
      attempted += mcpResult.attempted;
      saved += mcpResult.saved;
      allFailures.push(...mcpResult.failures);

      return { attempted, saved, failed: attempted - saved, failures: allFailures };
    } finally {
      savingRef.current = false;
    }
  }, [activePresetId, scenarios.saveScenarios, subAgents.saveSubAgents, fragments.saveFragments, variables.saveVariables, mcp.saveMcp]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Composed discardAllDrafts ---
  const discardAllDrafts = useCallback(() => {
    scenarios.discardScenarios();
    subAgents.discardSubAgents();
    fragments.discardFragments();
    variables.discardVariables();
    mcp.discardMcp();
  }, [scenarios.discardScenarios, subAgents.discardSubAgents, fragments.discardFragments, variables.discardVariables, mcp.discardMcp]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Imperative handle ---
  useImperativeHandle(
    ref,
    () => ({
      hasUnsavedChanges: () => unsavedCount > 0,
      getUnsavedCount: () => unsavedCount,
      getDirtyItems,
      saveAllDrafts,
      discardAllDrafts,
    }),
    [discardAllDrafts, getDirtyItems, saveAllDrafts, unsavedCount]
  );

  // --- Preset handlers ---
  const confirmPresetSwitchIfDirty = useCallback(
    async (_nextPresetId: string) => {
      if (unsavedCount === 0) return true;

      const shouldSave = await confirm({
        title: 'Unsaved Changes',
        message: `You have unsaved changes (${unsavedCount}). Save before switching presets?`,
        variant: 'warning',
        confirmLabel: 'Save',
        cancelLabel: "Don't Save",
      });
      if (shouldSave) {
        const summary = await saveAllDrafts();
        if (summary.failed > 0) {
          const lines = summary.failures.map((f) => `- ${f.item.label}: ${f.error}`);
          await showAlert({
            title: 'Save Failed',
            message: `Some items failed to save:\n\n${lines.join('\n')}`,
            variant: 'warning',
          });
          return false;
        }
        return true;
      }

      const discard = await confirm({
        title: 'Discard Changes',
        message: 'Discard your unsaved changes and switch presets?',
        variant: 'danger',
        confirmLabel: 'Discard',
      });
      if (discard) {
        discardAllDrafts();
        return true;
      }

      return false;
    },
    [discardAllDrafts, saveAllDrafts, unsavedCount]
  );

  const handleCreatePreset = () => {
    setPresetModalMode('create');
    setPresetModalSource(null);
    setShowPresetModal(true);
  };

  const handleDuplicatePreset = (presetId: string) => {
    const preset = getPresetById(presetId);
    if (!preset) return;
    setPresetModalMode('duplicate');
    setPresetModalSource(preset);
    setShowPresetModal(true);
  };

  const handleEditPreset = (presetId: string) => {
    const preset = getPresetById(presetId);
    if (!preset) return;
    setPresetModalMode('edit');
    setPresetModalSource(preset);
    setShowPresetModal(true);
  };

  // --- Selection handlers ---
  const handlePromptSelect = (node: PromptNode) => {
    if (node.type !== 'promptView') return;
    setSelectedPrompt(node);
    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
  };

  const handleFragmentSelectWithCollapse = useCallback((folderId: string | null, fragmentName: string, fullPath: string) => {
    fragments.handleFragmentSelect(folderId, fragmentName, fullPath);
    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
  }, [fragments.handleFragmentSelect]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateFragmentWithCollapse = useCallback((folderPath: string | null) => {
    fragments.handleCreateFragment(folderPath);
    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
  }, [fragments.handleCreateFragment]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateVariableWithCollapse = useCallback(() => {
    variables.handleCreateVariable();
    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
  }, [variables.handleCreateVariable]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateSubAgentWithCollapse = useCallback(() => {
    subAgents.handleCreateSubAgent();
    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
  }, [subAgents.handleCreateSubAgent]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateMcpWithCollapse = useCallback(() => {
    mcp.handleCreateMcpServer();
    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
  }, [mcp.handleCreateMcpServer]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Copy fragment path ---
  const handleCopyFragmentPath = async () => {
    const fragmentPath = fragments.currentFragmentDraft?.fullPath;
    if (!fragmentPath) return;
    const pathToCopy = `{% include "${toFragmentReference(fragmentPath)}" %}`;
    try {
      await navigator.clipboard.writeText(pathToCopy);
      toast.success(t('common.copied', { value: pathToCopy }));
    } catch {
      toast.error(t('settings.promptEditor.toast.copyFailed'));
    }
  };

  // --- Editor title / description ---
  const getEditorTitle = () => {
    if (subTab === 'prompts' && selectedPrompt) {
      const parentId = selectedPrompt.id.replace(/-system$|-blocks$/, '');
      const parentNode = findPromptNode(parentId);
      const parentLabel = parentNode?.label || '';
      return `${parentLabel} — ${selectedPrompt.label}`;
    }
    if (subTab === 'prompts') return t('settings.promptEditor.prompts');
    if (subTab === 'fragments' && fragments.currentFragmentDraft?.isNew) return 'New Fragment';
    if (subTab === 'fragments') return t('settings.promptEditor.fragments');
    return '';
  };

  const getEditorDescription = () => {
    if (subTab === 'prompts' && selectedPrompt) {
      const parentId = selectedPrompt.id.replace(/-system$|-blocks$/, '');
      const parentNode = findPromptNode(parentId);
      return parentNode?.description || null;
    }
    return null;
  };

  const hasSelection =
    (subTab === 'prompts' && selectedPrompt) ||
    (subTab === 'fragments' && fragments.currentFragmentDraft) ||
    subTab === 'variables' ||
    subTab === 'subAgents' ||
    subTab === 'mcp';

  const showEditorHeader = subTab === 'prompts' || subTab === 'fragments';

  const currentEditorContentLength = subTab === 'prompts'
    ? (() => {
        if (!currentScenarioDraft) return 0;
        const scenario = currentScenarioDraft.scenario;
        let count = scenario.system_template?.length ?? 0;
        for (const b of scenario.blocks || []) {
          if (b.type === 'staticPrompt') count += b.staticPrompt?.template?.length ?? 0;
          if (b.type === 'rangeMapping') {
            count += b.rangeMapping?.user_template?.length ?? 0;
            count += b.rangeMapping?.assistant_template?.length ?? 0;
          }
        }
        return count;
      })()
    : fragments.currentFragmentDraft?.content.length;
  const currentEditorDirty = subTab === 'prompts' ? currentScenarioDraft?.dirty : fragments.currentFragmentDraft?.dirty;

  // --- Version history ---
  const currentVersionHistoryProps = useMemo(() => {
    if (subTab === 'prompts' && selectedPrompt && selectedPrompt.type === 'promptView' && selectedPrompt.taskType && selectedPrompt.taskSubtype) {
      const taskType = selectedPrompt.taskType;
      const taskSubtype = selectedPrompt.taskSubtype;
      const key = makeScenarioDraftKey(taskType, taskSubtype);
      return {
        title: 'Scenario Version History',
        loadVersions: () => scenarioService.getScenarioVersions(taskType, taskSubtype),
        restoreVersion: async (vn: number) => {
          await scenarioService.restoreScenarioVersion(taskType, taskSubtype, vn);
          await scenarios.restoreScenarioVersion(key, taskType, taskSubtype);
        },
        loadVersionContent: async (vn: number) => {
          const result = await scenarioService.getScenarioVersion(taskType, taskSubtype, vn);
          return JSON.stringify(result.scenario, null, 2);
        },
      };
    }

    if (subTab === 'fragments' && fragments.selectedFragment) {
      const folderId = fragments.selectedFragment.folderId;
      const fragmentName = fragments.selectedFragment.fragmentName;
      return {
        title: 'Fragment Version History',
        loadVersions: () => fragmentService.getVersionHistory(folderId, fragmentName),
        restoreVersion: async (vn: number) => {
          await fragments.restoreFragmentVersion(folderId, fragmentName, vn);
        },
      };
    }

    return null;
  }, [fragments.selectedFragment, fragments.restoreFragmentVersion, scenarios.restoreScenarioVersion, selectedPrompt, subTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRestoreComplete = () => {
    setShowVersionHistory(false);
  };

  // --- Editor header actions ---
  const editorHeaderMeta = (currentScenarioDraft || fragments.currentFragmentDraft) ? (
    <>
      <span>{t('settings.promptEditor.chars', { count: currentEditorContentLength || 0 })}</span>
      {currentEditorDirty && <span className="editor-wrapper__unsaved"> • {t('settings.promptEditor.unsavedChanges')}</span>}
    </>
  ) : undefined;

  const isBlocksPromptView = subTab === 'prompts' && selectedPrompt?.viewKind === 'blocks';
  const editorHeaderActionsList: React.ReactNode[] = [];
  const editorHeaderMenuItems: Array<{
    key: string;
    icon?: React.ReactNode;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    variant?: 'danger';
  }> = [];

  if (subTab === 'prompts' && selectedPrompt) {
    editorHeaderActionsList.push(
      <TemplateSyntaxHint key="syntax-hint" selectedNode={selectedPrompt} />
    );
  }

  if (!isBlocksPromptView && subTab === 'prompts' && selectedPrompt?.viewKind === 'system' && currentScenarioDraft) {
    editorHeaderMenuItems.push({
      key: 'system-preview',
      icon: <Eye size="sm" />,
      label: t('settings.promptEditor.preview.title'),
      onClick: () => setShowSystemPreview(true),
    });
  }

  if (subTab === 'fragments' && fragments.currentFragmentDraft?.fullPath) {
    editorHeaderMenuItems.push({
      key: 'copy-fragment-path',
      icon: <Copy size="sm" />,
      label: t('settings.promptEditor.copyPathForTemplates'),
      onClick: handleCopyFragmentPath,
    });
  }

  if (!isBlocksPromptView && currentVersionHistoryProps) {
    editorHeaderMenuItems.push({
      key: 'version-history',
      label: t('settings.promptEditor.versionHistory'),
      onClick: () => setShowVersionHistory(true),
      disabled: fragments.currentFragmentDraft?.isDeleting,
    });
  }

  if (isBlocksPromptView) {
    editorHeaderActionsList.push(
      <div key="blocks-actions" ref={blocksHeaderActionsRef} className="editor-wrapper__blocks-actions" />
    );
  }

  if (subTab === 'fragments' && fragments.currentFragmentDraft) {
    editorHeaderMenuItems.push({
      key: 'delete-fragment',
      icon: <Trash size="sm" />,
      label: fragments.currentFragmentDraft.isNew ? 'Discard' : t('settings.promptEditor.deleteFragment'),
      onClick: fragments.handleDeleteSelectedFragment,
      disabled: fragments.currentFragmentDraft.isDeleting,
      variant: 'danger' as const,
    });
  }

  if (editorHeaderMenuItems.length > 0) {
    editorHeaderActionsList.push(
      <HeaderOverflowMenu
        key="editor-overflow-menu"
        items={editorHeaderMenuItems}
      />
    );
  }

  const editorHeaderActions = editorHeaderActionsList.length > 0 ? <>{editorHeaderActionsList}</> : undefined;

  const toggleSidebar = () => setIsSidebarCollapsed(!isSidebarCollapsed);

  // --- Render ---
  return (
    <div className="prompts-templates-panel">
      <div className="prompts-layout__content">
        <div className={`panel-editor ${isSidebarCollapsed ? 'panel-editor--collapsed' : ''}`}>
          {!isSidebarCollapsed && <div className="panel-editor__backdrop" onClick={() => setIsSidebarCollapsed(true)} />}

          <main className="panel-editor__main">
            <div className="editor-wrapper">
              {showEditorHeader && (
                <EditorPanelHeader
                  title={
                    subTab === 'fragments' && fragments.currentFragmentDraft && !fragments.currentFragmentDraft.isNew
                      ? fragments.currentFragmentDraft.fragmentName
                      : getEditorTitle()
                  }
                  editableTitle={subTab === 'fragments' && !!fragments.currentFragmentDraft && !fragments.currentFragmentDraft.isNew}
                  titleStaticPrefix={
                    subTab === 'fragments' && fragments.currentFragmentDraft && !fragments.currentFragmentDraft.isNew && fragments.currentFragmentDraft.folderPath
                      ? `${fragments.currentFragmentDraft.folderPath}/`
                      : undefined
                  }
                  onTitleChange={fragments.currentFragmentDraft && !fragments.currentFragmentDraft.isNew ? fragments.handleFragmentNameChange : undefined}
                  titlePlaceholder={t('settings.promptEditor.createFragment.fragmentNamePlaceholder')}
                  editTitleLabel={t('settings.promptEditor.editFragmentName')}
                  subtitle={
                    subTab === 'fragments' && fragments.currentFragmentDraft
                      ? (fragments.currentFragmentDraft.isNew ? undefined : (fragments.currentFragmentDraft.description || ''))
                      : (subTab === 'prompts' && selectedPrompt ? (getEditorDescription() || undefined) : undefined)
                  }
                  editableSubtitle={subTab === 'fragments' && !!fragments.currentFragmentDraft && !fragments.currentFragmentDraft.isNew}
                  onSubtitleChange={fragments.currentFragmentDraft ? fragments.handleDescriptionChange : undefined}
                  subtitlePlaceholder={fragments.currentFragmentDraft && !fragments.currentFragmentDraft.isNew ? t('settings.promptEditor.addDescription') : undefined}
                  meta={editorHeaderMeta}
                  actions={editorHeaderActions}
                  isSidebarCollapsed={isSidebarCollapsed}
                  onToggleSidebar={toggleSidebar}
                />
              )}

              <div className="editor-wrapper__body">
                {subTab === 'prompts' && selectedPrompt && selectedPrompt.type === 'promptView' && currentScenarioDraft && (
                  <>
                    {selectedPrompt.viewKind === 'system' && (
                      <TemplateEditor
                        content={currentScenarioDraft.scenario.system_template || ''}
                        onContentChange={(text) => {
                          const taskType = selectedPrompt.taskType;
                          const taskSubtype = selectedPrompt.taskSubtype;
                          if (!taskType || !taskSubtype) return;
                          const draftKey = makeScenarioDraftKey(taskType, taskSubtype);
                          scenarios.updateScenarioDraft(draftKey, (cur) => {
                            const nextScenario = { ...cur.scenario, system_template: text };
                            const dirty = JSON.stringify(nextScenario) !== JSON.stringify(cur.originalScenario);
                            return { ...cur, scenario: nextScenario, dirty, saveWarnings: [] };
                          });
                        }}
                        validation={null}
                        isLoading={currentScenarioDraft.isLoading}
                        placeholder="Enter system prompt template..."
                      />
                    )}

                    {selectedPrompt.viewKind === 'blocks' && (
                      <div className="scenario-blocks-view">
                        <ScenarioBlocksEditor
                          taskType={selectedPrompt.taskType!}
                          taskSubtype={selectedPrompt.taskSubtype!}
                          systemTemplate={currentScenarioDraft.scenario.system_template || ''}
                          blocks={currentScenarioDraft.scenario.blocks || []}
                          headerActionsRef={blocksHeaderActionsRef}
                          onOpenVersionHistory={currentVersionHistoryProps ? () => setShowVersionHistory(true) : undefined}
                          onBlocksChange={(blocks) => {
                            const taskType = selectedPrompt.taskType;
                            const taskSubtype = selectedPrompt.taskSubtype;
                            if (!taskType || !taskSubtype) return;
                            const draftKey = makeScenarioDraftKey(taskType, taskSubtype);
                            scenarios.updateScenarioDraft(draftKey, (cur) => {
                              const nextScenario = { ...cur.scenario, blocks };
                              const dirty = JSON.stringify(nextScenario) !== JSON.stringify(cur.originalScenario);
                              return { ...cur, scenario: nextScenario, dirty, saveWarnings: [] };
                            });
                          }}
                        />
                      </div>
                    )}

                    {showSystemPreview && selectedPrompt.viewKind === 'system' && (
                      <PromptPreviewModal
                        isOpen={showSystemPreview}
                        onClose={() => setShowSystemPreview(false)}
                        templateContent={currentScenarioDraft.scenario.system_template || ''}
                        taskType={selectedPrompt.taskType!}
                        taskSubtype={selectedPrompt.taskSubtype!}
                        injectedInputKey={null}
                      />
                    )}
                  </>
                )}

                {subTab === 'fragments' && fragments.currentFragmentDraft && (
                  <div className="editor-wrapper__split">
                    {fragments.currentFragmentDraft.isNew && (
                      <div className="editor-wrapper__fragment-fields">
                        <div className="form-group">
                          <label className="form-label" htmlFor="fragment-folder-path">
                            {t('settings.promptEditor.createFragment.folderPath')}
                          </label>
                          <input
                            id="fragment-folder-path"
                            className="form-input"
                            type="text"
                            value={fragments.currentFragmentDraft.folderPath}
                            onChange={(event) => {
                              const folderPath = event.target.value;
                              fragments.updateCurrentFragmentDraft((draft) => {
                                const nextDraft = { ...draft, folderPath, dirty: true, loadError: undefined };
                                const fullPath = getDraftFragmentFullPath(nextDraft);
                                return { ...nextDraft, fullPath, label: getFragmentDraftLabel(nextDraft) };
                              });
                            }}
                            placeholder={t('settings.promptEditor.createFragment.folderPathPlaceholder')}
                          />
                          <small className="form-hint">{t('settings.promptEditor.createFragment.folderPathHint')}</small>
                        </div>

                        <div className="form-group">
                          <label className="form-label" htmlFor="fragment-name">
                            {t('settings.promptEditor.createFragment.fragmentName')}
                          </label>
                          <input
                            id="fragment-name"
                            className="form-input"
                            type="text"
                            value={fragments.currentFragmentDraft.fragmentName}
                            onChange={(event) => {
                              const fragmentName = event.target.value;
                              fragments.updateCurrentFragmentDraft((draft) => {
                                const nextDraft = { ...draft, fragmentName, dirty: true, loadError: undefined };
                                const fullPath = getDraftFragmentFullPath(nextDraft);
                                return { ...nextDraft, fullPath, label: getFragmentDraftLabel(nextDraft) };
                              });
                            }}
                            placeholder={t('settings.promptEditor.createFragment.fragmentNamePlaceholder')}
                          />
                        </div>

                        <div className="form-group">
                          <label className="form-label" htmlFor="fragment-description">
                            {t('settings.promptEditor.createFragment.description')}
                          </label>
                          <input
                            id="fragment-description"
                            className="form-input"
                            type="text"
                            value={fragments.currentFragmentDraft.description}
                            onChange={(event) => fragments.handleDescriptionChange(event.target.value)}
                            placeholder={t('settings.promptEditor.createFragment.descriptionPlaceholder')}
                          />
                        </div>
                      </div>
                    )}

                    {fragments.currentFragmentDraft.loadError && (
                      <div className="editor-wrapper__inline-error">{fragments.currentFragmentDraft.loadError}</div>
                    )}

                    <TemplateEditor
                      content={fragments.currentFragmentDraft.content || ''}
                      onContentChange={(text) => {
                        fragments.updateCurrentFragmentDraft((draft) => ({
                          ...draft,
                          content: text,
                          dirty: isFragmentDraftDirty({ ...draft, content: text }),
                          loadError: undefined,
                        }));
                      }}
                      validation={fragments.currentFragmentDraft.validation ?? null}
                      isLoading={fragments.currentFragmentDraft.isLoading}
                      placeholder={t('settings.promptEditor.enterFragmentTemplate')}
                    />
                  </div>
                )}

                {subTab === 'variables' && (
                  <VariableEditor
                    draft={variables.currentVariableDraft}
                    onDraftChange={variables.onDraftChange}
                    onDeleted={variables.onDeleted}
                    onDiscardNew={variables.onDiscardNew}
                    isSidebarCollapsed={isSidebarCollapsed}
                    onToggleSidebar={toggleSidebar}
                  />
                )}

                {subTab === 'subAgents' && (
                  <SubAgentEditor
                    key={subAgents.currentSubAgentDraft?.draftKey || subAgents.selectedSubAgentId || 'new-sub-agent'}
                    draft={subAgents.currentSubAgentDraft}
                    onDraftChange={subAgents.handleSubAgentDraftChange}
                    promptIdentityName={subAgents.subAgentIdentityName}
                    scenarioDraft={subAgents.currentSubAgentScenarioDraft}
                    onScenarioChange={subAgents.onScenarioChange}
                    onReloadScenario={subAgents.onReloadScenario}
                    onDeleted={subAgents.onDeleted}
                    onDiscardNew={subAgents.onDiscardNew}
                    isSidebarCollapsed={isSidebarCollapsed}
                    onToggleSidebar={toggleSidebar}
                  />
                )}

                {subTab === 'mcp' && (
                  <McpServersEditor
                    draft={mcp.currentMcpDraft}
                    snapshot={mcp.selectedMcpSnapshot}
                    storeError={mcp.mcpStoreError}
                    onDraftChange={mcp.onDraftChange}
                    onDeleted={mcp.onDeleted}
                    onDiscardNew={mcp.onDiscardNew}
                    isSidebarCollapsed={isSidebarCollapsed}
                    onToggleSidebar={toggleSidebar}
                  />
                )}

                {!hasSelection && (
                  <div className="empty-state">
                    <div className="empty-state__icon">
                      <Document size="4xl" />
                    </div>
                    <h3 className="empty-state__title">
                      {subTab === 'prompts'
                        ? t('settings.promptEditor.selectPromptToEdit')
                        : t('settings.promptEditor.selectFragmentToEdit')}
                    </h3>
                    <p className="empty-state__text">
                      {subTab === 'prompts'
                        ? t('settings.promptEditor.choosePromptHint')
                        : t('settings.promptEditor.chooseFragmentHint')}
                    </p>
                    {subTab === 'fragments' && (
                      <TextButton variant="primary" size="lg" onClick={() => handleCreateFragmentWithCollapse(null)}>
                        {t('settings.promptEditor.createNewFragment')}
                      </TextButton>
                    )}
                  </div>
                )}
              </div>
            </div>
          </main>

          <aside className="panel-editor__sidebar">
            <PresetSelector
              onCreatePreset={handleCreatePreset}
              onDuplicatePreset={handleDuplicatePreset}
              onEditPreset={handleEditPreset}
              beforeSelectPreset={confirmPresetSwitchIfDirty}
            />

            <nav className="tree-nav">
              <header className="tree-nav__header">
                <DropdownMenu
                  trigger={
                    <button className="tree-nav__tab-switcher" type="button">
                      <span>
                        {({
                          prompts: t('settings.promptEditor.prompts'),
                          fragments: t('settings.promptEditor.fragments'),
                          variables: t('settings.promptEditor.variables'),
                          subAgents: t('settings.promptEditor.subAgents'),
                          mcp: 'MCP',
                        } as Record<SubTab, string>)[subTab]}
                      </span>
                      <ChevronDown size="sm" />
                    </button>
                  }
                  align="left"
                >
                  <DropdownItem
                    label={t('settings.promptEditor.prompts')}
                    onClick={() => setSubTab('prompts')}
                    className={subTab === 'prompts' ? 'is-selected' : ''}
                  />
                  <DropdownItem
                    label={t('settings.promptEditor.fragments')}
                    onClick={() => setSubTab('fragments')}
                    className={subTab === 'fragments' ? 'is-selected' : ''}
                  />
                  <DropdownItem
                    label={t('settings.promptEditor.variables')}
                    onClick={() => setSubTab('variables')}
                    className={subTab === 'variables' ? 'is-selected' : ''}
                  />
                  <DropdownItem
                    label={t('settings.promptEditor.subAgents')}
                    onClick={() => setSubTab('subAgents')}
                    className={subTab === 'subAgents' ? 'is-selected' : ''}
                  />
                  <DropdownItem
                    label="MCP"
                    onClick={() => setSubTab('mcp')}
                    className={subTab === 'mcp' ? 'is-selected' : ''}
                  />
                </DropdownMenu>
                <button
                  className="tree-nav__close-btn"
                  onClick={() => setIsSidebarCollapsed(true)}
                  aria-label={t('settings.promptEditor.treeNav.closeSidebar')}
                >
                  <Close size="sm" />
                </button>
              </header>

              {subTab === 'prompts' && (
                <PromptTreeNav
                  tree={PROMPT_TREE}
                  selectedNodeId={selectedPrompt?.id || null}
                  onNodeSelect={handlePromptSelect}
                />
              )}
              {subTab === 'fragments' && (
                <FragmentTreeNav
                  selectedPath={fragments.selectedPath}
                  onFragmentSelect={handleFragmentSelectWithCollapse}
                  onCreateFragment={handleCreateFragmentWithCollapse}
                  onFolderDeleted={fragments.handleFolderDeleted}
                  draftLabel={fragments.newFragmentDraft ? getFragmentDraftLabel(fragments.newFragmentDraft) : null}
                  isDraftSelected={!!fragments.newFragmentDraft && !fragments.selectedFragment}
                  onSelectDraft={() => {
                    fragments.setSelectedFragment(null);
                    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
                  }}
                  refreshTrigger={fragments.refreshTrigger}
                />
              )}
              {subTab === 'variables' && (
                <VariableListNav
                  selectedId={variables.selectedVariableId}
                  onVariableSelect={(id) => {
                    variables.setSelectedVariableId(id);
                    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
                  }}
                  onCreateVariable={handleCreateVariableWithCollapse}
                  newDraftLabel={variables.newVariableDraft ? (variables.newVariableDraft.current.name || 'New Variable') : null}
                  isNewDraftSelected={!!variables.newVariableDraft && !variables.selectedVariableId}
                  onSelectNewDraft={() => {
                    variables.setSelectedVariableId(null);
                    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
                  }}
                />
              )}
              {subTab === 'subAgents' && (
                <SubAgentListNav
                  selectedId={subAgents.selectedSubAgentId}
                  onSelect={(id) => {
                    subAgents.setSelectedSubAgentId(id);
                    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
                  }}
                  onCreate={handleCreateSubAgentWithCollapse}
                  newDraftLabel={subAgents.newSubAgentDraft ? (subAgents.newSubAgentDraft.current.display_name || 'New Sub Agent') : null}
                  isNewDraftSelected={!!subAgents.newSubAgentDraft && !subAgents.selectedSubAgentId}
                  onSelectNewDraft={() => {
                    subAgents.setSelectedSubAgentId(null);
                    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
                  }}
                />
              )}
              {subTab === 'mcp' && (
                <McpServerListNav
                  selectedId={mcp.selectedMcpServerId}
                  onSelect={(id) => {
                    mcp.setSelectedMcpServerId(id);
                    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
                  }}
                  onCreate={handleCreateMcpWithCollapse}
                  newDraftLabel={mcp.newMcpDraft ? (mcp.newMcpDraft.current.display_name || mcp.newMcpDraft.current.server_key || 'New MCP Server') : null}
                  isNewDraftSelected={!!mcp.newMcpDraft && !mcp.selectedMcpServerId}
                  onSelectNewDraft={() => {
                    mcp.setSelectedMcpServerId(null);
                    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
                  }}
                />
              )}
            </nav>
          </aside>
        </div>
      </div>

      {showVersionHistory && currentVersionHistoryProps && (
        <VersionHistoryModal
          isOpen={showVersionHistory}
          onClose={() => setShowVersionHistory(false)}
          onRestoreVersion={handleRestoreComplete}
          textVersionProps={currentVersionHistoryProps}
        />
      )}

      <PresetModal
        isOpen={showPresetModal}
        onClose={() => setShowPresetModal(false)}
        mode={presetModalMode}
        sourcePreset={presetModalSource}
        beforeSwitchPreset={confirmPresetSwitchIfDirty}
      />
    </div>
  );
});

PromptsTemplatesPanel.displayName = 'PromptsTemplatesPanel';

export default PromptsTemplatesPanel;
