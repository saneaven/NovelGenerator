import type { ScenarioDocument, TaskType } from '../../../types/scenarios';

export type DraftKey = string;

export type ScenarioDraftKey = DraftKey;
export type FragmentDraftKey = DraftKey;
export type VariableDraftKey = DraftKey;
export type SubAgentDraftKey = DraftKey;
export type McpDraftKey = DraftKey;

export function makeScenarioDraftKey(taskType: TaskType, taskSubtype: string): ScenarioDraftKey {
  return `scenario:${taskType}:${taskSubtype}`;
}

export function makeFragmentDraftKey(folderId: string | null, fragmentName: string): FragmentDraftKey {
  return `fragment:${folderId ?? '@root'}:${fragmentName}`;
}

export function makeVariableDraftKey(variableId: string): VariableDraftKey {
  return `variable:${variableId}`;
}

export function makeSubAgentDraftKey(subAgentId: string): SubAgentDraftKey {
  return `subAgent:${subAgentId}`;
}

export function makeMcpDraftKey(serverId: string): McpDraftKey {
  return `mcp:${serverId}`;
}

export type DirtyItem =
  | {
      kind: 'scenario';
      key: ScenarioDraftKey;
      label: string;
      taskType: TaskType;
      taskSubtype: string;
      nodeId?: string;
    }
  | {
      kind: 'fragment';
      key: FragmentDraftKey;
      label: string;
      folderId: string | null;
      fragmentName: string;
      fullPath: string;
    }
  | {
      kind: 'variable';
      key: VariableDraftKey;
      label: string;
      variableId: string;
    }
  | {
      kind: 'subAgent';
      key: SubAgentDraftKey;
      label: string;
      subAgentId: string;
    }
  | {
      kind: 'mcp';
      key: McpDraftKey;
      label: string;
      serverId: string;
    };

export type SaveFailure = { item: DirtyItem; error: string };

export type SaveSummary = {
  attempted: number;
  saved: number;
  failed: number;
  failures: SaveFailure[];
};

export type SubTab = 'prompts' | 'fragments' | 'variables' | 'subAgents' | 'mcp';

export interface SelectedFragment {
  folderId: string | null;
  fragmentName: string;
  fullPath: string;
}

export interface TemplateValidationResult {
  valid: boolean;
  errors: Array<{ message: string; line?: number; column?: number; severity: string }>;
  warnings: Array<{ message: string; line?: number; column?: number; severity: string }>;
}

export type ScenarioDraft = {
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

export type FragmentDraft = {
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
