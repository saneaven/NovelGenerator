import { useSubAgentStore } from '../../store/subAgentStore';
import type { ApplicationResult, ToolCallFailureType, ToolCallStatus } from '../types';
import {
  DECISION_ELIGIBLE_STATUSES,
  type CallAgentOperationVM,
  type HeaderStatus,
  type ObjectOperationVM,
  type ObjectType,
  type OperationCategory,
  type OperationSource,
  type OperationVM,
  type SearchOperationVM,
  type SearchType,
  type StoryObjectSubtype,
} from './types';

interface MapToolToVmParams {
  id: string;
  toolName: string;
  args?: unknown;
  status?: string;
  reason?: string;
  failureType?: ToolCallFailureType;
  result?: ApplicationResult;
  source: OperationSource;
}

function coerceRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeStoredStatus(status?: string): HeaderStatus {
  switch (status) {
    case 'validating':
    case 'pending':
    case 'processing':
    case 'running':
    case 'failed':
    case 'accepted':
    case 'rejected':
    case 'cancelled':
      return status;
    case undefined:
      return 'pending';
    default:
      throw new Error(`Invalid stored tool-call status: ${String(status)}`);
  }
}

function normalizeStreamingStatus(status?: string): HeaderStatus {
  switch (status) {
    case 'collecting':
      return 'collecting';
    case 'validating':
      return 'validating';
    case 'ready':
      return 'pending';
    case 'error':
      return 'failed';
    default:
      return 'collecting';
  }
}

function normalizeStatus(status: string | undefined, source: OperationSource): HeaderStatus {
  return source === 'streaming' ? normalizeStreamingStatus(status) : normalizeStoredStatus(status);
}

function getCategory(toolName: string): OperationCategory {
  if (toolName === 'rag_search' || toolName === 'keyword_search') return 'search';
  if (toolName.startsWith('call_')) return 'call_agent';
  if (toolName.startsWith('read_')) return 'read';
  if (toolName.startsWith('create_')) return 'create';
  if (toolName.startsWith('replace_')) return 'replace';
  if (toolName.startsWith('patch_')) return 'patch';
  if (toolName.startsWith('delete_')) return 'delete';
  return 'read';
}

function parseStorySubtype(raw: unknown): StoryObjectSubtype | undefined {
  if (typeof raw !== 'string') return undefined;
  if (raw === 'character' || raw === 'location' || raw === 'organization' || raw === 'lorebook') {
    return raw;
  }
  return undefined;
}

function parseSearchType(toolName: string): SearchType {
  if (toolName === 'keyword_search') return 'keyword';
  return 'rag';
}

function inferObjectType(toolName: string, args: Record<string, unknown>): {
  objectType?: ObjectType;
  storySubtype?: StoryObjectSubtype;
} {
  if (toolName === 'read_story_object') {
    const argType = typeof args.type === 'string' ? args.type : undefined;
    if (argType === 'basic_info') return { objectType: 'basic_info' };
    if (argType === 'guidelines') return { objectType: 'guidelines' };
    return { objectType: 'story_object', storySubtype: parseStorySubtype(argType) };
  }

  if (toolName === 'read_outline') {
    const argType = typeof args.type === 'string' ? args.type : undefined;
    if (argType === 'act') return { objectType: 'outline_act' };
    if (argType === 'chapter') return { objectType: 'outline_chapter' };
    return { objectType: 'outline' };
  }

  if (toolName === 'read_manuscript') return { objectType: 'manuscript' };

  if (toolName === 'create_story_object' || toolName === 'replace_story_object' || toolName === 'patch_story_object' || toolName === 'delete_story_object') {
    return { objectType: 'story_object', storySubtype: parseStorySubtype(args.type) };
  }

  if (toolName === 'create_outline' || toolName === 'replace_outline' || toolName === 'patch_outline' || toolName === 'delete_outline') {
    return { objectType: 'outline' };
  }

  if (toolName === 'create_outline_act' || toolName === 'replace_outline_act' || toolName === 'patch_outline_act' || toolName === 'delete_outline_act') {
    return { objectType: 'outline_act' };
  }

  if (toolName === 'create_outline_chapter' || toolName === 'replace_outline_chapter' || toolName === 'patch_outline_chapter' || toolName === 'delete_outline_chapter') {
    return { objectType: 'outline_chapter' };
  }

  if (toolName === 'replace_manuscript' || toolName === 'patch_manuscript') {
    return { objectType: 'manuscript' };
  }

  if (toolName === 'replace_basic_info' || toolName === 'patch_basic_info') {
    return { objectType: 'basic_info' };
  }

  if (toolName === 'replace_guidelines' || toolName === 'patch_guidelines') {
    return { objectType: 'guidelines' };
  }

  return {};
}

function getTargetId(toolName: string, args: Record<string, unknown>): string | undefined {
  if (typeof args.id === 'string' && args.id.trim()) return args.id;

  if ((toolName === 'replace_manuscript' || toolName === 'patch_manuscript' || toolName === 'read_manuscript') && typeof args.id === 'string') {
    return args.id;
  }

  if (typeof args.chapterId === 'string' && args.chapterId.trim()) return args.chapterId;
  if (typeof args.actId === 'string' && args.actId.trim()) return args.actId;
  if (typeof args.outlineId === 'string' && args.outlineId.trim()) return args.outlineId;

  return undefined;
}

function objectTypeLabel(objectType: ObjectType, storySubtype?: StoryObjectSubtype): string {
  switch (objectType) {
    case 'story_object':
      return storySubtype ? storySubtype.replace(/(^\w)/, (m) => m.toUpperCase()) : 'Story Object';
    case 'basic_info':
      return 'Basic Info';
    case 'guidelines':
      return 'Guidelines';
    case 'outline':
      return 'Outline';
    case 'outline_act':
      return 'Act';
    case 'outline_chapter':
      return 'Chapter';
    case 'manuscript':
      return 'Manuscript';
    default:
      return 'Object';
  }
}

function buildTitle(params: {
  category: OperationCategory;
  objectType?: ObjectType;
  storySubtype?: StoryObjectSubtype;
  callDisplayName?: string;
  searchType?: string;
}): string {
  const { category, objectType, storySubtype, callDisplayName, searchType } = params;

  if (category === 'call_agent') {
    return callDisplayName || 'Sub Agent';
  }

  if (category === 'search') {
    return searchType === 'rag' ? 'RAG' : 'Keyword';
  }

  return objectType ? objectTypeLabel(objectType, storySubtype) : 'Object';
}

function callAgentDisplay(toolName: string): { agentName: string; displayName: string } {
  const agentName = toolName.replace(/^call_/, '').trim();
  const subStore = useSubAgentStore.getState();
  const def = agentName ? subStore.getByAgentName(agentName) : undefined;
  const displayName = def?.display_name ?? agentName ?? 'Sub Agent';
  return { agentName, displayName };
}

export function mapToolToOperationVM(params: MapToolToVmParams): OperationVM {
  const {
    id,
    toolName,
    source,
    reason,
    failureType,
    result,
  } = params;

  const args = coerceRecord(params.args);
  const category = getCategory(toolName);
  const status = normalizeStatus(params.status, source);
  const decisionEligible = DECISION_ELIGIBLE_STATUSES.has(status);
  const isValidationFailure = status === 'failed' && failureType === 'validation';
  const isRunning = status === 'running' || status === 'processing' || status === 'collecting';

  if (category === 'call_agent') {
    const { agentName, displayName } = callAgentDisplay(toolName);
    const input = typeof args.input === 'string' ? args.input : '';
    const vm: CallAgentOperationVM = {
      id,
      toolName,
      category,
      status,
      reason,
      result,
      args,
      title: buildTitle({ category, callDisplayName: displayName }),
      targetId: undefined,
      targetLabel: displayName,
      decisionEligible,
      isValidationFailure,
      isRunning,
      agentName,
      displayName,
      input,
    };
    return vm;
  }

  if (category === 'search') {
    const searchType = parseSearchType(toolName);
    const vm: SearchOperationVM = {
      id,
      toolName,
      category,
      status,
      reason,
      result,
      args,
      title: buildTitle({ category, searchType }),
      targetId: undefined,
      targetLabel: searchType.toUpperCase(),
      decisionEligible,
      isValidationFailure,
      isRunning,
      searchType,
    };
    return vm;
  }

  const { objectType = 'story_object', storySubtype } = inferObjectType(toolName, args);
  const targetId = getTargetId(toolName, args);

  const vm: ObjectOperationVM = {
    id,
    toolName,
    category,
    status,
    reason,
    result,
    args,
    title: buildTitle({ category, objectType, storySubtype }),
    targetId,
    targetLabel: targetId,
    decisionEligible,
    isValidationFailure,
    isRunning,
    objectType,
    storySubtype,
  };

  return vm;
}

export function toStoredHeaderStatus(status: ToolCallStatus | string | undefined): HeaderStatus {
  return normalizeStoredStatus(status);
}
