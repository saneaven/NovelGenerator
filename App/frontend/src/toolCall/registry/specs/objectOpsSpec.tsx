import {
  buildOperationBase,
  coerceRecord,
  type AutoApproveCategory,
  type MapToolToVmParams,
  type RenderCardParams,
  type ToolUiSpec,
} from '../contracts';
import { CreateCallCard } from '../../ui/cards/CreateCallCard';
import { DeleteCallCard } from '../../ui/cards/DeleteCallCard';
import { ReadCallCard } from '../../ui/cards/ReadCallCard';
import { ReplaceCallCard } from '../../ui/cards/ReplaceCallCard';
import type { ObjectOperationVM, ObjectType, OperationCategory, StoryObjectSubtype } from '../../ui/vmTypes';

/** Strip translate_ prefix so existing logic can handle translate tool names. */
function normalizeToolName(toolName: string): string {
  if (toolName.startsWith('translate_patch_')) return toolName.replace('translate_patch_', 'patch_');
  if (toolName.startsWith('translate_')) return toolName.replace('translate_', 'replace_');
  return toolName;
}

function isTranslateTool(toolName: string): boolean {
  return toolName.startsWith('translate_');
}

function parseObjectCategory(toolName: string): Exclude<OperationCategory, 'search' | 'call_agent'> {
  const n = normalizeToolName(toolName);
  if (n.startsWith('read_')) return 'read';
  if (n.startsWith('create_')) return 'create';
  if (n.startsWith('replace_')) return 'replace';
  if (n.startsWith('delete_')) return 'delete';
  return 'read';
}

export function parseStorySubtype(raw: unknown): StoryObjectSubtype | undefined {
  if (typeof raw !== 'string') return undefined;
  if (raw === 'character' || raw === 'location' || raw === 'organization' || raw === 'lorebook') {
    return raw;
  }
  return undefined;
}

export function inferObjectType(rawToolName: string, args: Record<string, unknown>): {
  objectType: ObjectType;
  storySubtype?: StoryObjectSubtype;
} {
  const toolName = normalizeToolName(rawToolName);

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

  if (
    toolName === 'create_story_object'
    || toolName === 'replace_story_object'
    || toolName === 'delete_story_object'
  ) {
    return { objectType: 'story_object', storySubtype: parseStorySubtype(args.type) };
  }

  if (
    toolName === 'create_outline'
    || toolName === 'replace_outline'
    || toolName === 'delete_outline'
  ) {
    return { objectType: 'outline' };
  }

  if (
    toolName === 'create_outline_act'
    || toolName === 'replace_outline_act'
    || toolName === 'delete_outline_act'
  ) {
    return { objectType: 'outline_act' };
  }

  if (
    toolName === 'create_outline_chapter'
    || toolName === 'replace_outline_chapter'
    || toolName === 'delete_outline_chapter'
  ) {
    return { objectType: 'outline_chapter' };
  }

  if (toolName === 'replace_manuscript') {
    return { objectType: 'manuscript' };
  }

  if (toolName === 'replace_basic_info') {
    return { objectType: 'basic_info' };
  }

  if (toolName === 'replace_guidelines') {
    return { objectType: 'guidelines' };
  }

  return { objectType: 'story_object' };
}

export function getTargetId(toolName: string, args: Record<string, unknown>): string | undefined {
  if (typeof args.id === 'string' && args.id.trim()) return args.id;

  if (
    (toolName === 'replace_manuscript' || toolName === 'read_manuscript')
    && typeof args.id === 'string'
  ) {
    return args.id;
  }

  if (typeof args.chapterId === 'string' && args.chapterId.trim()) return args.chapterId;
  if (typeof args.actId === 'string' && args.actId.trim()) return args.actId;
  if (typeof args.outlineId === 'string' && args.outlineId.trim()) return args.outlineId;

  return undefined;
}

export function objectTypeLabel(objectType: ObjectType, storySubtype?: StoryObjectSubtype): string {
  switch (objectType) {
    case 'story_object':
      return storySubtype
        ? storySubtype.replace(/(^\w)/, (char) => char.toUpperCase())
        : 'Story Object';
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

function buildObjectTitle(toolName: string, args: Record<string, unknown>): string {
  const { objectType, storySubtype } = inferObjectType(toolName, args);
  return objectTypeLabel(objectType, storySubtype);
}

function buildEditTitle(toolName: string, args: Record<string, unknown>): string {
  const title = buildObjectTitle(toolName, args);
  if (isTranslateTool(toolName)) return `Translate ${title}`;
  const category = parseObjectCategory(toolName);
  if (category === 'create') return `Create ${title}`;
  if (category === 'delete') return `Delete ${title}`;
  if (category === 'replace') return `Update ${title}`;
  return `Read ${title}`;
}

function resolveEditType(toolName: string): string {
  const n = normalizeToolName(toolName);
  if (n.startsWith('create_')) return 'add';
  if (n.startsWith('delete_')) return 'remove';
  if (n.startsWith('read_')) return 'init';
  return 'edit';
}

function resolveAutoApproveCategory(toolName: string): AutoApproveCategory | null {
  const n = normalizeToolName(toolName);
  if (n.startsWith('create_')) return 'create';
  if (n.startsWith('delete_')) return 'delete';
  if (n.startsWith('replace_')) return 'replace';
  if (n.startsWith('read_')) return 'read';
  return null;
}

const objectOpsSpec: ToolUiSpec = {
  id: 'object_ops',

  match(toolName: string): boolean {
    if (toolName === 'rag_search' || toolName === 'keyword_search') return false;
    if (toolName.startsWith('call_')) return false;
    if (toolName.startsWith('patch_')) return false;
    if (toolName.startsWith('translate_patch_')) return false;
    if (toolName.startsWith('translate_')) return true;
    return (
      toolName.startsWith('read_')
      || toolName.startsWith('create_')
      || toolName.startsWith('replace_')
      || toolName.startsWith('delete_')
    );
  },

  toOperationVM(params: MapToolToVmParams): ObjectOperationVM {
    const args = coerceRecord(params.args);
    const category = parseObjectCategory(params.toolName);
    const { objectType, storySubtype } = inferObjectType(params.toolName, args);
    const targetId = getTargetId(params.toolName, args);

    const base = buildOperationBase(params, objectTypeLabel(objectType, storySubtype), targetId, targetId);
    return {
      ...base,
      category,
      objectType,
      storySubtype,
    };
  },

  renderCard(params: RenderCardParams) {
    const operation = params.operation as ObjectOperationVM;
    const cardProps = {
      threadId: params.threadId,
      scopeKey: params.scopeKey,
      projectId: params.projectId,
      operation,
      showDecisionButtons: params.showDecisionButtons,
      decisionDisabled: params.decisionDisabled,
      onAccept: params.onAccept,
      onReject: params.onReject,
    };

    if (operation.category === 'read') {
      return <ReadCallCard key={operation.id} {...cardProps} />;
    }
    if (operation.category === 'create') {
      return <CreateCallCard key={operation.id} {...cardProps} />;
    }
    if (operation.category === 'replace') {
      return <ReplaceCallCard key={operation.id} {...cardProps} />;
    }
    if (operation.category === 'delete') {
      return <DeleteCallCard key={operation.id} {...cardProps} />;
    }
    return null;
  },

  getEditTitle(toolName: string, args: Record<string, unknown>): string {
    return buildEditTitle(toolName, args);
  },

  getEditType(toolName: string): string {
    return resolveEditType(toolName);
  },

  getAutoApproveCategory(toolName: string): AutoApproveCategory | null {
    return resolveAutoApproveCategory(toolName);
  },
};

export default objectOpsSpec;
