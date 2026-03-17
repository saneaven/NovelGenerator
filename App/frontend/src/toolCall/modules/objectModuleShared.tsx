import {
  buildOperationBase,
  coerceRecord,
  type MapToolToVmParams,
  type RenderContext,
  type RenderItem,
} from '../registry/contracts';
import { CreateCallCard } from '../ui/cards/CreateCallCard';
import { DeleteCallCard } from '../ui/cards/DeleteCallCard';
import { PatchGroupCard } from '../ui/cards/PatchGroupCard';
import { ReadCallCard } from '../ui/cards/ReadCallCard';
import { ReplaceCallCard } from '../ui/cards/ReplaceCallCard';
import { groupPatchOperations } from '../ui/patchGrouping';
import type { ObjectOperationVM, ObjectType, OperationCategory } from '../ui/vmTypes';
import { objectTypeLabel, parseStoryEntityKind } from './objectToolMeta';

type ObjectCategory = Extract<OperationCategory, 'read' | 'create' | 'replace' | 'patch' | 'delete' | 'translate' | 'patch_translation'>;

interface ObjectToolConfig {
  category: ObjectCategory;
  objectType: ObjectType;
  storyEntityKindFromArgs?: boolean;
}

const OBJECT_TOOL_CONFIGS: Record<string, ObjectToolConfig> = {
  read_story_entity: { category: 'read', objectType: 'story_entity', storyEntityKindFromArgs: true },
  read_outline: { category: 'read', objectType: 'outline' },
  read_outline_act: { category: 'read', objectType: 'outline_act' },
  read_outline_chapter: { category: 'read', objectType: 'outline_chapter' },
  read_manuscript: { category: 'read', objectType: 'manuscript' },
  create_story_entity: { category: 'create', objectType: 'story_entity', storyEntityKindFromArgs: true },
  create_outline: { category: 'create', objectType: 'outline' },
  create_outline_act: { category: 'create', objectType: 'outline_act' },
  create_outline_chapter: { category: 'create', objectType: 'outline_chapter' },
  replace_story_entity: { category: 'replace', objectType: 'story_entity', storyEntityKindFromArgs: true },
  replace_basic_info: { category: 'replace', objectType: 'basic_info' },
  replace_guidelines: { category: 'replace', objectType: 'guidelines' },
  replace_outline: { category: 'replace', objectType: 'outline' },
  replace_outline_act: { category: 'replace', objectType: 'outline_act' },
  replace_outline_chapter: { category: 'replace', objectType: 'outline_chapter' },
  replace_manuscript: { category: 'replace', objectType: 'manuscript' },
  patch_story_entity: { category: 'patch', objectType: 'story_entity', storyEntityKindFromArgs: true },
  patch_basic_info: { category: 'patch', objectType: 'basic_info' },
  patch_guidelines: { category: 'patch', objectType: 'guidelines' },
  patch_outline: { category: 'patch', objectType: 'outline' },
  patch_outline_act: { category: 'patch', objectType: 'outline_act' },
  patch_outline_chapter: { category: 'patch', objectType: 'outline_chapter' },
  patch_manuscript: { category: 'patch', objectType: 'manuscript' },
  delete_story_entity: { category: 'delete', objectType: 'story_entity', storyEntityKindFromArgs: true },
  delete_outline: { category: 'delete', objectType: 'outline' },
  delete_outline_act: { category: 'delete', objectType: 'outline_act' },
  delete_outline_chapter: { category: 'delete', objectType: 'outline_chapter' },
  translate_story_entity: { category: 'translate', objectType: 'story_entity', storyEntityKindFromArgs: true },
  translate_basic_info: { category: 'translate', objectType: 'basic_info' },
  translate_guidelines: { category: 'translate', objectType: 'guidelines' },
  translate_outline: { category: 'translate', objectType: 'outline' },
  translate_outline_act: { category: 'translate', objectType: 'outline_act' },
  translate_outline_chapter: { category: 'translate', objectType: 'outline_chapter' },
  translate_manuscript: { category: 'translate', objectType: 'manuscript' },
  patch_translation_story_entity: { category: 'patch_translation', objectType: 'story_entity', storyEntityKindFromArgs: true },
  patch_translation_basic_info: { category: 'patch_translation', objectType: 'basic_info' },
  patch_translation_guidelines: { category: 'patch_translation', objectType: 'guidelines' },
  patch_translation_outline: { category: 'patch_translation', objectType: 'outline' },
  patch_translation_outline_act: { category: 'patch_translation', objectType: 'outline_act' },
  patch_translation_outline_chapter: { category: 'patch_translation', objectType: 'outline_chapter' },
  patch_translation_manuscript: { category: 'patch_translation', objectType: 'manuscript' },
};

function resolveObjectToolConfig(toolName: string): ObjectToolConfig | null {
  return OBJECT_TOOL_CONFIGS[toolName] ?? null;
}

export function getTargetId(_toolName: string, args: Record<string, unknown>): string | undefined {
  if (typeof args.id === 'string' && args.id.trim()) return args.id;
  if (typeof args.object_id === 'string' && args.object_id.trim()) return args.object_id;
  if (typeof args.manuscript_id === 'string' && args.manuscript_id.trim()) return args.manuscript_id;
  return undefined;
}

export function buildObjectOperationVM(params: MapToolToVmParams): ObjectOperationVM {
  const args = coerceRecord(params.args);
  const config = resolveObjectToolConfig(params.toolName);
  const objectType = config?.objectType ?? 'story_entity';
  const storyEntityKind = config?.storyEntityKindFromArgs ? parseStoryEntityKind(args.kind) : undefined;
  const targetId = getTargetId(params.toolName, args);

  const base = buildOperationBase(params, objectTypeLabel(objectType, storyEntityKind), targetId, undefined);
  return {
    ...base,
    args,
    category: config?.category ?? 'read',
    objectType,
    storyEntityKind,
  };
}

function editVerb(category: ObjectCategory): string {
  switch (category) {
    case 'read':
      return 'Read';
    case 'create':
      return 'Create';
    case 'replace':
      return 'Replace';
    case 'patch':
      return 'Patch';
    case 'delete':
      return 'Delete';
    case 'translate':
      return 'Translate';
    case 'patch_translation':
      return 'Patch Translation';
    default:
      return 'Edit';
  }
}

function editType(category: ObjectCategory): string {
  switch (category) {
    case 'read':
      return 'init';
    case 'create':
      return 'add';
    case 'delete':
      return 'remove';
    default:
      return 'edit';
  }
}

export function getObjectEditMeta(toolName: string, args: Record<string, unknown>): { title: string; type: string } {
  const config = resolveObjectToolConfig(toolName);
  const objectType = config?.objectType ?? 'story_entity';
  const storyEntityKind = config?.storyEntityKindFromArgs ? parseStoryEntityKind(args.kind) : undefined;
  const category = config?.category ?? 'read';
  return {
    title: `${editVerb(category)} ${objectTypeLabel(objectType, storyEntityKind)}`,
    type: editType(category),
  };
}

function renderSingleObjectCard(operation: ObjectOperationVM, ctx: RenderContext): React.ReactElement | null {
  const decisionProps = ctx.getDecisionProps(operation);
  const commonProps = {
    threadId: ctx.threadId,
    scopeKey: ctx.scopeKey,
    projectId: ctx.projectId,
    operation,
    showDecisionButtons: decisionProps.showDecisionButtons,
    decisionDisabled: decisionProps.decisionDisabled,
    onAccept: decisionProps.onAccept,
    onReject: decisionProps.onReject,
  };

  switch (operation.category) {
    case 'read':
      return <ReadCallCard key={operation.id} {...commonProps} />;
    case 'create':
      return <CreateCallCard key={operation.id} {...commonProps} />;
    case 'replace':
    case 'translate':
      return <ReplaceCallCard key={operation.id} {...commonProps} />;
    case 'delete':
      return <DeleteCallCard key={operation.id} {...commonProps} />;
    default:
      return null;
  }
}

export function buildSingleObjectRenderItems(operations: ObjectOperationVM[], ctx: RenderContext): RenderItem[] {
  return operations.map((operation) => ({
    id: operation.id,
    operationIds: [operation.id],
    element: renderSingleObjectCard(operation, ctx),
  }));
}

export function buildPatchGroupRenderItems(
  operations: ObjectOperationVM[],
  ctx: RenderContext,
  category: 'patch' | 'patch_translation',
): RenderItem[] {
  return groupPatchOperations(operations).map((group) => {
    const anyDecisionEnabled = group.operations.some((operation) => {
      const decisionProps = ctx.getDecisionProps(operation);
      return decisionProps.showDecisionButtons && !decisionProps.decisionDisabled;
    });

    return {
      id: `${category}:${group.id}`,
      operationIds: group.operations.map((operation) => operation.id),
      element: (
        <PatchGroupCard
          key={`${category}:${group.id}`}
          scopeKey={ctx.scopeKey}
          projectId={ctx.projectId}
          groupId={`${category}:${group.id}`}
          targetLabel={group.label}
          operations={group.operations}
          category={category}
          decisionDisabled={!anyDecisionEnabled}
          onConfirm={ctx.onCommitDecisions}
          onConfirmAndPause={ctx.onCommitDecisionsAndPause}
        />
      ),
    };
  });
}
