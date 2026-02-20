import type { PromptCategory, TaskType } from '../../../types/prompts';

export type DraftKey = string;

export type PromptDraftKey = DraftKey;
export type FragmentDraftKey = DraftKey;
export type VariableDraftKey = DraftKey;
export type SubAgentDraftKey = DraftKey;

export function makePromptDraftKey(taskType: TaskType, taskSubtype: string, category: PromptCategory): PromptDraftKey {
  return `prompt:${taskType}:${taskSubtype}:${category}`;
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

export type DirtyItem =
  | {
      kind: 'prompt';
      key: PromptDraftKey;
      label: string;
      taskType: TaskType;
      taskSubtype: string;
      category: PromptCategory;
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
    };

export type SaveFailure = { item: DirtyItem; error: string };

export type SaveSummary = {
  attempted: number;
  saved: number;
  failed: number;
  failures: SaveFailure[];
};

