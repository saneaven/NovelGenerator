import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
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
import VersionHistoryModal from '../../Modal/VersionHistoryModal';
import PresetSelector from '../PresetSelector';
import PresetModal from '../PresetModal';
import { BaseModal } from '../../BaseModal';
import { usePresetStore } from '../../../store/presetStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useSubAgentStore } from '../../../store/subAgentStore';
import { useVariableStore } from '../../../store/variableStore';
import { promptService } from '../../../api/promptService';
import { fragmentService } from '../../../api/fragmentService';
// TODO: PromptManager deleted — fragment reload needs reimplementation
const PromptManager = { reloadFragments: () => Promise.resolve() };
import { PROMPT_TREE, getFirstPromptNode, type PromptNode } from './promptTree';
import { IconButton } from '../../IconButton';
import { TextButton } from '../../TextButton';
import { ChevronLeft, ChevronRight, Document, Copy, Clock, Trash, Edit, Eye } from '../../icons';
import './PromptsTemplatesPanel.css';
import TemplateSyntaxHint from './TemplateSyntaxHint';
import PromptPreviewModal from './PromptPreviewModal';
import type { PresetListItem } from '../../../types/presets';
import type { PromptCategory, TaskType } from '../../../types/prompts';
import { mapTaskTypeToSchemaType } from '../../../templateEngine/validator';
import { extractFragmentReferences, getFragmentRegistry, validateTemplate } from '../../../templateEngine/engine';
import { useSettingsToast } from '../SettingsToastContext';
import {
  makeFragmentDraftKey,
  makePromptDraftKey,
  makeSubAgentDraftKey,
  makeVariableDraftKey,
  type DirtyItem,
  type SaveFailure,
  type SaveSummary,
} from './draftTypes';

type SubTab = 'prompts' | 'fragments' | 'variables' | 'subAgents';

interface SelectedFragment {
  folderPath: string | null;
  fragmentName: string;
}

interface TemplateValidationResult {
  valid: boolean;
  errors: Array<{ message: string; line?: number; column?: number; severity: string }>;
  warnings: Array<{ message: string; line?: number; column?: number; severity: string }>;
}

type PromptDraft = {
  key: string;
  label: string;
  nodeId?: string;
  taskType: TaskType;
  category: PromptCategory;
  name: string;
  isLoading: boolean;
  loadError?: string;
  originalContent: string;
  content: string;
  dirty: boolean;
  validation: TemplateValidationResult | null;
};

type FragmentDraft = {
  key: string;
  label: string;
  folderPath: string | null;
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

function fragmentFullPath(folderPath: string | null, fragmentName: string): string {
  return folderPath ? `${folderPath}/${fragmentName}` : fragmentName;
}

async function validatePromptContent(taskType: TaskType, name: string, content: string): Promise<TemplateValidationResult> {
  const schemaType = mapTaskTypeToSchemaType(taskType, name);
  const result = await validateTemplate(content, schemaType || undefined);

  if (!result.isValid) {
    return {
      valid: false,
      errors: [
        {
          message: result.error || 'Unknown syntax error',
          severity: 'error',
        },
      ],
      warnings: [],
    };
  }

  return {
    valid: true,
    errors: [],
    warnings:
      result.warnings?.map((w) => ({
        message: w.message,
        line: w.line,
        column: w.column,
        severity: w.severity,
      })) || [],
  };
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
  fragmentDrafts: Record<string, FragmentDraft>
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

  const contentByPath = getFragmentRegistry();
  for (const d of Object.values(fragmentDrafts)) {
    contentByPath.set(d.fullPath, d.content);
  }

  const refs = extractFragmentReferences(content);
  const warnings: TemplateValidationResult['warnings'] = [];
  const errors: TemplateValidationResult['errors'] = [];

  for (const ref of refs) {
    if (!contentByPath.has(ref)) {
      warnings.push({ message: `Referenced fragment not found: "${ref}"`, severity: 'warning' });
    }
  }

  if (refs.includes(fullPath)) {
    errors.push({ message: `Self-reference detected: fragment "${fullPath}" references itself`, severity: 'error' });
  }

  const cycle = detectCircularFragmentReferences(fullPath, contentByPath);
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
  onCreate: (folderPath: string | null, fragmentName: string) => void;
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
      await fragmentService.createFragment(
        finalFolderPath,
        name.trim(),
        content || `{{! ${name} fragment }}`,
        description || undefined,
        'Initial creation'
      );
      onCreate(finalFolderPath, name.trim());
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
  const loadPrompt = useSettingsStore((s) => s.loadPrompt);
  const invalidatePromptCache = useSettingsStore((s) => s.invalidatePromptCache);
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

  const [promptDrafts, setPromptDrafts] = useState<Record<string, PromptDraft>>({});
  const [fragmentDrafts, setFragmentDrafts] = useState<Record<string, FragmentDraft>>({});
  const [variableDrafts, setVariableDrafts] = useState<Record<string, VariableDefinitionDraft>>({});
  const [subAgentDrafts, setSubAgentDrafts] = useState<Record<string, SubAgentDefinitionDraft>>({});
  const promptDraftsRef = useRef(promptDrafts);
  const fragmentDraftsRef = useRef(fragmentDrafts);
  const variableDraftsRef = useRef(variableDrafts);
  const subAgentDraftsRef = useRef(subAgentDrafts);
  const variablesRef = useRef(variables);
  const subAgentsRef = useRef(subAgents);
  useEffect(() => {
    promptDraftsRef.current = promptDrafts;
  }, [promptDrafts]);
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

  // Prompt preview modal
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  // Inline description editing (fragments)
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedDescription, setEditedDescription] = useState('');

  // Preset modal state
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [presetModalMode, setPresetModalMode] = useState<'create' | 'duplicate' | 'edit'>('create');
  const [presetModalSource, setPresetModalSource] = useState<PresetListItem | null>(null);

  // Initialize first prompt on mount
  useEffect(() => {
    const firstPrompt = getFirstPromptNode();
    if (firstPrompt) setSelectedPrompt(firstPrompt);
  }, []);

  // Clear drafts on preset switch, and refresh fragment tree + registry.
  useEffect(() => {
    setPromptDrafts({});
    setFragmentDrafts({});
    setVariableDrafts({});
    setSubAgentDrafts({});
    setSelectedFragment(null);
    setSelectedVariableId(null);
    setSelectedSubAgentId(null);
    setIsEditingDescription(false);
    setShowVersionHistory(false);
    setShowPreviewModal(false);
    setRefreshTrigger((prev) => prev + 1);
    PromptManager.reloadFragments().catch(() => undefined);
    loadVariables().catch(() => undefined);
    loadSubAgents().catch(() => undefined);
  }, [activePresetId, loadSubAgents, loadVariables]);

  const selectedPath = useMemo(() => {
    if (!selectedFragment) return null;
    return fragmentFullPath(selectedFragment.folderPath, selectedFragment.fragmentName);
  }, [selectedFragment]);

  const selectedPromptKey = useMemo(() => {
    if (!selectedPrompt || selectedPrompt.type !== 'prompt') return null;
    if (!selectedPrompt.taskType || !selectedPrompt.category || !selectedPrompt.name) return null;
    return makePromptDraftKey(selectedPrompt.taskType, selectedPrompt.category, selectedPrompt.name);
  }, [selectedPrompt]);

  const selectedFragmentKey = useMemo(() => {
    if (!selectedFragment) return null;
    return makeFragmentDraftKey(selectedFragment.folderPath, selectedFragment.fragmentName);
  }, [selectedFragment]);

  const selectedVariableKey = useMemo(() => {
    if (!selectedVariableId) return null;
    return makeVariableDraftKey(selectedVariableId);
  }, [selectedVariableId]);

  const selectedSubAgentKey = useMemo(() => {
    if (!selectedSubAgentId) return null;
    return makeSubAgentDraftKey(selectedSubAgentId);
  }, [selectedSubAgentId]);

  const currentPromptDraft = selectedPromptKey ? promptDrafts[selectedPromptKey] : null;
  const currentFragmentDraft = selectedFragmentKey ? fragmentDrafts[selectedFragmentKey] : null;
  const currentVariableDraft = selectedVariableKey ? variableDrafts[selectedVariableKey] : null;
  const currentSubAgentDraft = selectedSubAgentKey ? subAgentDrafts[selectedSubAgentKey] : null;

  const selectedSubAgent = useMemo(() => {
    if (!selectedSubAgentId) return null;
    return subAgents.find((s) => s.id === selectedSubAgentId) || null;
  }, [selectedSubAgentId, subAgents]);

  const subAgentPromptIdentityName = useMemo(() => {
    return currentSubAgentDraft?.original.agent_name || selectedSubAgent?.agent_name || null;
  }, [currentSubAgentDraft, selectedSubAgent]);

  const subAgentPromptDraftViews = useMemo(() => {
    const empty: Record<'systemPrompt' | 'userPrompt' | 'prefill', { content: string; isLoading: boolean } | null> = {
      systemPrompt: null,
      userPrompt: null,
      prefill: null,
    };
    if (!subAgentPromptIdentityName) return empty;

    const pick = (category: PromptCategory): { content: string; isLoading: boolean } | null => {
      const key = makePromptDraftKey('subAgent', category, subAgentPromptIdentityName);
      const d = promptDrafts[key];
      return d ? { content: d.content, isLoading: d.isLoading } : null;
    };

    return {
      systemPrompt: pick('systemPrompt'),
      userPrompt: pick('userPrompt'),
      prefill: pick('prefill'),
    };
  }, [promptDrafts, subAgentPromptIdentityName]);

  const handleSubAgentDraftChange = useCallback((draft: SubAgentDefinitionDraft) => {
    setSubAgentDrafts((prev) => ({
      ...prev,
      [makeSubAgentDraftKey(draft.subAgentId)]: draft,
    }));
  }, []);

  const subAgentPromptDisplayName = useMemo(() => {
    if (!subAgentPromptIdentityName) return '';
    return currentSubAgentDraft?.current.display_name || selectedSubAgent?.display_name || subAgentPromptIdentityName;
  }, [currentSubAgentDraft, selectedSubAgent?.display_name, subAgentPromptIdentityName]);

  const handleSubAgentPromptContentChange = useCallback(
    (tab: 'systemPrompt' | 'userPrompt' | 'prefill', content: string) => {
      if (!subAgentPromptIdentityName) return;
      const key = makePromptDraftKey('subAgent', tab, subAgentPromptIdentityName);
      const nodeId = selectedSubAgentId ? `subAgent-${selectedSubAgentId}-${tab}` : undefined;
      const label = `Sub Agent: ${subAgentPromptDisplayName} / call_${subAgentPromptIdentityName} / ${tab}`;
      setPromptDrafts((prev) => {
        const cur = prev[key];
        if (!cur) {
          return {
            ...prev,
            [key]: {
              key,
              label,
              nodeId,
              taskType: 'subAgent',
              category: tab,
              name: subAgentPromptIdentityName,
              isLoading: false,
              originalContent: '',
              content,
              dirty: content !== '',
              validation: null,
            },
          };
        }
        return {
          ...prev,
          [key]: {
            ...cur,
            label,
            nodeId: cur.nodeId ?? nodeId,
            name: subAgentPromptIdentityName,
            content,
            dirty: content !== cur.originalContent,
          },
        };
      });
    },
    [selectedSubAgentId, subAgentPromptDisplayName, subAgentPromptIdentityName]
  );

  const reloadSubAgentPrompt = useCallback(
    async (tab: 'systemPrompt' | 'userPrompt' | 'prefill') => {
      if (!subAgentPromptIdentityName) return;
      const key = makePromptDraftKey('subAgent', tab, subAgentPromptIdentityName);
      const content = await loadPrompt('subAgent', tab, subAgentPromptIdentityName);
      setPromptDrafts((prev) => {
        const cur = prev[key];
        if (!cur) return prev;
        return {
          ...prev,
          [key]: {
            ...cur,
            originalContent: content,
            content,
            dirty: false,
            loadError: undefined,
          },
        };
      });
    },
    [loadPrompt, subAgentPromptIdentityName]
  );

  const unsavedCount = useMemo(() => {
    const promptCount = Object.values(promptDrafts).filter((d) => d.dirty).length;
    const fragmentCount = Object.values(fragmentDrafts).filter((d) => d.dirty).length;
    const variableCount = Object.values(variableDrafts).filter((d) => d.dirty).length;
    const subAgentCount = Object.values(subAgentDrafts).filter((d) => d.dirty).length;
    return promptCount + fragmentCount + variableCount + subAgentCount;
  }, [promptDrafts, fragmentDrafts, subAgentDrafts, variableDrafts]);

  useEffect(() => {
    onUnsavedCountChange?.(unsavedCount);
  }, [onUnsavedCountChange, unsavedCount]);

  const getDirtyItems = useCallback((): DirtyItem[] => {
    const dirty: DirtyItem[] = [];
    for (const d of Object.values(promptDraftsRef.current)) {
      if (!d.dirty) continue;
      dirty.push({
        kind: 'prompt',
        key: d.key,
        label: d.label,
        taskType: d.taskType,
        category: d.category,
        name: d.name,
        nodeId: d.nodeId,
      });
    }
    for (const d of Object.values(fragmentDraftsRef.current)) {
      if (!d.dirty) continue;
      dirty.push({
        kind: 'fragment',
        key: d.key,
        label: d.label,
        folderPath: d.folderPath,
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
    setPromptDrafts((prev) => {
      const next: Record<string, PromptDraft> = { ...prev };
      for (const [k, d] of Object.entries(next)) {
        if (!d.dirty) continue;
        next[k] = { ...d, content: d.originalContent, dirty: false };
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

      const remapSubAgentPromptDraftKeys = (oldName: string, newName: string) => {
        if (!oldName || !newName || oldName === newName) return;

        const prev = promptDraftsRef.current;
        let next: Record<string, PromptDraft> | null = null;
        const categories: Array<PromptCategory> = ['systemPrompt', 'userPrompt', 'prefill'];

        for (const category of categories) {
          const oldKey = makePromptDraftKey('subAgent', category, oldName);
          const oldDraft = prev[oldKey];
          if (!oldDraft) continue;

          if (!next) next = { ...prev };

          const newKey = makePromptDraftKey('subAgent', category, newName);
          delete next[oldKey];
          next[newKey] = {
            ...oldDraft,
            key: newKey,
            name: newName,
            label: `Sub Agent: call_${newName} / ${category}`,
          };
        }

        if (next) {
          promptDraftsRef.current = next;
          setPromptDrafts(next);
        }
      };

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
            allowed_tool_names: d.current.allowed_tool_names.filter(
              (n) => !n.startsWith('call_')
            ),
            allowed_sub_agent_ids: d.current.allowed_sub_agent_ids,
            use_custom_llm_config: d.current.use_custom_llm_config,
            llm_config_override: d.current.llm_config_override,
          });

          const previousName = d.original.agent_name;
          const nextName = updated.agent_name;
          if (previousName !== nextName) {
            remapSubAgentPromptDraftKeys(previousName, nextName);
          }

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

      const dirtyPrompts = Object.values(promptDraftsRef.current).filter((d) => d.dirty);
      for (const d of dirtyPrompts) {
        attempted += 1;
        const validation = await validatePromptContent(d.taskType, d.name, d.content);
        if (!validation.valid) {
          failures.push({
            item: {
              kind: 'prompt',
              key: d.key,
              label: d.label,
              taskType: d.taskType,
              category: d.category,
              name: d.name,
              nodeId: d.nodeId,
            },
            error: validation.errors[0]?.message || t('settings.promptEditor.toast.templateSyntaxError'),
          });
          setPromptDrafts((prev) => {
            const cur = prev[d.key];
            if (!cur) return prev;
            return { ...prev, [d.key]: { ...cur, validation } };
          });
          continue;
        }

        try {
          await promptService.savePrompt(d.taskType, d.category, d.content, d.name);
          invalidatePromptCache(d.taskType, d.category, d.name);
          saved += 1;
          setPromptDrafts((prev) => {
            const cur = prev[d.key];
            if (!cur) return prev;
            return {
              ...prev,
              [d.key]: {
                ...cur,
                originalContent: cur.content,
                dirty: false,
                validation,
              },
            };
          });
        } catch (error) {
          failures.push({
            item: {
              kind: 'prompt',
              key: d.key,
              label: d.label,
              taskType: d.taskType,
              category: d.category,
              name: d.name,
              nodeId: d.nodeId,
            },
            error: toErrorMessage(error),
          });
        }
      }

      const dirtyFragments = Object.values(fragmentDraftsRef.current).filter((d) => d.dirty);
      let didSaveAnyFragment = false;
      for (const d of dirtyFragments) {
        attempted += 1;
        const validation = await validateFragmentContent(d.content, d.fullPath, fragmentDraftsRef.current);
        if (!validation.valid) {
          failures.push({
            item: {
              kind: 'fragment',
              key: d.key,
              label: d.label,
              folderPath: d.folderPath,
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
          await fragmentService.saveFragment(d.folderPath, d.fragmentName, d.content, d.description || undefined, undefined);
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
              folderPath: d.folderPath,
              fragmentName: d.fragmentName,
              fullPath: d.fullPath,
            },
            error: toErrorMessage(error),
          });
        }
      }

      if (didSaveAnyFragment) {
        await PromptManager.reloadFragments();
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
  }, [invalidatePromptCache, t, updateSubAgent, updateVariableDefinition]);

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

  const ensurePromptDraftLoaded = useCallback(
    async (node: PromptNode) => {
      if (node.type !== 'prompt' || !node.taskType || !node.category || !node.name) return;

      const key = makePromptDraftKey(node.taskType, node.category, node.name);
      if (promptDraftsRef.current[key]?.originalContent !== undefined) return;

      setPromptDrafts((prev) => ({
        ...prev,
        [key]: {
          key,
          label: node.label,
          nodeId: node.id,
          taskType: node.taskType!,
          category: node.category!,
          name: node.name!,
          isLoading: true,
          originalContent: '',
          content: '',
          dirty: false,
          validation: null,
        },
      }));

      try {
        const content = await loadPrompt(node.taskType!, node.category!, node.name!);
        setPromptDrafts((prev) => ({
          ...prev,
          [key]: {
            ...(prev[key] as PromptDraft),
            label: node.label,
            nodeId: node.id,
            taskType: node.taskType!,
            category: node.category!,
            name: node.name!,
            isLoading: false,
            loadError: undefined,
            originalContent: content,
            content,
            dirty: false,
          },
        }));
      } catch (error) {
        setPromptDrafts((prev) => ({
          ...prev,
          [key]: {
            ...(prev[key] as PromptDraft),
            isLoading: false,
            loadError: toErrorMessage(error),
          },
        }));
      }
    },
    [loadPrompt]
  );

  const ensureFragmentDraftLoaded = useCallback(async (folderPath: string | null, fragmentName: string) => {
    const key = makeFragmentDraftKey(folderPath, fragmentName);
    if (fragmentDraftsRef.current[key]?.originalContent !== undefined) return;

    const fullPath = fragmentFullPath(folderPath, fragmentName);
    setFragmentDrafts((prev) => ({
      ...prev,
      [key]: {
        key,
        label: fullPath,
        folderPath,
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
      const fragment = await fragmentService.getFragment(folderPath, fragmentName);
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
    if (selectedPrompt) ensurePromptDraftLoaded(selectedPrompt);
  }, [selectedPrompt?.id, ensurePromptDraftLoaded]);
  useEffect(() => {
    if (!selectedFragment) return;
    ensureFragmentDraftLoaded(selectedFragment.folderPath, selectedFragment.fragmentName);
  }, [selectedFragment?.folderPath, selectedFragment?.fragmentName, ensureFragmentDraftLoaded]);
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

    const draft = subAgentDraftsRef.current[makeSubAgentDraftKey(selectedSubAgentId)];
    const agent = subAgentsRef.current.find((s) => s.id === selectedSubAgentId);
    const agentName = draft?.original.agent_name || agent?.agent_name;
    if (!agentName) return;

    const displayName = draft?.current.display_name || agent?.display_name || agentName;
    const makeNode = (category: PromptCategory): PromptNode => ({
      id: `subAgent-${selectedSubAgentId}-${category}`,
      label: `Sub Agent: ${displayName} / call_${agentName} / ${category}`,
      type: 'prompt',
      taskType: 'subAgent',
      category,
      name: agentName,
    });

    ensurePromptDraftLoaded(makeNode('systemPrompt'));
    ensurePromptDraftLoaded(makeNode('userPrompt'));
    ensurePromptDraftLoaded(makeNode('prefill'));
  }, [ensurePromptDraftLoaded, selectedSubAgentId]);

  // Debounced validation for the currently-selected prompt/fragment.
  useEffect(() => {
    if (!currentPromptDraft || currentPromptDraft.isLoading) return;
    const key = currentPromptDraft.key;
    const timer = window.setTimeout(async () => {
      const validation = await validatePromptContent(currentPromptDraft.taskType, currentPromptDraft.name, currentPromptDraft.content);
      setPromptDrafts((prev) => {
        const cur = prev[key];
        if (!cur) return prev;
        return { ...prev, [key]: { ...cur, validation } };
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [currentPromptDraft?.content, currentPromptDraft?.isLoading, currentPromptDraft?.key, currentPromptDraft?.name, currentPromptDraft?.taskType]);

  useEffect(() => {
    if (!currentFragmentDraft || currentFragmentDraft.isLoading) return;
    const key = currentFragmentDraft.key;
    const timer = window.setTimeout(async () => {
      const validation = await validateFragmentContent(currentFragmentDraft.content, currentFragmentDraft.fullPath, fragmentDraftsRef.current);
      setFragmentDrafts((prev) => {
        const cur = prev[key];
        if (!cur) return prev;
        return { ...prev, [key]: { ...cur, validation } };
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [currentFragmentDraft?.content, currentFragmentDraft?.fullPath, currentFragmentDraft?.isLoading, currentFragmentDraft?.key]);

  const handlePromptSelect = (node: PromptNode) => {
    if (node.type !== 'prompt') return;
    setSelectedPrompt(node);
    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
  };

  const handleFragmentSelect = (folderPath: string | null, fragmentName: string) => {
    setSelectedFragment({ folderPath, fragmentName });
    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
  };

  const handleCreateFragment = (folderPath: string | null) => {
    setCreateFolderPath(folderPath);
    setShowCreateModal(true);
  };

  const handleFragmentCreated = (folderPath: string | null, fragmentName: string) => {
    setRefreshTrigger((prev) => prev + 1);
    setSelectedFragment({ folderPath, fragmentName });
    PromptManager.reloadFragments().catch(() => undefined);
  };

  const handleFragmentDeleted = () => {
    setSelectedFragment(null);
    setRefreshTrigger((prev) => prev + 1);
    PromptManager.reloadFragments().catch(() => undefined);
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
    const pathToCopy = `{{prompt "${selectedPath}"}}`;
    try {
      await navigator.clipboard.writeText(pathToCopy);
      toast.success(t('common.copied', { value: pathToCopy }));
    } catch {
      toast.error(t('settings.promptEditor.toast.copyFailed'));
    }
  };

  const getEditorTitle = () => {
    if (subTab === 'prompts' && selectedPrompt) return selectedPrompt.label;
    if (subTab === 'fragments' && selectedPath) return selectedPath;
    return '';
  };

  const getEditorDescription = () => {
    if (subTab === 'prompts' && selectedPrompt?.description) return selectedPrompt.description;
    return null;
  };

  const hasSelection =
    (subTab === 'prompts' && selectedPrompt) ||
    (subTab === 'fragments' && selectedFragment) ||
    subTab === 'variables' ||
    subTab === 'subAgents';

  const canShowHeader = subTab !== 'variables' && subTab !== 'subAgents';

  const currentEditorContentLength = subTab === 'prompts' ? currentPromptDraft?.content.length : currentFragmentDraft?.content.length;
  const currentEditorDirty = subTab === 'prompts' ? currentPromptDraft?.dirty : currentFragmentDraft?.dirty;

  const currentVersionHistoryProps = useMemo(() => {
    if (subTab === 'prompts' && selectedPrompt && selectedPrompt.type === 'prompt' && selectedPrompt.taskType && selectedPrompt.category && selectedPrompt.name) {
      const taskType = selectedPrompt.taskType;
      const category = selectedPrompt.category;
      const name = selectedPrompt.name;
      const key = makePromptDraftKey(taskType, category, name);
      return {
        title: 'Prompt Version History',
        loadVersions: () => promptService.getVersionHistory(taskType, category, name),
        restoreVersion: async (vn: number) => {
          await promptService.restoreVersion(taskType, category, vn, name);
          const content = await loadPrompt(taskType, category, name);
          setPromptDrafts((prev) => {
            const cur = prev[key];
            if (!cur) return prev;
            return {
              ...prev,
              [key]: {
                ...cur,
                originalContent: content,
                content,
                dirty: false,
              },
            };
          });
        },
      };
    }

    if (subTab === 'fragments' && selectedFragment) {
      const folderPath = selectedFragment.folderPath;
      const fragmentName = selectedFragment.fragmentName;
      const key = makeFragmentDraftKey(folderPath, fragmentName);
      return {
        title: 'Fragment Version History',
        loadVersions: () => fragmentService.getVersionHistory(folderPath, fragmentName),
        restoreVersion: async (vn: number) => {
          await fragmentService.restoreVersion(folderPath, fragmentName, vn);
          const fragment = await fragmentService.getFragment(folderPath, fragmentName);
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
  }, [subTab, selectedPrompt, selectedFragment, loadPrompt]);

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
    const ok = window.confirm(`Are you sure you want to delete "${currentFragmentDraft.fullPath}"? This will delete all versions.`);
    if (!ok) return;

    const key = currentFragmentDraft.key;
    setFragmentDrafts((prev) => {
      const cur = prev[key];
      if (!cur) return prev;
      return { ...prev, [key]: { ...cur, isDeleting: true } };
    });

    try {
      await fragmentService.deleteFragment(currentFragmentDraft.folderPath, currentFragmentDraft.fragmentName);
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

      const shouldSave = window.confirm(`You have unsaved changes (${unsavedCount}). Save before switching presets?`);
      if (shouldSave) {
        const summary = await saveAllDrafts();
        if (summary.failed > 0) {
          const lines = summary.failures.map((f) => `- ${f.item.label}: ${f.error}`);
          window.alert(`Some items failed to save:\n\n${lines.join('\n')}`);
          return false;
        }
        return true;
      }

      const discard = window.confirm('Discard your unsaved changes and switch presets?');
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
      <div className="panel-header">
        <h3>{t('settings.promptEditor.title')}</h3>
        <p className="panel-description">{t('settings.promptEditor.description')}</p>
      </div>

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

                      {(currentPromptDraft || currentFragmentDraft) && (
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

                        {subTab === 'prompts' && selectedPrompt && currentPromptDraft && (
                          <IconButton
                            icon={<Eye size="sm" />}
                            onClick={() => setShowPreviewModal(true)}
                            title={t('settings.promptEditor.previewPrompt')}
                            size="sm"
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

                    <IconButton
                      icon={isSidebarCollapsed ? <ChevronLeft size="sm" /> : <ChevronRight size="sm" />}
                      onClick={toggleSidebar}
                      title={
                        isSidebarCollapsed
                          ? t('settings.promptEditor.expandSidebar')
                          : t('settings.promptEditor.collapseSidebar')
                      }
                      size="sm"
                    />
                  </div>
                </header>
              )}

              <div className="editor-wrapper__body">
                {subTab === 'prompts' && selectedPrompt && selectedPrompt.type === 'prompt' && (
                  <TemplateEditor
                    content={currentPromptDraft?.content || ''}
                    onContentChange={(text) => {
                      const taskType = selectedPrompt.taskType;
                      const category = selectedPrompt.category;
                      const name = selectedPrompt.name;
                      if (!taskType || !category || !name) return;

                      const draftKey = makePromptDraftKey(taskType, category, name);
                      setPromptDrafts((prev) => {
                        const cur = prev[draftKey];
                        if (!cur) {
                          return {
                            ...prev,
                            [draftKey]: {
                              key: draftKey,
                              label: selectedPrompt.label,
                              nodeId: selectedPrompt.id,
                              taskType,
                              category,
                              name,
                              isLoading: false,
                              originalContent: '',
                              content: text,
                              dirty: text !== '',
                              validation: null,
                            },
                          };
                        }
                        return {
                          ...prev,
                          [draftKey]: {
                            ...cur,
                            content: text,
                            dirty: text !== cur.originalContent,
                          },
                        };
                      });
                    }}
                    validation={currentPromptDraft?.validation ?? null}
                    isLoading={!currentPromptDraft || currentPromptDraft.isLoading}
                    placeholder={t('settings.promptEditor.enterPromptTemplate')}
                  />
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
                    promptIdentityName={subAgentPromptIdentityName}
                    promptDrafts={subAgentPromptDraftViews}
                    onPromptContentChange={handleSubAgentPromptContentChange}
                    onReloadPrompt={reloadSubAgentPrompt}
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
                        setPromptDrafts((prev) => {
                          const next = { ...prev };
                          delete next[makePromptDraftKey('subAgent', 'systemPrompt', name)];
                          delete next[makePromptDraftKey('subAgent', 'userPrompt', name)];
                          delete next[makePromptDraftKey('subAgent', 'prefill', name)];
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

      {showPreviewModal && selectedPrompt && currentPromptDraft && (
        <PromptPreviewModal
          isOpen={showPreviewModal}
          onClose={() => setShowPreviewModal(false)}
          templateContent={currentPromptDraft.content}
          promptNode={selectedPrompt}
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
