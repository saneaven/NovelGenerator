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
import VariableEditor, { type VariableDefinitionDraft } from './VariableEditor';
import CreateVariableModal from './CreateVariableModal';
import SubAgentListNav from './SubAgentListNav';
import SubAgentEditor, { type SubAgentDefinitionDraft } from './SubAgentEditor';
import CreateSubAgentModal from './CreateSubAgentModal';
import TemplateEditor from './TemplateEditor';
import ScenarioBlocksEditor from './ScenarioBlocksEditor';
import PromptPreviewModal from './PromptPreviewModal';
import VersionHistoryModal from '../../Modal/VersionHistoryModal';
import PresetSelector from '../PresetSelector';
import PresetModal from '../PresetModal';
import { BaseModal } from '../../BaseModal';
import { usePresetStore } from '../../../store/presetStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useSubAgentStore } from '../../../store/subAgentStore';
import { useVariableStore } from '../../../store/variableStore';
import { scenarioService } from '../../../api/scenarioService';
import { fragmentService } from '../../../api/fragmentService';
import { PROMPT_TREE, getFirstPromptNode, findPromptNode, type PromptNode } from './promptTree';
import { IconButton } from '../../IconButton';
import { TextButton } from '../../TextButton';
import { ChevronLeft, ChevronRight, Document, Copy, Clock, Trash, Edit, Eye } from '../../icons';
import { confirm, alert as showAlert } from '../../../store/dialogStore';
import './PromptsTemplatesPanel.css';
import TemplateSyntaxHint from './TemplateSyntaxHint';
import type { PresetListItem } from '../../../types/presets';
import type { ScenarioDocument, TaskType } from '../../../types/scenarios';
import { extractFragmentReferences, validateTemplate } from '../../../templateEngine/engine';
import { useSettingsToast } from '../SettingsToastContext';
import {
  makeFragmentDraftKey,
  makeScenarioDraftKey,
  makeSubAgentDraftKey,
  makeVariableDraftKey,
  type DirtyItem,
  type SaveFailure,
  type SaveSummary,
} from './draftTypes';

type SubTab = 'prompts' | 'fragments' | 'variables' | 'subAgents';

interface SelectedFragment {
  folderId: string | null;
  fragmentName: string;
  fullPath: string;
}

interface TemplateValidationResult {
  valid: boolean;
  errors: Array<{ message: string; line?: number; column?: number; severity: string }>;
  warnings: Array<{ message: string; line?: number; column?: number; severity: string }>;
}

type ScenarioDraft = {
  key: string;
  label: string;
  nodeId?: string;
  taskType: TaskType;
  taskSubtype: string;
  isLoading: boolean;
  loadError?: string;
  originalScenario: ScenarioDocument;
  scenario: ScenarioDocument;
  dirty: boolean;
  saveWarnings: string[];
};

type FragmentDraft = {
  key: string;
  label: string;
  folderId: string | null;
  fragmentName: string;
  fullPath: string;
  isLoading: boolean;
  loadError?: string;
  originalContent: string;
  originalDescription: string;
  content: string;
  description: string;
  dirty: boolean;
  validation: TemplateValidationResult | null;
  isDeleting: boolean;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

function toFragmentReference(path: string): string {
  const trimmed = path.trim();
  if (trimmed.startsWith('fragment:')) {
    return trimmed;
  }
  return `fragment:${trimmed.replace(/^\/+|\/+$/g, '')}`;
}

function detectCircularFragmentReferences(startPath: string, contentByPath: Map<string, string>): string[] | null {
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  const dfs = (current: string): string[] | null => {
    if (stack.has(current)) {
      return [...path, current];
    }
    if (visited.has(current)) return null;

    visited.add(current);
    stack.add(current);
    path.push(current);

    const content = contentByPath.get(current);
    if (content) {
      const refs = extractFragmentReferences(content);
      for (const ref of refs) {
        const cycle = dfs(ref);
        if (cycle) return cycle;
      }
    }

    stack.delete(current);
    path.pop();
    return null;
  };

  return dfs(startPath);
}

async function validateFragmentContent(
  content: string,
  fullPath: string,
  fragmentDrafts: Record<string, FragmentDraft>,
  allFragmentContents: Map<string, string>,
): Promise<TemplateValidationResult> {
  const syntaxResult = await validateTemplate(content);
  if (!syntaxResult.isValid) {
    return {
      valid: false,
      errors: [
        {
          message: syntaxResult.error || 'Unknown syntax error',
          severity: 'error',
        },
      ],
      warnings: [],
    };
  }

  const contentByPath = new Map<string, string>();
  for (const [path, value] of allFragmentContents.entries()) {
    contentByPath.set(toFragmentReference(path), value);
  }
  for (const d of Object.values(fragmentDrafts)) {
    contentByPath.set(toFragmentReference(d.fullPath), d.content);
  }

  const refs = extractFragmentReferences(content);
  const warnings: TemplateValidationResult['warnings'] = [];
  const errors: TemplateValidationResult['errors'] = [];
  const currentRef = toFragmentReference(fullPath);

  for (const ref of refs) {
    if (!contentByPath.has(ref)) {
      warnings.push({ message: `Referenced fragment not found: "${ref}"`, severity: 'warning' });
    }
  }

  if (refs.includes(currentRef)) {
    errors.push({ message: `Self-reference detected: fragment "${currentRef}" references itself`, severity: 'error' });
  }

  const cycle = detectCircularFragmentReferences(currentRef, contentByPath);
  if (cycle) {
    errors.push({ message: `Circular reference detected: ${cycle.join(' -> ')}`, severity: 'error' });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

interface CreateFragmentModalProps {
  isOpen: boolean;
  folderPath: string | null;
  onClose: () => void;
  onCreate: (folderId: string | null, fragmentName: string, fullPath: string) => void;
}

const CreateFragmentModal: React.FC<CreateFragmentModalProps> = ({ isOpen, folderPath, onClose, onCreate }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [newFolderPath, setNewFolderPath] = useState(folderPath || '');
  const [content, setContent] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) {
      setError(t('settings.promptEditor.createFragment.nameRequired'));
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      setError(t('settings.promptEditor.createFragment.invalidName'));
      return;
    }

    setIsCreating(true);
    setError('');

    try {
      const finalFolderPath = newFolderPath.trim() || null;
      const result = await fragmentService.createFragment(
        { folderPath: finalFolderPath },
        name.trim(),
        content || `{# ${name} fragment #}`,
        description || undefined,
        'Initial creation'
      );
      const fullPath = result.folder_path ? `${result.folder_path}/${name.trim()}` : name.trim();
      onCreate(result.folder_id, name.trim(), fullPath);
      onClose();
    } catch (err: any) {
      if (err.message?.includes('409') || err.message?.includes('already exists')) {
        setError(t('settings.promptEditor.createFragment.duplicateName'));
      } else {
        setError(t('settings.promptEditor.createFragment.createFailed'));
      }
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={t('settings.promptEditor.createFragment.title')}
      size="small"
      zIndexLayer={1}
      footer={
        <>
          <TextButton variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </TextButton>
          <TextButton variant="primary" onClick={handleCreate} disabled={isCreating || !name.trim()} loading={isCreating}>
            {t('settings.promptEditor.createNewFragment')}
          </TextButton>
        </>
      }
    >
      <div className="form-group">
        <label className="form-label" htmlFor="fragment-folder">
          {t('settings.promptEditor.createFragment.folderPath')}
        </label>
        <input
          id="fragment-folder"
          className="form-input"
          type="text"
          value={newFolderPath}
          onChange={(e) => setNewFolderPath(e.target.value)}
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
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.promptEditor.createFragment.fragmentNamePlaceholder')}
          autoFocus
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="fragment-desc">
          {t('settings.promptEditor.createFragment.description')}
        </label>
        <input
          id="fragment-desc"
          className="form-input"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('settings.promptEditor.createFragment.descriptionPlaceholder')}
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="fragment-content">
          {t('settings.promptEditor.createFragment.initialContent')}
        </label>
        <textarea
          id="fragment-content"
          className="form-textarea"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t('settings.promptEditor.createFragment.initialContentPlaceholder')}
          rows={4}
        />
      </div>

      {error && <div className="form-error">{error}</div>}
    </BaseModal>
  );
};

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
  const loadScenario = useSettingsStore((s) => s.loadScenario);
  const invalidateScenarioCache = useSettingsStore((s) => s.invalidateScenarioCache);
  const activePresetId = usePresetStore((s) => s.activePresetId);
  const { getPresetById } = usePresetStore();
  const variables = useVariableStore((s) => s.variables);
  const loadVariables = useVariableStore((s) => s.loadVariables);
  const updateVariableDefinition = useVariableStore((s) => s.updateDefinition);
  const subAgents = useSubAgentStore((s) => s.subAgents);
  const loadSubAgents = useSubAgentStore((s) => s.loadSubAgents);
  const updateSubAgent = useSubAgentStore((s) => s.updateSubAgent);

  const [subTab, setSubTab] = useState<SubTab>('prompts');
  const [selectedPrompt, setSelectedPrompt] = useState<PromptNode | null>(null);
  const [selectedFragment, setSelectedFragment] = useState<SelectedFragment | null>(null);
  const [selectedVariableId, setSelectedVariableId] = useState<string | null>(null);
  const [selectedSubAgentId, setSelectedSubAgentId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCreateVariableModal, setShowCreateVariableModal] = useState(false);
  const [showCreateSubAgentModal, setShowCreateSubAgentModal] = useState(false);
  const [createFolderPath, setCreateFolderPath] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [allFragmentContents, setAllFragmentContents] = useState<Map<string, string>>(new Map());
  const allFragmentContentsRef = useRef(allFragmentContents);
  useEffect(() => { allFragmentContentsRef.current = allFragmentContents; }, [allFragmentContents]);
  const blocksHeaderActionsRef = useRef<HTMLDivElement>(null);

  const loadFragmentContents = useCallback(async () => {
    try {
      const fragments = await fragmentService.getAllFragmentsWithContent();
      const map = new Map<string, string>();
      for (const f of fragments) {
        const path = f.folder_path ? `${f.folder_path}/${f.fragment_name}` : f.fragment_name;
        map.set(path, f.content);
      }
      setAllFragmentContents(map);
    } catch { /* ignore */ }
  }, []);

  const [scenarioDrafts, setScenarioDrafts] = useState<Record<string, ScenarioDraft>>({});
  const [fragmentDrafts, setFragmentDrafts] = useState<Record<string, FragmentDraft>>({});
  const [variableDrafts, setVariableDrafts] = useState<Record<string, VariableDefinitionDraft>>({});
  const [subAgentDrafts, setSubAgentDrafts] = useState<Record<string, SubAgentDefinitionDraft>>({});
  const scenarioDraftsRef = useRef(scenarioDrafts);
  const fragmentDraftsRef = useRef(fragmentDrafts);
  const variableDraftsRef = useRef(variableDrafts);
  const subAgentDraftsRef = useRef(subAgentDrafts);
  const variablesRef = useRef(variables);
  const subAgentsRef = useRef(subAgents);
  useEffect(() => {
    scenarioDraftsRef.current = scenarioDrafts;
  }, [scenarioDrafts]);
  useEffect(() => {
    fragmentDraftsRef.current = fragmentDrafts;
  }, [fragmentDrafts]);
  useEffect(() => {
    variableDraftsRef.current = variableDrafts;
  }, [variableDrafts]);
  useEffect(() => {
    subAgentDraftsRef.current = subAgentDrafts;
  }, [subAgentDrafts]);
  useEffect(() => {
    variablesRef.current = variables;
  }, [variables]);
  useEffect(() => {
    subAgentsRef.current = subAgents;
  }, [subAgents]);

  const savingRef = useRef(false);

  // Version history modal
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  // Inline description editing (fragments)
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedDescription, setEditedDescription] = useState('');

  // System prompt preview modal
  const [showSystemPreview, setShowSystemPreview] = useState(false);

  // Preset modal state
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [presetModalMode, setPresetModalMode] = useState<'create' | 'duplicate' | 'edit'>('create');
  const [presetModalSource, setPresetModalSource] = useState<PresetListItem | null>(null);

  // Initialize first prompt on mount
  useEffect(() => {
    const firstPrompt = getFirstPromptNode();
    if (firstPrompt) setSelectedPrompt(firstPrompt);
  }, []);

  // Clear drafts on preset switch, and refresh fragment tree + contents.
  useEffect(() => {
    setScenarioDrafts({});
    setFragmentDrafts({});
    setVariableDrafts({});
    setSubAgentDrafts({});
    setSelectedFragment(null);
    setSelectedVariableId(null);
    setSelectedSubAgentId(null);
    setIsEditingDescription(false);
    setShowVersionHistory(false);
    setRefreshTrigger((prev) => prev + 1);
    loadFragmentContents().catch(() => undefined);
    loadVariables().catch(() => undefined);
    loadSubAgents().catch(() => undefined);
  }, [activePresetId, loadFragmentContents, loadSubAgents, loadVariables]);

  const selectedPath = useMemo(() => {
    if (!selectedFragment) return null;
    return selectedFragment.fullPath;
  }, [selectedFragment]);

  const selectedPromptKey = useMemo(() => {
    if (!selectedPrompt || selectedPrompt.type !== 'promptView') return null;
    if (!selectedPrompt.taskType || !selectedPrompt.taskSubtype) return null;
    return makeScenarioDraftKey(selectedPrompt.taskType, selectedPrompt.taskSubtype);
  }, [selectedPrompt]);

  const selectedFragmentKey = useMemo(() => {
    if (!selectedFragment) return null;
    return makeFragmentDraftKey(selectedFragment.folderId, selectedFragment.fragmentName);
  }, [selectedFragment]);

  const selectedVariableKey = useMemo(() => {
    if (!selectedVariableId) return null;
    return makeVariableDraftKey(selectedVariableId);
  }, [selectedVariableId]);

  const selectedSubAgentKey = useMemo(() => {
    if (!selectedSubAgentId) return null;
    return makeSubAgentDraftKey(selectedSubAgentId);
  }, [selectedSubAgentId]);

  const currentScenarioDraft = selectedPromptKey ? scenarioDrafts[selectedPromptKey] : null;
  const currentFragmentDraft = selectedFragmentKey ? fragmentDrafts[selectedFragmentKey] : null;
  const currentVariableDraft = selectedVariableKey ? variableDrafts[selectedVariableKey] : null;
  const currentSubAgentDraft = selectedSubAgentKey ? subAgentDrafts[selectedSubAgentKey] : null;

  const selectedSubAgent = useMemo(() => {
    if (!selectedSubAgentId) return null;
    return subAgents.find((s) => s.id === selectedSubAgentId) || null;
  }, [selectedSubAgentId, subAgents]);

  const subAgentIdentityName = useMemo(() => {
    return currentSubAgentDraft?.original.agent_name || selectedSubAgent?.agent_name || null;
  }, [currentSubAgentDraft, selectedSubAgent]);

  const handleSubAgentDraftChange = useCallback((draft: SubAgentDefinitionDraft) => {
    setSubAgentDrafts((prev) => ({
      ...prev,
      [makeSubAgentDraftKey(draft.subAgentId)]: draft,
    }));
  }, []);

  const unsavedCount = useMemo(() => {
    const promptCount = Object.values(scenarioDrafts).filter((d) => d.dirty).length;
    const fragmentCount = Object.values(fragmentDrafts).filter((d) => d.dirty).length;
    const variableCount = Object.values(variableDrafts).filter((d) => d.dirty).length;
    const subAgentCount = Object.values(subAgentDrafts).filter((d) => d.dirty).length;
    return promptCount + fragmentCount + variableCount + subAgentCount;
  }, [scenarioDrafts, fragmentDrafts, subAgentDrafts, variableDrafts]);

  useLayoutEffect(() => {
    onUnsavedCountChange?.(unsavedCount);
  }, [onUnsavedCountChange, unsavedCount]);

  const getDirtyItems = useCallback((): DirtyItem[] => {
    const dirty: DirtyItem[] = [];
    for (const d of Object.values(scenarioDraftsRef.current)) {
      if (!d.dirty) continue;
      dirty.push({
        kind: 'scenario',
        key: d.key,
        label: d.label,
        taskType: d.taskType,
        taskSubtype: d.taskSubtype,
        nodeId: d.nodeId,
      });
    }
    for (const d of Object.values(fragmentDraftsRef.current)) {
      if (!d.dirty) continue;
      dirty.push({
        kind: 'fragment',
        key: d.key,
        label: d.label,
        folderId: d.folderId,
        fragmentName: d.fragmentName,
        fullPath: d.fullPath,
      });
    }
    for (const d of Object.values(variableDraftsRef.current)) {
      if (!d.dirty) continue;
      dirty.push({
        kind: 'variable',
        key: makeVariableDraftKey(d.variableId),
        label: d.current.name || d.original.name || d.variableId,
        variableId: d.variableId,
      });
    }
    for (const d of Object.values(subAgentDraftsRef.current)) {
      if (!d.dirty) continue;
      dirty.push({
        kind: 'subAgent',
        key: makeSubAgentDraftKey(d.subAgentId),
        label: d.current.display_name || d.original.display_name || d.subAgentId,
        subAgentId: d.subAgentId,
      });
    }
    return dirty;
  }, []);

  const discardAllDrafts = useCallback(() => {
    setScenarioDrafts((prev) => {
      const next: Record<string, ScenarioDraft> = { ...prev };
      for (const [k, d] of Object.entries(next)) {
        if (!d.dirty) continue;
        next[k] = { ...d, scenario: d.originalScenario, dirty: false, saveWarnings: [] };
      }
      return next;
    });
    setFragmentDrafts((prev) => {
      const next: Record<string, FragmentDraft> = { ...prev };
      for (const [k, d] of Object.entries(next)) {
        if (!d.dirty) continue;
        next[k] = { ...d, content: d.originalContent, description: d.originalDescription, dirty: false };
      }
      return next;
    });
    setVariableDrafts((prev) => {
      const next: Record<string, VariableDefinitionDraft> = { ...prev };
      for (const [k, d] of Object.entries(next)) {
        if (!d.dirty) continue;
        next[k] = {
          ...d,
          current: {
            ...d.original,
            select_options: [...d.original.select_options],
            number_options: { ...d.original.number_options },
          },
          dirty: false,
          error: '',
        };
      }
      return next;
    });
    setSubAgentDrafts((prev) => {
      const next: Record<string, SubAgentDefinitionDraft> = { ...prev };
      for (const [k, d] of Object.entries(next)) {
        if (!d.dirty) continue;
        next[k] = {
          ...d,
          current: {
            ...d.original,
            allowed_invocation_modes: [...d.original.allowed_invocation_modes],
            allowed_tool_names: [...d.original.allowed_tool_names],
            allowed_sub_agent_ids: [...d.original.allowed_sub_agent_ids],
          },
          dirty: false,
          error: '',
        };
      }
      return next;
    });
    setIsEditingDescription(false);
    setEditedDescription('');
  }, []);

  const saveAllDrafts = useCallback(async (): Promise<SaveSummary> => {
    if (savingRef.current) {
      return { attempted: 0, saved: 0, failed: 0, failures: [] };
    }
    savingRef.current = true;
    try {
      const failures: SaveFailure[] = [];
      let attempted = 0;
      let saved = 0;

      // Save scenarios first so sub-agent renames don't invalidate scenario keys mid-save.
      const dirtyScenarios = Object.values(scenarioDraftsRef.current).filter((d) => d.dirty);
      for (const d of dirtyScenarios) {
        attempted += 1;
        try {
          const result = await scenarioService.saveScenario(d.taskType, d.taskSubtype, d.scenario);
          invalidateScenarioCache(d.taskType, d.taskSubtype);
          saved += 1;
          setScenarioDrafts((prev) => {
            const cur = prev[d.key];
            if (!cur) return prev;
            return {
              ...prev,
              [d.key]: {
                ...cur,
                originalScenario: result.scenario,
                scenario: result.scenario,
                dirty: false,
                saveWarnings: result.warnings || [],
              },
            };
          });
        } catch (error) {
          failures.push({
            item: {
              kind: 'scenario',
              key: d.key,
              label: d.label,
              taskType: d.taskType,
              taskSubtype: d.taskSubtype,
              nodeId: d.nodeId,
            },
            error: toErrorMessage(error),
          });
        }
      }

      const dirtySubAgents = Object.values(subAgentDraftsRef.current).filter((d) => d.dirty);
      for (const d of dirtySubAgents) {
        attempted += 1;

        if (d.error) {
          failures.push({
            item: {
              kind: 'subAgent',
              key: makeSubAgentDraftKey(d.subAgentId),
              label: d.current.display_name || d.original.display_name || d.subAgentId,
              subAgentId: d.subAgentId,
            },
            error: d.error,
          });
          continue;
        }

        let agent_name = d.current.agent_name.trim();
        if (agent_name.startsWith('call_')) {
          agent_name = agent_name.slice('call_'.length);
        }

        try {
          const updated = await updateSubAgent(d.subAgentId, {
            agent_name,
            display_name: d.current.display_name.trim(),
            description: d.current.description.trim(),
            enabled: d.current.enabled,
            allowed_invocation_modes: d.current.allowed_invocation_modes,
            allowed_tool_names: d.current.allowed_tool_names.filter((n) => !n.startsWith('call_')),
            allowed_sub_agent_ids: d.current.allowed_sub_agent_ids,
            use_custom_llm_config: d.current.use_custom_llm_config,
            llm_config_override: d.current.llm_config_override,
          });

          saved += 1;
          setSubAgentDrafts((prev) => {
            const key = makeSubAgentDraftKey(d.subAgentId);
            const cur = prev[key];
            if (!cur) return prev;

            const base = {
              agent_name: updated.agent_name,
              display_name: updated.display_name,
              description: updated.description,
              enabled: updated.enabled,
              allowed_invocation_modes: [...updated.allowed_invocation_modes],
              allowed_tool_names: [...updated.allowed_tool_names],
              allowed_sub_agent_ids: [...updated.allowed_sub_agent_ids],
              use_custom_llm_config: updated.use_custom_llm_config,
              llm_config_override: updated.llm_config_override,
            };

            return {
              ...prev,
              [key]: {
                ...cur,
                original: base,
                current: {
                  ...base,
                  allowed_invocation_modes: [...base.allowed_invocation_modes],
                  allowed_tool_names: [...base.allowed_tool_names],
                  allowed_sub_agent_ids: [...base.allowed_sub_agent_ids],
                },
                dirty: false,
                error: '',
              },
            };
          });
        } catch (error) {
          failures.push({
            item: {
              kind: 'subAgent',
              key: makeSubAgentDraftKey(d.subAgentId),
              label: d.current.display_name || d.original.display_name || d.subAgentId,
              subAgentId: d.subAgentId,
            },
            error: toErrorMessage(error),
          });
        }
      }

      const dirtyFragments = Object.values(fragmentDraftsRef.current).filter((d) => d.dirty);
      let didSaveAnyFragment = false;
      for (const d of dirtyFragments) {
        attempted += 1;
        const validation = await validateFragmentContent(d.content, d.fullPath, fragmentDraftsRef.current, allFragmentContentsRef.current);
        if (!validation.valid) {
          failures.push({
            item: {
              kind: 'fragment',
              key: d.key,
              label: d.label,
              folderId: d.folderId,
              fragmentName: d.fragmentName,
              fullPath: d.fullPath,
            },
            error: validation.errors[0]?.message || t('settings.promptEditor.toast.templateSyntaxError'),
          });
          setFragmentDrafts((prev) => {
            const cur = prev[d.key];
            if (!cur) return prev;
            return { ...prev, [d.key]: { ...cur, validation } };
          });
          continue;
        }

        try {
          await fragmentService.saveFragment(d.folderId, d.fragmentName, d.content, d.description || undefined, undefined);
          didSaveAnyFragment = true;
          saved += 1;
          setFragmentDrafts((prev) => {
            const cur = prev[d.key];
            if (!cur) return prev;
            return {
              ...prev,
              [d.key]: {
                ...cur,
                originalContent: cur.content,
                originalDescription: cur.description,
                dirty: false,
                validation,
              },
            };
          });
        } catch (error) {
          failures.push({
            item: {
              kind: 'fragment',
              key: d.key,
              label: d.label,
              folderId: d.folderId,
              fragmentName: d.fragmentName,
              fullPath: d.fullPath,
            },
            error: toErrorMessage(error),
          });
        }
      }

      if (didSaveAnyFragment) {
        await loadFragmentContents();
      }

      const dirtyVariables = Object.values(variableDraftsRef.current).filter((d) => d.dirty);
      for (const d of dirtyVariables) {
        attempted += 1;

        const name = d.current.name.trim();
        if (!name) {
          failures.push({
            item: {
              kind: 'variable',
              key: makeVariableDraftKey(d.variableId),
              label: d.current.name || d.original.name || d.variableId,
              variableId: d.variableId,
            },
            error: 'Name is required',
          });
          continue;
        }

        if (d.error) {
          failures.push({
            item: {
              kind: 'variable',
              key: makeVariableDraftKey(d.variableId),
              label: d.current.name || d.original.name || d.variableId,
              variableId: d.variableId,
            },
            error: d.error,
          });
          continue;
        }

        const description = d.current.description.trim();
        const select_options = d.varType === 'select' ? d.current.select_options : undefined;
        const number_options =
          d.varType === 'number'
            ? {
                min: d.current.number_options.min.trim() ? parseFloat(d.current.number_options.min) : undefined,
                max: d.current.number_options.max.trim() ? parseFloat(d.current.number_options.max) : undefined,
                step: d.current.number_options.step.trim() ? parseFloat(d.current.number_options.step) : undefined,
                input_type: d.current.number_options.input_type,
              }
            : undefined;

        try {
          await updateVariableDefinition(d.variableId, {
            name,
            description,
            select_options,
            number_options,
          });
          saved += 1;
          setVariableDrafts((prev) => {
            const key = makeVariableDraftKey(d.variableId);
            const cur = prev[key];
            if (!cur) return prev;
            return {
              ...prev,
              [key]: {
                ...cur,
                original: {
                  ...cur.current,
                  select_options: [...cur.current.select_options],
                  number_options: { ...cur.current.number_options },
                },
                dirty: false,
                error: '',
              },
            };
          });
        } catch (error) {
          failures.push({
            item: {
              kind: 'variable',
              key: makeVariableDraftKey(d.variableId),
              label: d.current.name || d.original.name || d.variableId,
              variableId: d.variableId,
            },
            error: toErrorMessage(error),
          });
        }
      }

      return { attempted, saved, failed: attempted - saved, failures };
    } finally {
      savingRef.current = false;
    }
  }, [invalidateScenarioCache, t, updateSubAgent, updateVariableDefinition]);

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

  const ensureScenarioDraftLoaded = useCallback(
    async (taskType: TaskType, taskSubtype: string, label: string, nodeId?: string) => {
      const key = makeScenarioDraftKey(taskType, taskSubtype);
      if (scenarioDraftsRef.current[key]) return;

      const emptyScenario: ScenarioDocument = { system_template: '', blocks: [] };
      setScenarioDrafts((prev) => ({
        ...prev,
        [key]: {
          key,
          label,
          nodeId,
          taskType,
          taskSubtype,
          isLoading: true,
          originalScenario: emptyScenario,
          scenario: emptyScenario,
          dirty: false,
          saveWarnings: [],
        },
      }));

      try {
        const loaded = await loadScenario(taskType, taskSubtype);
        setScenarioDrafts((prev) => ({
          ...prev,
          [key]: {
            ...(prev[key] as ScenarioDraft),
            label,
            nodeId,
            taskType,
            taskSubtype,
            isLoading: false,
            loadError: undefined,
            originalScenario: loaded,
            scenario: loaded,
            dirty: false,
            saveWarnings: [],
          },
        }));
      } catch (error) {
        setScenarioDrafts((prev) => ({
          ...prev,
          [key]: {
            ...(prev[key] as ScenarioDraft),
            isLoading: false,
            loadError: toErrorMessage(error),
          },
        }));
      }
    },
    [loadScenario]
  );

  const ensureFragmentDraftLoaded = useCallback(async (folderId: string | null, fragmentName: string, fullPath: string) => {
    const key = makeFragmentDraftKey(folderId, fragmentName);
    if (fragmentDraftsRef.current[key]?.originalContent !== undefined) return;

    setFragmentDrafts((prev) => ({
      ...prev,
      [key]: {
        key,
        label: fullPath,
        folderId,
        fragmentName,
        fullPath,
        isLoading: true,
        originalContent: '',
        originalDescription: '',
        content: '',
        description: '',
        dirty: false,
        validation: null,
        isDeleting: false,
      },
    }));

    try {
      const fragment = await fragmentService.getFragment(folderId, fragmentName);
      setFragmentDrafts((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] as FragmentDraft),
          isLoading: false,
          loadError: undefined,
          originalContent: fragment.content,
          originalDescription: fragment.description || '',
          content: fragment.content,
          description: fragment.description || '',
          dirty: false,
        },
      }));
    } catch (error) {
      setFragmentDrafts((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] as FragmentDraft),
          isLoading: false,
          loadError: toErrorMessage(error),
        },
      }));
    }
  }, []);

  const ensureVariableDraftLoaded = useCallback(
    async (variableId: string) => {
      const key = makeVariableDraftKey(variableId);
      if (variableDraftsRef.current[key]) return;

      let variable = variablesRef.current.find((v) => v.id === variableId);
      if (!variable) {
        await loadVariables().catch(() => undefined);
        variable = useVariableStore.getState().variables.find((v) => v.id === variableId);
        if (!variable) return;
      }

      const base = {
        name: variable.name,
        description: variable.description ?? '',
        select_options: variable.select_options ? [...variable.select_options] : [],
        number_options: {
          min: variable.number_options?.min !== undefined ? String(variable.number_options.min) : '',
          max: variable.number_options?.max !== undefined ? String(variable.number_options.max) : '',
          step: variable.number_options?.step !== undefined ? String(variable.number_options.step) : '',
          input_type: variable.number_options?.input_type ?? 'input',
        },
      };

      const draft: VariableDefinitionDraft = {
        variableId: variable.id,
        varType: variable.var_type,
        original: {
          ...base,
          select_options: [...base.select_options],
          number_options: { ...base.number_options },
        },
        current: {
          ...base,
          select_options: [...base.select_options],
          number_options: { ...base.number_options },
        },
        dirty: false,
        error: '',
      };

      setVariableDrafts((prev) => ({
        ...prev,
        [key]: draft,
      }));
    },
    [loadVariables]
  );

  const ensureSubAgentDraftLoaded = useCallback(
    async (subAgentId: string) => {
      const key = makeSubAgentDraftKey(subAgentId);
      if (subAgentDraftsRef.current[key]) return;

      let agent = subAgentsRef.current.find((s) => s.id === subAgentId);
      if (!agent) {
        await loadSubAgents().catch(() => undefined);
        agent = useSubAgentStore.getState().subAgents.find((s) => s.id === subAgentId);
        if (!agent) return;
      }

      const base = {
        agent_name: agent.agent_name,
        display_name: agent.display_name,
        description: agent.description,
        enabled: agent.enabled,
        allowed_invocation_modes: [...agent.allowed_invocation_modes],
        allowed_tool_names: [...agent.allowed_tool_names],
        allowed_sub_agent_ids: [...agent.allowed_sub_agent_ids],
        use_custom_llm_config: agent.use_custom_llm_config,
        llm_config_override: agent.llm_config_override,
      };

      const draft: SubAgentDefinitionDraft = {
        subAgentId: agent.id,
        original: base,
        current: {
          ...base,
          allowed_invocation_modes: [...base.allowed_invocation_modes],
          allowed_tool_names: [...base.allowed_tool_names],
          allowed_sub_agent_ids: [...base.allowed_sub_agent_ids],
        },
        dirty: false,
        error: '',
      };

      setSubAgentDrafts((prev) => ({
        ...prev,
        [key]: draft,
      }));
    },
    [loadSubAgents]
  );

  // Load drafts as selection changes.
  useEffect(() => {
    if (!selectedPrompt || selectedPrompt.type !== 'promptView') return;
    if (!selectedPrompt.taskType || !selectedPrompt.taskSubtype) return;
    ensureScenarioDraftLoaded(
      selectedPrompt.taskType,
      selectedPrompt.taskSubtype,
      selectedPrompt.label,
      selectedPrompt.id
    );
  }, [ensureScenarioDraftLoaded, selectedPrompt?.id, selectedPrompt?.label, selectedPrompt?.taskSubtype, selectedPrompt?.taskType, selectedPrompt?.type]);
  useEffect(() => {
    if (!selectedFragment) return;
    ensureFragmentDraftLoaded(selectedFragment.folderId, selectedFragment.fragmentName, selectedFragment.fullPath);
  }, [selectedFragment?.folderId, selectedFragment?.fragmentName, selectedFragment?.fullPath, ensureFragmentDraftLoaded]);
  useEffect(() => {
    if (!selectedVariableId) return;
    ensureVariableDraftLoaded(selectedVariableId);
  }, [ensureVariableDraftLoaded, selectedVariableId]);
  useEffect(() => {
    if (!selectedSubAgentId) return;
    ensureSubAgentDraftLoaded(selectedSubAgentId);
  }, [ensureSubAgentDraftLoaded, selectedSubAgentId]);
  useEffect(() => {
    if (!selectedSubAgentId) return;
    if (!subAgentIdentityName) return;
    const displayName =
      currentSubAgentDraft?.current.display_name
      || selectedSubAgent?.display_name
      || subAgentIdentityName;
    ensureScenarioDraftLoaded(
      'subAgent',
      subAgentIdentityName,
      `Sub Agent: ${displayName} / call_${subAgentIdentityName}`,
      `subAgent-${selectedSubAgentId}`
    );
  }, [currentSubAgentDraft?.current.display_name, ensureScenarioDraftLoaded, selectedSubAgent?.display_name, selectedSubAgentId, subAgentIdentityName]);

  useEffect(() => {
    if (!currentFragmentDraft || currentFragmentDraft.isLoading) return;
    const key = currentFragmentDraft.key;
    const timer = window.setTimeout(async () => {
      const validation = await validateFragmentContent(currentFragmentDraft.content, currentFragmentDraft.fullPath, fragmentDraftsRef.current, allFragmentContentsRef.current);
      setFragmentDrafts((prev) => {
        const cur = prev[key];
        if (!cur) return prev;
        return { ...prev, [key]: { ...cur, validation } };
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [currentFragmentDraft?.content, currentFragmentDraft?.fullPath, currentFragmentDraft?.isLoading, currentFragmentDraft?.key]);

  const handlePromptSelect = (node: PromptNode) => {
    if (node.type !== 'promptView') return;
    setSelectedPrompt(node);
    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
  };

  const handleFragmentSelect = (folderId: string | null, fragmentName: string, fullPath: string) => {
    setSelectedFragment({ folderId, fragmentName, fullPath });
    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
  };

  const handleCreateFragment = (folderPath: string | null) => {
    setCreateFolderPath(folderPath);
    setShowCreateModal(true);
  };

  const handleFragmentCreated = (folderId: string | null, fragmentName: string, fullPath: string) => {
    setRefreshTrigger((prev) => prev + 1);
    setSelectedFragment({ folderId, fragmentName, fullPath });
    loadFragmentContents().catch(() => undefined);
  };

  const handleFragmentDeleted = () => {
    setSelectedFragment(null);
    setRefreshTrigger((prev) => prev + 1);
    loadFragmentContents().catch(() => undefined);
  };

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  const handleSubTabChange = (newTab: SubTab) => {
    setSubTab(newTab);
    if (newTab === 'prompts') {
      setSelectedFragment(null);
      setSelectedVariableId(null);
      setSelectedSubAgentId(null);
    } else if (newTab === 'fragments') {
      setSelectedPrompt(null);
      setSelectedVariableId(null);
      setSelectedSubAgentId(null);
    } else if (newTab === 'subAgents') {
      setSelectedPrompt(null);
      setSelectedFragment(null);
      setSelectedVariableId(null);
    } else {
      setSelectedPrompt(null);
      setSelectedFragment(null);
      setSelectedSubAgentId(null);
    }
  };

  const handleCopyFragmentPath = async () => {
    if (!selectedPath) return;
    const pathToCopy = `{% include "${toFragmentReference(selectedPath)}" %}`;
    try {
      await navigator.clipboard.writeText(pathToCopy);
      toast.success(t('common.copied', { value: pathToCopy }));
    } catch {
      toast.error(t('settings.promptEditor.toast.copyFailed'));
    }
  };

  const getEditorTitle = () => {
    if (subTab === 'prompts' && selectedPrompt) {
      // Derive parent label from the prompt tree for context
      const parentId = selectedPrompt.id.replace(/-system$|-blocks$/, '');
      const parentNode = findPromptNode(parentId);
      const parentLabel = parentNode?.label || '';
      return `${parentLabel} — ${selectedPrompt.label}`;
    }
    if (subTab === 'fragments' && selectedPath) return selectedPath;
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
    (subTab === 'fragments' && selectedFragment) ||
    subTab === 'variables' ||
    subTab === 'subAgents';

  const canShowHeader = subTab !== 'variables' && subTab !== 'subAgents';

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
    : currentFragmentDraft?.content.length;
  const currentEditorDirty = subTab === 'prompts' ? currentScenarioDraft?.dirty : currentFragmentDraft?.dirty;

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
          invalidateScenarioCache(taskType, taskSubtype);
          const loaded = await loadScenario(taskType, taskSubtype);
          setScenarioDrafts((prev) => {
            const cur = prev[key];
            if (!cur) return prev;
            return {
              ...prev,
              [key]: {
                ...cur,
                originalScenario: loaded,
                scenario: loaded,
                dirty: false,
                saveWarnings: [],
              },
            };
          });
        },
      };
    }

    if (subTab === 'fragments' && selectedFragment) {
      const folderId = selectedFragment.folderId;
      const fragmentName = selectedFragment.fragmentName;
      const key = makeFragmentDraftKey(folderId, fragmentName);
      return {
        title: 'Fragment Version History',
        loadVersions: () => fragmentService.getVersionHistory(folderId, fragmentName),
        restoreVersion: async (vn: number) => {
          await fragmentService.restoreVersion(folderId, fragmentName, vn);
          const fragment = await fragmentService.getFragment(folderId, fragmentName);
          setFragmentDrafts((prev) => {
            const cur = prev[key];
            if (!cur) return prev;
            return {
              ...prev,
              [key]: {
                ...cur,
                originalContent: fragment.content,
                originalDescription: fragment.description || '',
                content: fragment.content,
                description: fragment.description || '',
                dirty: false,
              },
            };
          });
        },
      };
    }

    return null;
  }, [invalidateScenarioCache, loadScenario, selectedFragment, selectedPrompt, subTab]);

  const handleRestoreComplete = () => {
    setShowVersionHistory(false);
  };

  const handleStartEditDescription = () => {
    setEditedDescription(currentFragmentDraft?.description || '');
    setIsEditingDescription(true);
  };

  const handleSaveDescription = () => {
    if (!currentFragmentDraft) return;
    const nextDesc = editedDescription;
    setFragmentDrafts((prev) => {
      const cur = prev[currentFragmentDraft.key];
      if (!cur) return prev;
      return {
        ...prev,
        [currentFragmentDraft.key]: {
          ...cur,
          description: nextDesc,
          dirty: cur.content !== cur.originalContent || nextDesc !== cur.originalDescription,
        },
      };
    });
    setIsEditingDescription(false);
  };

  const handleCancelEditDescription = () => {
    setIsEditingDescription(false);
  };

  const handleDeleteSelectedFragment = async () => {
    if (!currentFragmentDraft) return;
    const ok = await confirm({
      title: 'Delete Fragment',
      message: `Are you sure you want to delete "${currentFragmentDraft.fullPath}"? This will delete all versions.`,
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!ok) return;

    const key = currentFragmentDraft.key;
    setFragmentDrafts((prev) => {
      const cur = prev[key];
      if (!cur) return prev;
      return { ...prev, [key]: { ...cur, isDeleting: true } };
    });

    try {
      await fragmentService.deleteFragment(currentFragmentDraft.folderId, currentFragmentDraft.fragmentName);
      setFragmentDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      handleFragmentDeleted();
    } catch (error) {
      setFragmentDrafts((prev) => {
        const cur = prev[key];
        if (!cur) return prev;
        return { ...prev, [key]: { ...cur, isDeleting: false, loadError: toErrorMessage(error) } };
      });
    } finally {
      setIsEditingDescription(false);
    }
  };

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

  // Preset handlers (modals only)
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

  return (
    <div className="prompts-templates-panel">
      <div className="prompts-layout__content">
        <div className={`panel-editor ${isSidebarCollapsed ? 'panel-editor--collapsed' : ''}`}>
          {!isSidebarCollapsed && <div className="panel-editor__backdrop" onClick={() => setIsSidebarCollapsed(true)} />}

          <main className="panel-editor__main">
            <div className="editor-wrapper">
              {canShowHeader && (
                <header className="editor-wrapper__header">
                  {hasSelection && (
                    <div className="editor-wrapper__title-group">
                      <div className="editor-wrapper__title-row">
                        <h3 className="editor-wrapper__title">{getEditorTitle()}</h3>
                        {subTab === 'fragments' && selectedPath && (
                          <IconButton
                            icon={<Copy size="sm" />}
                            onClick={handleCopyFragmentPath}
                            title={t('settings.promptEditor.copyPathForTemplates')}
                            size="xs"
                            className="editor-wrapper__copy-btn"
                          />
                        )}
                      </div>

                      {subTab === 'fragments' && currentFragmentDraft ? (
                        <div className="editor-wrapper__description editor-wrapper__description--editable">
                          {isEditingDescription ? (
                            <input
                              type="text"
                              value={editedDescription}
                              onChange={(e) => setEditedDescription(e.target.value)}
                              onBlur={handleSaveDescription}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveDescription();
                                if (e.key === 'Escape') handleCancelEditDescription();
                              }}
                              placeholder={t('settings.promptEditor.addDescription')}
                              className="editor-wrapper__description-input"
                              autoFocus
                            />
                          ) : (
                            <>
                              <span className="editor-wrapper__description-text">
                                {currentFragmentDraft.description || t('settings.promptEditor.noDescription')}
                              </span>
                              <button
                                className="editor-wrapper__description-edit"
                                onClick={handleStartEditDescription}
                                title={t('settings.promptEditor.editDescription')}
                              >
                                <Edit size="xs" />
                              </button>
                            </>
                          )}
                        </div>
                      ) : (
                        getEditorDescription() && <p className="editor-wrapper__description">{getEditorDescription()}</p>
                      )}

                      {(currentScenarioDraft || currentFragmentDraft) && (
                        <div className="editor-wrapper__meta">
                          <span>{t('settings.promptEditor.chars', { count: currentEditorContentLength || 0 })}</span>
                          {currentEditorDirty && <span className="editor-wrapper__unsaved"> • {t('settings.promptEditor.unsavedChanges')}</span>}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="editor-wrapper__actions">
                    {hasSelection && (
                      <>
                        <TemplateSyntaxHint selectedNode={subTab === 'prompts' ? selectedPrompt : null} />

                        {subTab === 'prompts' && selectedPrompt?.viewKind === 'system' && currentScenarioDraft && (
                          <IconButton
                            icon={<Eye size="sm" />}
                            onClick={() => setShowSystemPreview(true)}
                            title="Preview system template"
                            size="sm"
                            variant="ghost"
                          />
                        )}

                        {currentVersionHistoryProps && (
                          <IconButton
                            icon={<Clock size="sm" />}
                            onClick={() => setShowVersionHistory(true)}
                            title={t('settings.promptEditor.versionHistory')}
                            size="sm"
                            disabled={currentFragmentDraft?.isDeleting}
                          />
                        )}

                        {subTab === 'prompts' && selectedPrompt?.viewKind === 'blocks' && (
                          <div ref={blocksHeaderActionsRef} className="editor-wrapper__blocks-actions" />
                        )}

                        {subTab === 'fragments' && currentFragmentDraft && (
                          <IconButton
                            icon={<Trash size="sm" />}
                            onClick={handleDeleteSelectedFragment}
                            title={t('settings.promptEditor.deleteFragment')}
                            size="sm"
                            className="editor-wrapper__delete-btn"
                            disabled={currentFragmentDraft.isDeleting}
                          />
                        )}
                      </>
                    )}
                  </div>

                  <IconButton
                    icon={isSidebarCollapsed ? <ChevronLeft size="lg" /> : <ChevronRight size="lg" />}
                    onClick={toggleSidebar}
                    title={
                      isSidebarCollapsed
                        ? t('settings.promptEditor.expandSidebar')
                        : t('settings.promptEditor.collapseSidebar')
                    }
                    size="lg"
                    variant="ghost"
                    className="editor-wrapper__sidebar-toggle"
                  />
                </header>
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
                          setScenarioDrafts((prev) => {
                            const cur = prev[draftKey];
                            if (!cur) return prev;
                            const nextScenario = { ...cur.scenario, system_template: text };
                            const dirty = JSON.stringify(nextScenario) !== JSON.stringify(cur.originalScenario);
                            return {
                              ...prev,
                              [draftKey]: { ...cur, scenario: nextScenario, dirty, saveWarnings: [] },
                            };
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
                          onBlocksChange={(blocks) => {
                            const taskType = selectedPrompt.taskType;
                            const taskSubtype = selectedPrompt.taskSubtype;
                            if (!taskType || !taskSubtype) return;
                            const draftKey = makeScenarioDraftKey(taskType, taskSubtype);
                            setScenarioDrafts((prev) => {
                              const cur = prev[draftKey];
                              if (!cur) return prev;
                              const nextScenario = { ...cur.scenario, blocks };
                              const dirty = JSON.stringify(nextScenario) !== JSON.stringify(cur.originalScenario);
                              return {
                                ...prev,
                                [draftKey]: { ...cur, scenario: nextScenario, dirty, saveWarnings: [] },
                              };
                            });
                          }}
                          onToast={(kind, message) => {
                            if (kind === 'success') toast.success(message);
                            else toast.error(message);
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
                        isMemoryPrompt={false}
                      />
                    )}
                  </>
                )}

                {subTab === 'fragments' && selectedFragment && (
                  <TemplateEditor
                    content={currentFragmentDraft?.content || ''}
                    onContentChange={(text) => {
                      if (!currentFragmentDraft) return;
                      setFragmentDrafts((prev) => {
                        const cur = prev[currentFragmentDraft.key];
                        if (!cur) return prev;
                        const dirty = text !== cur.originalContent || cur.description !== cur.originalDescription;
                        return {
                          ...prev,
                          [currentFragmentDraft.key]: {
                            ...cur,
                            content: text,
                            dirty,
                          },
                        };
                      });
                    }}
                    validation={currentFragmentDraft?.validation ?? null}
                    isLoading={!currentFragmentDraft || currentFragmentDraft.isLoading}
                    placeholder={t('settings.promptEditor.enterFragmentTemplate')}
                  />
                )}

                {subTab === 'variables' && (
                  <VariableEditor
                    variableId={selectedVariableId}
                    draft={currentVariableDraft}
                    onDraftChange={(draft) => {
                      setVariableDrafts((prev) => ({
                        ...prev,
                        [makeVariableDraftKey(draft.variableId)]: draft,
                      }));
                    }}
                    onDeleted={(variableId) => {
                      setSelectedVariableId(null);
                      setVariableDrafts((prev) => {
                        const next = { ...prev };
                        delete next[makeVariableDraftKey(variableId)];
                        return next;
                      });
                    }}
                    isSidebarCollapsed={isSidebarCollapsed}
                    onToggleSidebar={toggleSidebar}
                  />
                )}

                {subTab === 'subAgents' && (
                  <SubAgentEditor
                    key={selectedSubAgentId}
                    selectedId={selectedSubAgentId}
                    draft={currentSubAgentDraft}
                    onDraftChange={handleSubAgentDraftChange}
                    promptIdentityName={subAgentIdentityName}
                    scenarioDraft={subAgentIdentityName ? scenarioDrafts[makeScenarioDraftKey('subAgent', subAgentIdentityName)] : null}
                    onScenarioChange={(nextScenario) => {
                      if (!subAgentIdentityName) return;
                      const draftKey = makeScenarioDraftKey('subAgent', subAgentIdentityName);
                      setScenarioDrafts((prev) => {
                        const cur = prev[draftKey];
                        if (!cur) return prev;
                        const dirty = JSON.stringify(nextScenario) !== JSON.stringify(cur.originalScenario);
                        return {
                          ...prev,
                          [draftKey]: {
                            ...cur,
                            scenario: nextScenario,
                            dirty,
                            saveWarnings: [],
                          },
                        };
                      });
                    }}
                    onReloadScenario={async () => {
                      if (!subAgentIdentityName) return;
                      invalidateScenarioCache('subAgent', subAgentIdentityName);
                      const loaded = await loadScenario('subAgent', subAgentIdentityName);
                      const draftKey = makeScenarioDraftKey('subAgent', subAgentIdentityName);
                      setScenarioDrafts((prev) => {
                        const cur = prev[draftKey];
                        if (!cur) return prev;
                        return {
                          ...prev,
                          [draftKey]: {
                            ...cur,
                            originalScenario: loaded,
                            scenario: loaded,
                            dirty: false,
                            saveWarnings: [],
                          },
                        };
                      });
                    }}
                    onDeleted={(subAgentId) => {
                      setSelectedSubAgentId(null);
                      setSubAgentDrafts((prev) => {
                        const next = { ...prev };
                        delete next[makeSubAgentDraftKey(subAgentId)];
                        return next;
                      });
                      const draft = subAgentDraftsRef.current[makeSubAgentDraftKey(subAgentId)];
                      const name = draft?.original.agent_name;
                      if (name) {
                        setScenarioDrafts((prev) => {
                          const next = { ...prev };
                          delete next[makeScenarioDraftKey('subAgent', name)];
                          return next;
                        });
                      }
                    }}
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
                      <TextButton variant="primary" size="lg" onClick={() => handleCreateFragment(null)}>
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

            <div className="sidebar-toggle">
              <button
                className={`sidebar-toggle__btn ${subTab === 'prompts' ? 'sidebar-toggle__btn--active' : ''}`}
                onClick={() => handleSubTabChange('prompts')}
              >
                {t('settings.promptEditor.prompts')}
              </button>
              <button
                className={`sidebar-toggle__btn ${subTab === 'fragments' ? 'sidebar-toggle__btn--active' : ''}`}
                onClick={() => handleSubTabChange('fragments')}
              >
                {t('settings.promptEditor.fragments')}
              </button>
              <button
                className={`sidebar-toggle__btn ${subTab === 'variables' ? 'sidebar-toggle__btn--active' : ''}`}
                onClick={() => handleSubTabChange('variables')}
              >
                {t('settings.promptEditor.variables')}
              </button>
              <button
                className={`sidebar-toggle__btn ${subTab === 'subAgents' ? 'sidebar-toggle__btn--active' : ''}`}
                onClick={() => handleSubTabChange('subAgents')}
              >
                {t('settings.promptEditor.subAgents')}
              </button>
            </div>

            {subTab === 'prompts' && (
              <PromptTreeNav
                tree={PROMPT_TREE}
                selectedNodeId={selectedPrompt?.id || null}
                onNodeSelect={handlePromptSelect}
                onClose={() => setIsSidebarCollapsed(true)}
              />
            )}
            {subTab === 'fragments' && (
              <FragmentTreeNav
                selectedPath={selectedPath}
                onFragmentSelect={handleFragmentSelect}
                onCreateFragment={handleCreateFragment}
                refreshTrigger={refreshTrigger}
                onClose={() => setIsSidebarCollapsed(true)}
              />
            )}
            {subTab === 'variables' && (
              <VariableListNav
                selectedId={selectedVariableId}
                onVariableSelect={(id) => {
                  setSelectedVariableId(id);
                  if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
                }}
                onCreateVariable={() => setShowCreateVariableModal(true)}
                onClose={() => setIsSidebarCollapsed(true)}
              />
            )}
            {subTab === 'subAgents' && (
              <SubAgentListNav
                selectedId={selectedSubAgentId}
                onSelect={(id) => {
                  setSelectedSubAgentId(id);
                  if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
                }}
                onCreate={() => setShowCreateSubAgentModal(true)}
                onClose={() => setIsSidebarCollapsed(true)}
              />
            )}
          </aside>
        </div>
      </div>

      <CreateFragmentModal
        isOpen={showCreateModal}
        folderPath={createFolderPath}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleFragmentCreated}
      />

      {showVersionHistory && currentVersionHistoryProps && (
        <VersionHistoryModal
          isOpen={showVersionHistory}
          onClose={() => setShowVersionHistory(false)}
          onRestoreVersion={handleRestoreComplete}
          textVersionProps={currentVersionHistoryProps}
        />
      )}

      <CreateVariableModal
        isOpen={showCreateVariableModal}
        onClose={() => setShowCreateVariableModal(false)}
        onCreate={(id) => setSelectedVariableId(id)}
      />

      <CreateSubAgentModal
        isOpen={showCreateSubAgentModal}
        onClose={() => setShowCreateSubAgentModal(false)}
        onCreated={(id) => {
          setSelectedSubAgentId(id);
          setShowCreateSubAgentModal(false);
          setSubTab('subAgents');
        }}
      />

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
