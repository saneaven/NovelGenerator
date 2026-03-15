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
import VariableEditor, {
  buildNewVariableDraft,
  buildVariableCreatePayload,
  buildVariableDefinitionUpdate,
  hydrateVariableDraft,
  type VariableDefinitionDraft,
} from './VariableEditor';
import SubAgentListNav from './SubAgentListNav';
import SubAgentEditor, {
  buildEmptySubAgentDraft,
  buildSubAgentPayload,
  hydrateSubAgentDraft,
  normalizeAgentName,
  type SubAgentDefinitionDraft,
} from './SubAgentEditor';
import McpServerListNav from './McpServerListNav';
import McpServersEditor, {
  buildMcpCreatePayload,
  buildMcpUpdatePayload,
  buildNewMcpDraft,
  hydrateMcpDraft,
  type McpServerDraft,
} from './McpServersEditor';
import TemplateEditor from './TemplateEditor';
import ScenarioBlocksEditor from './ScenarioBlocksEditor';
import EditorPanelHeader from './EditorPanelHeader';
import HeaderOverflowMenu from './HeaderOverflowMenu';
import PromptPreviewModal from './PromptPreviewModal';
import VersionHistoryModal from '../../Modal/VersionHistoryModal';
import PresetSelector from '../PresetSelector';
import PresetModal from '../PresetModal';
import { usePresetStore } from '../../../store/presetStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useMcpStore } from '../../../store/mcpStore';
import { useSubAgentStore } from '../../../store/subAgentStore';
import { useVariableStore } from '../../../store/variableStore';
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
import type { ScenarioDocument, TaskType } from '../../../types/scenarios';
import { extractFragmentReferences, validateTemplate } from '../../../templateEngine/engine';
import { useSettingsToast } from '../SettingsToastContext';
import { generateTempId } from '../../../utils/tempId';
import {
  makeFragmentDraftKey,
  makeMcpDraftKey,
  makeScenarioDraftKey,
  makeSubAgentDraftKey,
  makeVariableDraftKey,
  type DirtyItem,
  type SaveFailure,
  type SaveSummary,
} from './draftTypes';
import {
  DEFAULT_SUB_AGENT_ASSISTANT_TEMPLATE,
  DEFAULT_SUB_AGENT_SYSTEM_PROMPT,
  DEFAULT_SUB_AGENT_USER_PROMPT,
} from './subAgentDefaults';

type SubTab = 'prompts' | 'fragments' | 'variables' | 'subAgents' | 'mcp';

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
  sourceFolderId: string | null;
  sourceFragmentName: string | null;
  folderPath: string;
  fragmentName: string;
  fullPath: string;
  isLoading: boolean;
  isNew: boolean;
  loadError?: string;
  originalContent: string;
  originalDescription: string;
  content: string;
  description: string;
  dirty: boolean;
  validation: TemplateValidationResult | null;
  isDeleting: boolean;
};

function getDraftFragmentFullPath(draft: Pick<FragmentDraft, 'folderPath' | 'fragmentName'>): string {
  const name = draft.fragmentName.trim();
  const folderPath = draft.folderPath.trim().replace(/^\/+|\/+$/g, '');
  if (!folderPath) return name;
  return name ? `${folderPath}/${name}` : folderPath;
}

function getFragmentDraftLabel(draft: Pick<FragmentDraft, 'folderPath' | 'fragmentName'>): string {
  return getDraftFragmentFullPath(draft) || 'New Fragment';
}

function isFragmentDraftDirty(
  draft: Pick<FragmentDraft, 'isNew' | 'content' | 'originalContent' | 'description' | 'originalDescription' | 'fragmentName' | 'sourceFragmentName'>
): boolean {
  if (draft.isNew) return true;
  return (
    draft.content !== draft.originalContent
    || draft.description !== draft.originalDescription
    || draft.fragmentName !== (draft.sourceFragmentName || '')
  );
}

function getSubAgentScenarioLabel(displayName: string, agentName: string): string {
  const normalizedName = normalizeAgentName(agentName) || 'new_agent';
  const safeDisplayName = displayName.trim() || 'New';
  return `Sub Agent: ${safeDisplayName} / call_${normalizedName}`;
}

function buildDefaultSubAgentScenario(): ScenarioDocument {
  return {
    system_template: DEFAULT_SUB_AGENT_SYSTEM_PROMPT,
    blocks: [
      {
        id: generateTempId(),
        block_order: 0,
        enabled: true,
        type: 'rangeMapping',
        rangeMapping: {
          start_index: 0,
          end_index: -1,
          user_template: DEFAULT_SUB_AGENT_USER_PROMPT,
          assistant_template: DEFAULT_SUB_AGENT_ASSISTANT_TEMPLATE,
        },
      },
    ],
  };
}

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
  const getPresetById = usePresetStore((s) => s.getPresetById);
  const variables = useVariableStore((s) => s.variables);
  const loadVariables = useVariableStore((s) => s.loadVariables);
  const createVariable = useVariableStore((s) => s.createVariable);
  const updateVariableDefinition = useVariableStore((s) => s.updateDefinition);
  const subAgents = useSubAgentStore((s) => s.subAgents);
  const loadSubAgents = useSubAgentStore((s) => s.loadSubAgents);
  const createSubAgent = useSubAgentStore((s) => s.createSubAgent);
  const updateSubAgent = useSubAgentStore((s) => s.updateSubAgent);
  const mcpServers = useMcpStore((s) => s.servers);
  const ensureMcpLoaded = useMcpStore((s) => s.ensureLoaded);
  const createServer = useMcpStore((s) => s.createServer);
  const updateServer = useMcpStore((s) => s.updateServer);
  const mcpStoreError = useMcpStore((s) => s.error);

  const [subTab, setSubTab] = useState<SubTab>('prompts');
  const [selectedPrompt, setSelectedPrompt] = useState<PromptNode | null>(null);
  const [selectedFragment, setSelectedFragment] = useState<SelectedFragment | null>(null);
  const [selectedVariableId, setSelectedVariableId] = useState<string | null>(null);
  const [selectedSubAgentId, setSelectedSubAgentId] = useState<string | null>(null);
  const [selectedMcpServerId, setSelectedMcpServerId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [newFragmentDraft, setNewFragmentDraft] = useState<FragmentDraft | null>(null);
  const [newVariableDraft, setNewVariableDraft] = useState<VariableDefinitionDraft | null>(null);
  const [newSubAgentDraft, setNewSubAgentDraft] = useState<SubAgentDefinitionDraft | null>(null);
  const [newMcpDraft, setNewMcpDraft] = useState<McpServerDraft | null>(null);
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
  const [subAgentScenarioDrafts, setSubAgentScenarioDrafts] = useState<Record<string, ScenarioDraft>>({});
  const [fragmentDrafts, setFragmentDrafts] = useState<Record<string, FragmentDraft>>({});
  const [variableDrafts, setVariableDrafts] = useState<Record<string, VariableDefinitionDraft>>({});
  const [subAgentDrafts, setSubAgentDrafts] = useState<Record<string, SubAgentDefinitionDraft>>({});
  const [mcpDrafts, setMcpDrafts] = useState<Record<string, McpServerDraft>>({});
  const scenarioDraftsRef = useRef(scenarioDrafts);
  const subAgentScenarioDraftsRef = useRef(subAgentScenarioDrafts);
  const fragmentDraftsRef = useRef(fragmentDrafts);
  const variableDraftsRef = useRef(variableDrafts);
  const subAgentDraftsRef = useRef(subAgentDrafts);
  const mcpDraftsRef = useRef(mcpDrafts);
  const variablesRef = useRef(variables);
  const subAgentsRef = useRef(subAgents);
  const mcpServersRef = useRef(mcpServers);
  useEffect(() => {
    scenarioDraftsRef.current = scenarioDrafts;
  }, [scenarioDrafts]);
  useEffect(() => {
    subAgentScenarioDraftsRef.current = subAgentScenarioDrafts;
  }, [subAgentScenarioDrafts]);
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
    mcpDraftsRef.current = mcpDrafts;
  }, [mcpDrafts]);
  useEffect(() => {
    variablesRef.current = variables;
  }, [variables]);
  useEffect(() => {
    subAgentsRef.current = subAgents;
  }, [subAgents]);
  useEffect(() => {
    mcpServersRef.current = mcpServers;
  }, [mcpServers]);
  useEffect(() => {
    setMcpDrafts((prev) => {
      const next: Record<string, McpServerDraft> = {};
      for (const server of mcpServers) {
        const key = makeMcpDraftKey(server.id);
        next[key] = prev[key]?.dirty ? prev[key] : hydrateMcpDraft(server, key);
      }
      return next;
    });
  }, [mcpServers]);

  const savingRef = useRef(false);

  // Version history modal
  const [showVersionHistory, setShowVersionHistory] = useState(false);


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
    setSubAgentScenarioDrafts({});
    setFragmentDrafts({});
    setVariableDrafts({});
    setSubAgentDrafts({});
    setMcpDrafts({});
    setNewFragmentDraft(null);
    setNewVariableDraft(null);
    setNewSubAgentDraft(null);
    setNewMcpDraft(null);
    setSelectedFragment(null);
    setSelectedVariableId(null);
    setSelectedSubAgentId(null);
    setSelectedMcpServerId(null);
    setShowVersionHistory(false);
    setRefreshTrigger((prev) => prev + 1);
    loadFragmentContents().catch(() => undefined);
    loadVariables().catch(() => undefined);
    loadSubAgents().catch(() => undefined);
    if (activePresetId) {
      ensureMcpLoaded(activePresetId).catch(() => undefined);
    }
  }, [activePresetId, ensureMcpLoaded, loadFragmentContents, loadSubAgents, loadVariables]);

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

  const selectedMcpKey = useMemo(() => {
    if (!selectedMcpServerId) return null;
    return makeMcpDraftKey(selectedMcpServerId);
  }, [selectedMcpServerId]);

  const currentScenarioDraft = selectedPromptKey ? scenarioDrafts[selectedPromptKey] : null;
  const currentFragmentDraft = selectedFragmentKey ? fragmentDrafts[selectedFragmentKey] : newFragmentDraft;
  const currentVariableDraft = selectedVariableKey ? variableDrafts[selectedVariableKey] : newVariableDraft;
  const currentSubAgentDraft = selectedSubAgentKey ? subAgentDrafts[selectedSubAgentKey] : newSubAgentDraft;
  const currentMcpDraft = selectedMcpKey ? mcpDrafts[selectedMcpKey] : newMcpDraft;
  const currentSubAgentScenarioKey = selectedSubAgentKey ?? newSubAgentDraft?.draftKey ?? null;
  const currentSubAgentScenarioDraft = currentSubAgentScenarioKey ? subAgentScenarioDrafts[currentSubAgentScenarioKey] : null;

  const selectedSubAgent = useMemo(() => {
    if (!selectedSubAgentId) return null;
    return subAgents.find((s) => s.id === selectedSubAgentId) || null;
  }, [selectedSubAgentId, subAgents]);

  const selectedMcpSnapshot = useMemo(() => {
    if (!selectedMcpServerId) return null;
    return mcpServers.find((server) => server.id === selectedMcpServerId)?.snapshot ?? null;
  }, [mcpServers, selectedMcpServerId]);

  const subAgentIdentityName = useMemo(() => {
    return currentSubAgentDraft?.isNew
      ? normalizeAgentName(currentSubAgentDraft.current.agent_name) || null
      : currentSubAgentDraft?.original.agent_name || selectedSubAgent?.agent_name || null;
  }, [currentSubAgentDraft, selectedSubAgent]);

  const handleSubAgentDraftChange = useCallback((draft: SubAgentDefinitionDraft) => {
    const scenarioLabel = getSubAgentScenarioLabel(draft.current.display_name, draft.current.agent_name);
    const scenarioTaskSubtype = normalizeAgentName(draft.current.agent_name) || 'new_agent';
    if (draft.isNew) {
      setNewSubAgentDraft(draft);
      setSubAgentScenarioDrafts((prev) => {
        const current = prev[draft.draftKey];
        if (!current) return prev;
        return {
          ...prev,
          [draft.draftKey]: {
            ...current,
            label: scenarioLabel,
            taskSubtype: scenarioTaskSubtype,
          },
        };
      });
      return;
    }
    if (!draft.subAgentId) return;
    const draftKey = makeSubAgentDraftKey(draft.subAgentId);
    setSubAgentDrafts((prev) => ({
      ...prev,
      [draftKey]: draft,
    }));
    setSubAgentScenarioDrafts((prev) => {
      const current = prev[draftKey];
      if (!current) return prev;
      return {
        ...prev,
        [draftKey]: {
          ...current,
          label: scenarioLabel,
        },
      };
    });
  }, []);

  const unsavedCount = useMemo(() => {
    const promptCount = Object.values(scenarioDrafts).filter((d) => d.dirty).length;
    const subAgentPromptCount = Object.values(subAgentScenarioDrafts).filter((d) => d.dirty).length;
    const fragmentCount = Object.values(fragmentDrafts).filter((d) => d.dirty).length + (newFragmentDraft?.dirty ? 1 : 0);
    const variableCount = Object.values(variableDrafts).filter((d) => d.dirty).length + (newVariableDraft?.dirty ? 1 : 0);
    const subAgentCount = Object.values(subAgentDrafts).filter((d) => d.dirty).length + (newSubAgentDraft?.dirty ? 1 : 0);
    const mcpCount = Object.values(mcpDrafts).filter((d) => d.dirty).length + (newMcpDraft?.dirty ? 1 : 0);
    return promptCount + subAgentPromptCount + fragmentCount + variableCount + subAgentCount + mcpCount;
  }, [scenarioDrafts, subAgentScenarioDrafts, fragmentDrafts, newFragmentDraft, subAgentDrafts, newSubAgentDraft, variableDrafts, newVariableDraft, mcpDrafts, newMcpDraft]);

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
    for (const d of Object.values(subAgentScenarioDraftsRef.current)) {
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
    if (newFragmentDraft?.dirty) {
      dirty.push({
        kind: 'fragment',
        key: newFragmentDraft.key,
        label: newFragmentDraft.label,
        folderId: newFragmentDraft.folderId,
        fragmentName: newFragmentDraft.fragmentName,
        fullPath: newFragmentDraft.fullPath,
      });
    }
    for (const d of Object.values(variableDraftsRef.current)) {
      if (!d.dirty) continue;
      dirty.push({
        kind: 'variable',
        key: d.draftKey,
        label: d.current.name || d.original.name || d.variableId || d.draftKey,
        variableId: d.variableId || d.draftKey,
      });
    }
    if (newVariableDraft?.dirty) {
      dirty.push({
        kind: 'variable',
        key: newVariableDraft.draftKey,
        label: newVariableDraft.current.name || 'New Variable',
        variableId: newVariableDraft.variableId || newVariableDraft.draftKey,
      });
    }
    for (const d of Object.values(subAgentDraftsRef.current)) {
      if (!d.dirty) continue;
      dirty.push({
        kind: 'subAgent',
        key: d.draftKey,
        label: d.current.display_name || d.original.display_name || d.subAgentId || d.draftKey,
        subAgentId: d.subAgentId || d.draftKey,
      });
    }
    if (newSubAgentDraft?.dirty) {
      dirty.push({
        kind: 'subAgent',
        key: newSubAgentDraft.draftKey,
        label: newSubAgentDraft.current.display_name || 'New Sub Agent',
        subAgentId: newSubAgentDraft.subAgentId || newSubAgentDraft.draftKey,
      });
    }
    for (const d of Object.values(mcpDraftsRef.current)) {
      if (!d.dirty) continue;
      dirty.push({
        kind: 'mcp',
        key: d.draftKey,
        label: d.current.display_name || d.current.server_key || d.draftKey,
        serverId: d.serverId || d.draftKey,
      });
    }
    if (newMcpDraft?.dirty) {
      dirty.push({
        kind: 'mcp',
        key: newMcpDraft.draftKey,
        label: newMcpDraft.current.display_name || newMcpDraft.current.server_key || 'New MCP Server',
        serverId: newMcpDraft.serverId || newMcpDraft.draftKey,
      });
    }
    return dirty;
  }, [newFragmentDraft, newMcpDraft, newSubAgentDraft, newVariableDraft]);

  const discardAllDrafts = useCallback(() => {
    setScenarioDrafts((prev) => {
      const next: Record<string, ScenarioDraft> = { ...prev };
      for (const [k, d] of Object.entries(next)) {
        if (!d.dirty) continue;
        next[k] = { ...d, scenario: d.originalScenario, dirty: false, saveWarnings: [] };
      }
      return next;
    });
    setSubAgentScenarioDrafts((prev) => {
      const next: Record<string, ScenarioDraft> = { ...prev };
      for (const [k, d] of Object.entries(next)) {
        if (!d.dirty) continue;
        next[k] = { ...d, scenario: d.originalScenario, dirty: false, saveWarnings: [] };
      }
      if (newSubAgentDraft) {
        delete next[newSubAgentDraft.draftKey];
      }
      return next;
    });
    setFragmentDrafts((prev) => {
      const next: Record<string, FragmentDraft> = { ...prev };
      for (const [k, d] of Object.entries(next)) {
        if (!d.dirty) continue;
        const fragmentName = d.sourceFragmentName || d.fragmentName;
        const fullPath = getDraftFragmentFullPath({ folderPath: d.folderPath, fragmentName });
        next[k] = {
          ...d,
          label: getFragmentDraftLabel({ folderPath: d.folderPath, fragmentName }),
          fragmentName,
          fullPath,
          content: d.originalContent,
          description: d.originalDescription,
          dirty: false,
          loadError: undefined,
        };
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
            allowed_mcp_server_ids: [...d.original.allowed_mcp_server_ids],
          },
          dirty: false,
          error: '',
        };
      }
      return next;
    });
    setMcpDrafts((prev) => {
      const next: Record<string, McpServerDraft> = { ...prev };
      for (const [k, d] of Object.entries(next)) {
        if (!d.dirty) continue;
        next[k] = {
          ...d,
          current: { ...d.original },
          dirty: false,
          error: '',
          isSyncing: false,
        };
      }
      return next;
    });
    setNewFragmentDraft(null);
    setNewVariableDraft(null);
    setNewSubAgentDraft(null);
    setNewMcpDraft(null);
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

      const dirtyExistingSubAgentPromptScenarios = Object.values(subAgentScenarioDraftsRef.current).filter((d) => {
        if (!d.dirty) return false;
        return d.key !== newSubAgentDraft?.draftKey;
      });
      for (const d of dirtyExistingSubAgentPromptScenarios) {
        attempted += 1;
        try {
          const result = await scenarioService.saveScenario(d.taskType, d.taskSubtype, d.scenario);
          invalidateScenarioCache(d.taskType, d.taskSubtype);
          saved += 1;
          setSubAgentScenarioDrafts((prev) => {
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
              key: d.draftKey,
              label: d.current.display_name || d.original.display_name || d.subAgentId || d.draftKey,
              subAgentId: d.subAgentId || d.draftKey,
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
          const updated = await updateSubAgent(d.subAgentId!, {
            agent_name,
            display_name: d.current.display_name.trim(),
            description: d.current.description.trim(),
            enabled: d.current.enabled,
            allowed_invocation_modes: d.current.allowed_invocation_modes,
            allowed_tool_names: d.current.allowed_tool_names.filter((n) => !n.startsWith('call_')),
            allowed_sub_agent_ids: d.current.allowed_sub_agent_ids,
            allowed_mcp_server_ids: d.current.allowed_mcp_server_ids,
            use_custom_llm_config: d.current.use_custom_llm_config,
            llm_config_override: d.current.llm_config_override,
          });

          saved += 1;
          setSubAgentScenarioDrafts((prev) => {
            const key = makeSubAgentDraftKey(d.subAgentId!);
            const cur = prev[key];
            if (!cur) return prev;
            return {
              ...prev,
              [key]: {
                ...cur,
                label: getSubAgentScenarioLabel(updated.display_name, updated.agent_name),
                taskSubtype: updated.agent_name,
              },
            };
          });
          setSubAgentDrafts((prev) => {
            const key = makeSubAgentDraftKey(d.subAgentId!);
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
              allowed_mcp_server_ids: [...updated.allowed_mcp_server_ids],
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
                  allowed_mcp_server_ids: [...base.allowed_mcp_server_ids],
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
              key: d.draftKey,
              label: d.current.display_name || d.original.display_name || d.subAgentId || d.draftKey,
              subAgentId: d.subAgentId || d.draftKey,
            },
            error: toErrorMessage(error),
          });
          setSubAgentDrafts((prev) => {
            const key = makeSubAgentDraftKey(d.subAgentId!);
            const cur = prev[key];
            if (!cur) return prev;
            return {
              ...prev,
              [key]: {
                ...cur,
                error: toErrorMessage(error),
              },
            };
          });
        }
      }

      if (newSubAgentDraft?.dirty) {
        attempted += 1;
        if (newSubAgentDraft.error) {
          failures.push({
            item: {
              kind: 'subAgent',
              key: newSubAgentDraft.draftKey,
              label: newSubAgentDraft.current.display_name || 'New Sub Agent',
              subAgentId: newSubAgentDraft.draftKey,
            },
            error: newSubAgentDraft.error,
          });
        } else {
          try {
            const scenarioDraft = subAgentScenarioDraftsRef.current[newSubAgentDraft.draftKey];
            const scenario = scenarioDraft?.scenario;
            const rangeBlock = scenario?.blocks.find((block) => block.type === 'rangeMapping' && block.rangeMapping);
            const created = await createSubAgent({
              ...buildSubAgentPayload(newSubAgentDraft),
              prompt_templates: scenario ? {
                system_prompt: scenario.system_template || DEFAULT_SUB_AGENT_SYSTEM_PROMPT,
                user_prompt: rangeBlock?.type === 'rangeMapping'
                  ? rangeBlock.rangeMapping?.user_template || DEFAULT_SUB_AGENT_USER_PROMPT
                  : DEFAULT_SUB_AGENT_USER_PROMPT,
              } : {
                system_prompt: DEFAULT_SUB_AGENT_SYSTEM_PROMPT,
                user_prompt: DEFAULT_SUB_AGENT_USER_PROMPT,
              },
            });
            saved += 1;
            setNewSubAgentDraft(null);
            setSubAgentScenarioDrafts((prev) => {
              const next = { ...prev };
              delete next[newSubAgentDraft.draftKey];
              return next;
            });
            setSelectedSubAgentId(created.id);
          } catch (error) {
            failures.push({
              item: {
                kind: 'subAgent',
                key: newSubAgentDraft.draftKey,
                label: newSubAgentDraft.current.display_name || 'New Sub Agent',
                subAgentId: newSubAgentDraft.draftKey,
              },
              error: toErrorMessage(error),
            });
            setNewSubAgentDraft((prev) => (prev ? { ...prev, error: toErrorMessage(error) } : prev));
          }
        }
      }

      const dirtyFragments = [
        ...Object.values(fragmentDraftsRef.current).filter((d) => d.dirty),
        ...(newFragmentDraft?.dirty ? [newFragmentDraft] : []),
      ];
      let didSaveAnyFragment = false;
      for (const d of dirtyFragments) {
        attempted += 1;
        const trimmedName = d.fragmentName.trim();
        const applyFragmentError = (message: string) => {
          if (d.isNew) {
            setNewFragmentDraft((prev) => (prev?.key === d.key ? { ...prev, loadError: message } : prev));
            return;
          }
          setFragmentDrafts((prev) => {
            const cur = prev[d.key];
            if (!cur) return prev;
            return { ...prev, [d.key]: { ...cur, loadError: message } };
          });
        };

        if (!trimmedName) {
          const errorMessage = t('settings.promptEditor.createFragment.nameRequired');
          failures.push({
            item: {
              kind: 'fragment',
              key: d.key,
              label: d.label,
              folderId: d.folderId,
              fragmentName: d.fragmentName,
              fullPath: d.fullPath,
            },
            error: errorMessage,
          });
          applyFragmentError(errorMessage);
          continue;
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
          const errorMessage = t('settings.promptEditor.createFragment.invalidName');
          failures.push({
            item: {
              kind: 'fragment',
              key: d.key,
              label: d.label,
              folderId: d.folderId,
              fragmentName: d.fragmentName,
              fullPath: d.fullPath,
            },
            error: errorMessage,
          });
          applyFragmentError(errorMessage);
          continue;
        }
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
          if (d.isNew) {
            setNewFragmentDraft((prev) => (prev?.key === d.key ? { ...prev, validation, loadError: validation.errors[0]?.message } : prev));
          } else {
            setFragmentDrafts((prev) => {
              const cur = prev[d.key];
              if (!cur) return prev;
              return { ...prev, [d.key]: { ...cur, validation, loadError: validation.errors[0]?.message } };
            });
          }
          continue;
        }

        try {
          if (d.isNew) {
            const created = await fragmentService.createFragment(
              { folderPath: d.folderPath.trim() || null },
              trimmedName,
              d.content,
              d.description || undefined,
              'Initial creation'
            );
            setNewFragmentDraft(null);
            setSelectedFragment({
              folderId: created.folder_id,
              fragmentName: created.fragment_name,
              fullPath: created.folder_path ? `${created.folder_path}/${created.fragment_name}` : created.fragment_name,
            });
          } else {
            const updated = await fragmentService.updateFragment(d.sourceFolderId, d.sourceFragmentName!, {
              content: d.content,
              description: d.description || undefined,
              fragment_name: trimmedName !== d.sourceFragmentName ? trimmedName : undefined,
            });
            const nextFullPath = updated.folder_path ? `${updated.folder_path}/${updated.fragment_name}` : updated.fragment_name;
            const nextKey = makeFragmentDraftKey(updated.folder_id, updated.fragment_name);
            setFragmentDrafts((prev) => {
              const cur = prev[d.key];
              if (!cur) return prev;
              const nextDraft: FragmentDraft = {
                ...cur,
                key: nextKey,
                label: nextFullPath,
                folderId: updated.folder_id,
                sourceFolderId: updated.folder_id,
                sourceFragmentName: updated.fragment_name,
                folderPath: updated.folder_path || '',
                fragmentName: updated.fragment_name,
                fullPath: nextFullPath,
                originalContent: updated.content,
                originalDescription: updated.description || '',
                content: updated.content,
                description: updated.description || '',
                dirty: false,
                validation,
                loadError: undefined,
              };
              if (nextKey === d.key) {
                return {
                  ...prev,
                  [d.key]: nextDraft,
                };
              }
              const next = { ...prev };
              delete next[d.key];
              next[nextKey] = nextDraft;
              return {
                ...next,
              };
            });
            setSelectedFragment({
              folderId: updated.folder_id,
              fragmentName: updated.fragment_name,
              fullPath: nextFullPath,
            });
          }
          didSaveAnyFragment = true;
          saved += 1;
        } catch (error) {
          const errorMessage = toErrorMessage(error);
          failures.push({
            item: {
              kind: 'fragment',
              key: d.key,
              label: d.label,
              folderId: d.folderId,
              fragmentName: d.fragmentName,
              fullPath: d.fullPath,
            },
            error: errorMessage,
          });
          applyFragmentError(errorMessage);
        }
      }

      if (didSaveAnyFragment) {
        await loadFragmentContents();
        setRefreshTrigger((prev) => prev + 1);
      }

      const dirtyVariables = [
        ...Object.values(variableDraftsRef.current).filter((d) => d.dirty),
        ...(newVariableDraft?.dirty ? [newVariableDraft] : []),
      ];
      for (const d of dirtyVariables) {
        attempted += 1;

        const name = d.current.name.trim();
        if (!name) {
          if (d.isNew) {
            setNewVariableDraft((prev) => (prev?.draftKey === d.draftKey ? { ...prev, error: 'Name is required' } : prev));
          }
          failures.push({
            item: {
              kind: 'variable',
              key: d.draftKey,
              label: d.current.name || d.original.name || d.variableId || d.draftKey,
              variableId: d.variableId || d.draftKey,
            },
            error: 'Name is required',
          });
          continue;
        }

        if (d.error) {
          failures.push({
            item: {
              kind: 'variable',
              key: d.draftKey,
              label: d.current.name || d.original.name || d.variableId || d.draftKey,
              variableId: d.variableId || d.draftKey,
            },
            error: d.error,
          });
          continue;
        }

        try {
          if (d.isNew) {
            const created = await createVariable(buildVariableCreatePayload(d));
            setNewVariableDraft(null);
            setSelectedVariableId(created.id);
          } else {
            await updateVariableDefinition(d.variableId!, buildVariableDefinitionUpdate(d));
            setVariableDrafts((prev) => {
              const key = makeVariableDraftKey(d.variableId!);
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
          }
          saved += 1;
        } catch (error) {
          failures.push({
            item: {
              kind: 'variable',
              key: d.draftKey,
              label: d.current.name || d.original.name || d.variableId || d.draftKey,
              variableId: d.variableId || d.draftKey,
            },
            error: toErrorMessage(error),
          });
          if (d.isNew) {
            setNewVariableDraft((prev) => (prev?.draftKey === d.draftKey ? { ...prev, error: toErrorMessage(error) } : prev));
          } else {
            setVariableDrafts((prev) => {
              const cur = prev[d.draftKey];
              if (!cur) return prev;
              return {
                ...prev,
                [d.draftKey]: {
                  ...cur,
                  error: toErrorMessage(error),
                },
              };
            });
          }
        }
      }

      const dirtyMcpDrafts = [
        ...Object.values(mcpDraftsRef.current).filter((d) => d.dirty),
        ...(newMcpDraft?.dirty ? [newMcpDraft] : []),
      ];
      for (const d of dirtyMcpDrafts) {
        attempted += 1;

        if (d.error) {
          failures.push({
            item: {
              kind: 'mcp',
              key: d.draftKey,
              label: d.current.display_name || d.current.server_key || d.draftKey,
              serverId: d.serverId || d.draftKey,
            },
            error: d.error,
          });
          continue;
        }

        try {
          if (!activePresetId) {
            throw new Error('No active preset selected');
          }
          if (d.isNew) {
            const created = await createServer(activePresetId, buildMcpCreatePayload(d));
            setNewMcpDraft(null);
            setSelectedMcpServerId(created.id);
          } else {
            const updated = await updateServer(activePresetId, d.serverId!, buildMcpUpdatePayload(d));
            setMcpDrafts((prev) => ({
              ...prev,
              [d.draftKey]: hydrateMcpDraft(updated, d.draftKey),
            }));
          }
          saved += 1;
        } catch (error) {
          failures.push({
            item: {
              kind: 'mcp',
              key: d.draftKey,
              label: d.current.display_name || d.current.server_key || d.draftKey,
              serverId: d.serverId || d.draftKey,
            },
            error: toErrorMessage(error),
          });
          if (d.isNew) {
            setNewMcpDraft((prev) => (prev?.draftKey === d.draftKey ? { ...prev, error: toErrorMessage(error) } : prev));
          } else {
            setMcpDrafts((prev) => {
              const cur = prev[d.draftKey];
              if (!cur) return prev;
              return {
                ...prev,
                [d.draftKey]: {
                  ...cur,
                  error: toErrorMessage(error),
                  isSyncing: false,
                },
              };
            });
          }
        }
      }

      return { attempted, saved, failed: attempted - saved, failures };
    } finally {
      savingRef.current = false;
    }
  }, [activePresetId, createServer, createSubAgent, createVariable, invalidateScenarioCache, loadFragmentContents, newFragmentDraft, newMcpDraft, newSubAgentDraft, newVariableDraft, t, updateServer, updateSubAgent, updateVariableDefinition]);

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
        sourceFolderId: folderId,
        sourceFragmentName: fragmentName,
        folderPath: fullPath.includes('/') ? fullPath.slice(0, fullPath.lastIndexOf('/')) : '',
        fragmentName,
        fullPath,
        isLoading: true,
        isNew: false,
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

      setVariableDrafts((prev) => ({
        ...prev,
        [key]: hydrateVariableDraft(variable, key),
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

      setSubAgentDrafts((prev) => ({
        ...prev,
        [key]: hydrateSubAgentDraft(agent, key),
      }));
    },
    [loadSubAgents]
  );

  const ensureSubAgentScenarioDraftLoaded = useCallback(
    async (subAgentId: string, label: string) => {
      const key = makeSubAgentDraftKey(subAgentId);
      if (subAgentScenarioDraftsRef.current[key]) return;

      const agent = subAgentsRef.current.find((item) => item.id === subAgentId);
      if (!agent) return;

      const emptyScenario: ScenarioDocument = { system_template: '', blocks: [] };
      setSubAgentScenarioDrafts((prev) => ({
        ...prev,
        [key]: {
          key,
          label,
          taskType: 'subAgent',
          taskSubtype: agent.agent_name,
          isLoading: true,
          originalScenario: emptyScenario,
          scenario: emptyScenario,
          dirty: false,
          saveWarnings: [],
        },
      }));

      try {
        const loaded = await loadScenario('subAgent', agent.agent_name);
        setSubAgentScenarioDrafts((prev) => ({
          ...prev,
          [key]: {
            ...(prev[key] as ScenarioDraft),
            isLoading: false,
            loadError: undefined,
            originalScenario: loaded,
            scenario: loaded,
            dirty: false,
            saveWarnings: [],
          },
        }));
      } catch (error) {
        setSubAgentScenarioDrafts((prev) => ({
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
    ensureSubAgentScenarioDraftLoaded(
      selectedSubAgentId,
      `Sub Agent: ${displayName} / call_${subAgentIdentityName}`
    );
  }, [currentSubAgentDraft?.current.display_name, ensureSubAgentScenarioDraftLoaded, selectedSubAgent?.display_name, selectedSubAgentId, subAgentIdentityName]);

  useEffect(() => {
    if (!newSubAgentDraft) return;
    const label = getSubAgentScenarioLabel(newSubAgentDraft.current.display_name, newSubAgentDraft.current.agent_name);
    const taskSubtype = normalizeAgentName(newSubAgentDraft.current.agent_name) || 'new_agent';
    setSubAgentScenarioDrafts((prev) => {
      const current = prev[newSubAgentDraft.draftKey];
      if (current) {
        return {
          ...prev,
          [newSubAgentDraft.draftKey]: {
            ...current,
            label,
            taskSubtype,
          },
        };
      }
      const baseScenario = buildDefaultSubAgentScenario();
      return {
        ...prev,
        [newSubAgentDraft.draftKey]: {
          key: newSubAgentDraft.draftKey,
          label,
          taskType: 'subAgent',
          taskSubtype,
          isLoading: false,
          originalScenario: baseScenario,
          scenario: baseScenario,
          dirty: false,
          saveWarnings: [],
        },
      };
    });
  }, [newSubAgentDraft]);

  useEffect(() => {
    if (!currentFragmentDraft || currentFragmentDraft.isLoading) return;
    const key = currentFragmentDraft.key;
    const timer = window.setTimeout(async () => {
      const validation = await validateFragmentContent(currentFragmentDraft.content, currentFragmentDraft.fullPath, fragmentDraftsRef.current, allFragmentContentsRef.current);
      if (currentFragmentDraft.isNew) {
        setNewFragmentDraft((prev) => (prev?.key === key ? { ...prev, validation } : prev));
      } else {
        setFragmentDrafts((prev) => {
          const cur = prev[key];
          if (!cur) return prev;
          return { ...prev, [key]: { ...cur, validation } };
        });
      }
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
    if (newFragmentDraft) {
      setSelectedFragment(null);
      if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
      return;
    }

    const tempId = generateTempId();
    const draft: FragmentDraft = {
      key: `fragment:${tempId}`,
      label: getFragmentDraftLabel({ folderPath: folderPath || '', fragmentName: '' }),
      folderId: null,
      sourceFolderId: null,
      sourceFragmentName: null,
      folderPath: folderPath || '',
      fragmentName: '',
      fullPath: '',
      isLoading: false,
      isNew: true,
      originalContent: '',
      originalDescription: '',
      content: '',
      description: '',
      dirty: true,
      validation: null,
      isDeleting: false,
    };
    setNewFragmentDraft(draft);
    setSelectedFragment(null);
    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
  };

  const handleFragmentDeleted = () => {
    setSelectedFragment(null);
    setRefreshTrigger((prev) => prev + 1);
    loadFragmentContents().catch(() => undefined);
  };

  const handleCreateVariable = () => {
    if (newVariableDraft) {
      setSelectedVariableId(null);
      if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
      return;
    }
    setNewVariableDraft(buildNewVariableDraft(makeVariableDraftKey(generateTempId())));
    setSelectedVariableId(null);
    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
  };

  const handleCreateSubAgent = () => {
    if (newSubAgentDraft) {
      setSelectedSubAgentId(null);
      if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
      return;
    }
    setNewSubAgentDraft(buildEmptySubAgentDraft(makeSubAgentDraftKey(generateTempId())));
    setSelectedSubAgentId(null);
    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
  };

  const handleCreateMcpServer = () => {
    if (newMcpDraft) {
      setSelectedMcpServerId(null);
      if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
      return;
    }
    setNewMcpDraft(buildNewMcpDraft(makeMcpDraftKey(generateTempId())));
    setSelectedMcpServerId(null);
    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
  };

  const handleFolderDeleted = (deletedFolderPath: string) => {
    setFragmentDrafts((prev) => Object.fromEntries(
      Object.entries(prev).filter(([, draft]) => !draft.fullPath.startsWith(`${deletedFolderPath}/`))
    ));
    setNewFragmentDraft((prev) => {
      if (!prev) return null;
      return prev.fullPath.startsWith(`${deletedFolderPath}/`) ? null : prev;
    });
    setSelectedFragment((prev) => {
      if (!prev) return null;
      return prev.fullPath.startsWith(`${deletedFolderPath}/`) ? null : prev;
    });
    setShowVersionHistory(false);
    loadFragmentContents().catch(() => undefined);
  };

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  const handleSubTabChange = (newTab: SubTab) => {
    setSubTab(newTab);
  };

  const handleCopyFragmentPath = async () => {
    const fragmentPath = currentFragmentDraft?.fullPath;
    if (!fragmentPath) return;
    const pathToCopy = `{% include "${toFragmentReference(fragmentPath)}" %}`;
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
    if (subTab === 'prompts') return t('settings.promptEditor.prompts');
    if (subTab === 'fragments' && currentFragmentDraft?.isNew) return 'New Fragment';
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
    (subTab === 'fragments' && currentFragmentDraft) ||
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

  const updateCurrentFragmentDraft = useCallback((updater: (draft: FragmentDraft) => FragmentDraft) => {
    if (!currentFragmentDraft) return;
    if (currentFragmentDraft.isNew) {
      setNewFragmentDraft((prev) => {
        if (!prev || prev.key !== currentFragmentDraft.key) return prev;
        return updater(prev);
      });
      return;
    }
    setFragmentDrafts((prev) => {
      const cur = prev[currentFragmentDraft.key];
      if (!cur) return prev;
      return {
        ...prev,
        [currentFragmentDraft.key]: updater(cur),
      };
    });
  }, [currentFragmentDraft]);

  const handleDescriptionChange = useCallback((value: string) => {
    if (!currentFragmentDraft) return;
    updateCurrentFragmentDraft((draft) => ({
      ...draft,
      description: value,
      dirty: isFragmentDraftDirty({
        ...draft,
        description: value,
      }),
      loadError: undefined,
    }));
  }, [currentFragmentDraft, updateCurrentFragmentDraft]);

  const handleFragmentNameChange = useCallback((value: string) => {
    if (!currentFragmentDraft || currentFragmentDraft.isNew) return;
    updateCurrentFragmentDraft((draft) => {
      const nextDraft = {
        ...draft,
        fragmentName: value,
      };
      const fullPath = getDraftFragmentFullPath(nextDraft);
      return {
        ...nextDraft,
        fullPath,
        label: getFragmentDraftLabel(nextDraft),
        dirty: isFragmentDraftDirty({
          ...nextDraft,
          fragmentName: value,
        }),
        loadError: undefined,
      };
    });
  }, [currentFragmentDraft, updateCurrentFragmentDraft]);

  const handleDeleteSelectedFragment = async () => {
    if (!currentFragmentDraft) return;
    if (currentFragmentDraft.isNew) {
      setNewFragmentDraft(null);
      return;
    }
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
      await fragmentService.deleteFragment(currentFragmentDraft.sourceFolderId, currentFragmentDraft.sourceFragmentName!);
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
      // cleanup handled by EditorPanelHeader internally
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

  const editorHeaderMeta = (currentScenarioDraft || currentFragmentDraft) ? (
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

  if (subTab === 'fragments' && currentFragmentDraft?.fullPath) {
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
      disabled: currentFragmentDraft?.isDeleting,
    });
  }

  if (isBlocksPromptView) {
    editorHeaderActionsList.push(
      <div key="blocks-actions" ref={blocksHeaderActionsRef} className="editor-wrapper__blocks-actions" />
    );
  }

  if (subTab === 'fragments' && currentFragmentDraft) {
    editorHeaderMenuItems.push({
      key: 'delete-fragment',
      icon: <Trash size="sm" />,
      label: currentFragmentDraft.isNew ? 'Discard' : t('settings.promptEditor.deleteFragment'),
      onClick: handleDeleteSelectedFragment,
      disabled: currentFragmentDraft.isDeleting,
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
                    subTab === 'fragments' && currentFragmentDraft && !currentFragmentDraft.isNew
                      ? currentFragmentDraft.fragmentName
                      : getEditorTitle()
                  }
                  editableTitle={subTab === 'fragments' && !!currentFragmentDraft && !currentFragmentDraft.isNew}
                  titleStaticPrefix={
                    subTab === 'fragments' && currentFragmentDraft && !currentFragmentDraft.isNew && currentFragmentDraft.folderPath
                      ? `${currentFragmentDraft.folderPath}/`
                      : undefined
                  }
                  onTitleChange={currentFragmentDraft && !currentFragmentDraft.isNew ? handleFragmentNameChange : undefined}
                  titlePlaceholder={t('settings.promptEditor.createFragment.fragmentNamePlaceholder')}
                  editTitleLabel={t('settings.promptEditor.editFragmentName')}
                  subtitle={
                    subTab === 'fragments' && currentFragmentDraft
                      ? (currentFragmentDraft.isNew ? undefined : (currentFragmentDraft.description || ''))
                      : (subTab === 'prompts' && selectedPrompt ? (getEditorDescription() || undefined) : undefined)
                  }
                  editableSubtitle={subTab === 'fragments' && !!currentFragmentDraft && !currentFragmentDraft.isNew}
                  onSubtitleChange={currentFragmentDraft ? handleDescriptionChange : undefined}
                  subtitlePlaceholder={currentFragmentDraft && !currentFragmentDraft.isNew ? t('settings.promptEditor.addDescription') : undefined}
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
                          onOpenVersionHistory={currentVersionHistoryProps ? () => setShowVersionHistory(true) : undefined}
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

                {subTab === 'fragments' && currentFragmentDraft && (
                  <div className="editor-wrapper__split">
                    {currentFragmentDraft.isNew && (
                      <div className="editor-wrapper__fragment-fields">
                        <div className="form-group">
                          <label className="form-label" htmlFor="fragment-folder-path">
                            {t('settings.promptEditor.createFragment.folderPath')}
                          </label>
                          <input
                            id="fragment-folder-path"
                            className="form-input"
                            type="text"
                            value={currentFragmentDraft.folderPath}
                            onChange={(event) => {
                              const folderPath = event.target.value;
                              updateCurrentFragmentDraft((draft) => {
                                const nextDraft = {
                                  ...draft,
                                  folderPath,
                                  dirty: true,
                                  loadError: undefined,
                                };
                                const fullPath = getDraftFragmentFullPath(nextDraft);
                                return {
                                  ...nextDraft,
                                  fullPath,
                                  label: getFragmentDraftLabel(nextDraft),
                                };
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
                            value={currentFragmentDraft.fragmentName}
                            onChange={(event) => {
                              const fragmentName = event.target.value;
                              updateCurrentFragmentDraft((draft) => {
                                const nextDraft = {
                                  ...draft,
                                  fragmentName,
                                  dirty: true,
                                  loadError: undefined,
                                };
                                const fullPath = getDraftFragmentFullPath(nextDraft);
                                return {
                                  ...nextDraft,
                                  fullPath,
                                  label: getFragmentDraftLabel(nextDraft),
                                };
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
                            value={currentFragmentDraft.description}
                            onChange={(event) => handleDescriptionChange(event.target.value)}
                            placeholder={t('settings.promptEditor.createFragment.descriptionPlaceholder')}
                          />
                        </div>
                      </div>
                    )}

                    {currentFragmentDraft.loadError && (
                      <div className="editor-wrapper__inline-error">{currentFragmentDraft.loadError}</div>
                    )}

                    <TemplateEditor
                      content={currentFragmentDraft.content || ''}
                      onContentChange={(text) => {
                        updateCurrentFragmentDraft((draft) => ({
                          ...draft,
                          content: text,
                          dirty: isFragmentDraftDirty({
                            ...draft,
                            content: text,
                          }),
                          loadError: undefined,
                        }));
                      }}
                      validation={currentFragmentDraft.validation ?? null}
                      isLoading={currentFragmentDraft.isLoading}
                      placeholder={t('settings.promptEditor.enterFragmentTemplate')}
                    />
                  </div>
                )}

                {subTab === 'variables' && (
                  <VariableEditor
                    draft={currentVariableDraft}
                    onDraftChange={(draft) => {
                      if (draft.isNew) {
                        setNewVariableDraft(draft);
                        return;
                      }
                      if (!draft.variableId) return;
                      const draftKey = makeVariableDraftKey(draft.variableId);
                      setVariableDrafts((prev) => ({
                        ...prev,
                        [draftKey]: draft,
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
                    onDiscardNew={() => setNewVariableDraft(null)}
                    isSidebarCollapsed={isSidebarCollapsed}
                    onToggleSidebar={toggleSidebar}
                  />
                )}

                {subTab === 'subAgents' && (
                  <SubAgentEditor
                    key={currentSubAgentDraft?.draftKey || selectedSubAgentId || 'new-sub-agent'}
                    draft={currentSubAgentDraft}
                    onDraftChange={handleSubAgentDraftChange}
                    promptIdentityName={subAgentIdentityName}
                    scenarioDraft={currentSubAgentScenarioDraft}
                    onScenarioChange={(nextScenario) => {
                      if (!currentSubAgentScenarioKey) return;
                      setSubAgentScenarioDrafts((prev) => {
                        const cur = prev[currentSubAgentScenarioKey];
                        if (!cur) return prev;
                        const dirty = JSON.stringify(nextScenario) !== JSON.stringify(cur.originalScenario);
                        return {
                          ...prev,
                          [currentSubAgentScenarioKey]: {
                            ...cur,
                            scenario: nextScenario,
                            dirty,
                            saveWarnings: [],
                          },
                        };
                      });
                    }}
                    onReloadScenario={async () => {
                      if (!currentSubAgentScenarioKey || !currentSubAgentScenarioDraft || currentSubAgentDraft?.isNew) return;
                      invalidateScenarioCache('subAgent', currentSubAgentScenarioDraft.taskSubtype);
                      const loaded = await loadScenario('subAgent', currentSubAgentScenarioDraft.taskSubtype);
                      setSubAgentScenarioDrafts((prev) => {
                        const cur = prev[currentSubAgentScenarioKey];
                        if (!cur) return prev;
                        return {
                          ...prev,
                          [currentSubAgentScenarioKey]: {
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
                      setSubAgentScenarioDrafts((prev) => {
                        const next = { ...prev };
                        delete next[makeSubAgentDraftKey(subAgentId)];
                        return next;
                      });
                    }}
                    onDiscardNew={() => {
                      if (!newSubAgentDraft) return;
                      setSubAgentScenarioDrafts((prev) => {
                        const next = { ...prev };
                        delete next[newSubAgentDraft.draftKey];
                        return next;
                      });
                      setNewSubAgentDraft(null);
                    }}
                    isSidebarCollapsed={isSidebarCollapsed}
                    onToggleSidebar={toggleSidebar}
                  />
                )}

                {subTab === 'mcp' && (
                  <McpServersEditor
                    draft={currentMcpDraft}
                    snapshot={selectedMcpSnapshot}
                    storeError={mcpStoreError}
                    onDraftChange={(draft) => {
                      if (draft.isNew) {
                        setNewMcpDraft(draft);
                        return;
                      }
                      if (!draft.serverId) return;
                      const draftKey = makeMcpDraftKey(draft.serverId);
                      setMcpDrafts((prev) => ({
                        ...prev,
                        [draftKey]: draft,
                      }));
                    }}
                    onDeleted={(serverId) => {
                      setSelectedMcpServerId((prev) => (prev === serverId ? null : prev));
                      setMcpDrafts((prev) => {
                        const next = { ...prev };
                        delete next[makeMcpDraftKey(serverId)];
                        return next;
                      });
                    }}
                    onDiscardNew={() => setNewMcpDraft(null)}
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
                    onClick={() => handleSubTabChange('prompts')}
                    className={subTab === 'prompts' ? 'is-selected' : ''}
                  />
                  <DropdownItem
                    label={t('settings.promptEditor.fragments')}
                    onClick={() => handleSubTabChange('fragments')}
                    className={subTab === 'fragments' ? 'is-selected' : ''}
                  />
                  <DropdownItem
                    label={t('settings.promptEditor.variables')}
                    onClick={() => handleSubTabChange('variables')}
                    className={subTab === 'variables' ? 'is-selected' : ''}
                  />
                  <DropdownItem
                    label={t('settings.promptEditor.subAgents')}
                    onClick={() => handleSubTabChange('subAgents')}
                    className={subTab === 'subAgents' ? 'is-selected' : ''}
                  />
                  <DropdownItem
                    label="MCP"
                    onClick={() => handleSubTabChange('mcp')}
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
                  selectedPath={selectedPath}
                  onFragmentSelect={handleFragmentSelect}
                  onCreateFragment={handleCreateFragment}
                  onFolderDeleted={handleFolderDeleted}
                  draftLabel={newFragmentDraft ? getFragmentDraftLabel(newFragmentDraft) : null}
                  isDraftSelected={!!newFragmentDraft && !selectedFragment}
                  onSelectDraft={() => {
                    setSelectedFragment(null);
                    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
                  }}
                  refreshTrigger={refreshTrigger}
                />
              )}
              {subTab === 'variables' && (
                <VariableListNav
                  selectedId={selectedVariableId}
                  onVariableSelect={(id) => {
                    setSelectedVariableId(id);
                    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
                  }}
                  onCreateVariable={handleCreateVariable}
                  newDraftLabel={newVariableDraft ? (newVariableDraft.current.name || 'New Variable') : null}
                  isNewDraftSelected={!!newVariableDraft && !selectedVariableId}
                  onSelectNewDraft={() => {
                    setSelectedVariableId(null);
                    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
                  }}
                />
              )}
              {subTab === 'subAgents' && (
                <SubAgentListNav
                  selectedId={selectedSubAgentId}
                  onSelect={(id) => {
                    setSelectedSubAgentId(id);
                    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
                  }}
                  onCreate={handleCreateSubAgent}
                  newDraftLabel={newSubAgentDraft ? (newSubAgentDraft.current.display_name || 'New Sub Agent') : null}
                  isNewDraftSelected={!!newSubAgentDraft && !selectedSubAgentId}
                  onSelectNewDraft={() => {
                    setSelectedSubAgentId(null);
                    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
                  }}
                />
              )}
              {subTab === 'mcp' && (
                <McpServerListNav
                  selectedId={selectedMcpServerId}
                  onSelect={(id) => {
                    setSelectedMcpServerId(id);
                    if (window.innerWidth <= 768) setIsSidebarCollapsed(true);
                  }}
                  onCreate={handleCreateMcpServer}
                  newDraftLabel={newMcpDraft ? (newMcpDraft.current.display_name || newMcpDraft.current.server_key || 'New MCP Server') : null}
                  isNewDraftSelected={!!newMcpDraft && !selectedMcpServerId}
                  onSelectNewDraft={() => {
                    setSelectedMcpServerId(null);
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
