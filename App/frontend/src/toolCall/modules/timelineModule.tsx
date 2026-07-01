import { defineToolCallUiModule, type RenderContext, type RenderItem } from '../registry/contracts';
import type { ObjectOperationVM } from '../ui/vmTypes';
import { groupPatchOperations } from '../ui/patchGrouping';
import { TimelinePatchGroupCard } from '../ui/cards/TimelinePatchGroupCard';
import {
  buildObjectOperationVM,
  buildSingleObjectRenderItems,
  getObjectEditMeta,
} from './objectModuleShared';

const TOOL_NAMES = [
  'read_timeline_track',
  'read_timeline_event',
  'create_timeline_track',
  'create_timeline_event',
  'replace_timeline_track',
  'replace_timeline_event',
  'patch_timeline_track',
  'patch_timeline_event',
  'delete_timeline_track',
  'delete_timeline_event',
  'translate_timeline_track',
  'translate_timeline_event',
  'patch_translation_timeline_track',
  'patch_translation_timeline_event',
] as const;

/** Like the shared patch builder, but renders the timeline-aware patch card. */
function buildTimelinePatchRenderItems(
  operations: ObjectOperationVM[],
  ctx: RenderContext,
  category: 'patch' | 'patch_translation',
): RenderItem[] {
  return groupPatchOperations(operations).map((group) => {
    const anyDecisionEnabled = group.operations.some((operation) => {
      const decisionProps = ctx.getDecisionProps(operation);
      return decisionProps.showDecisionButtons && !decisionProps.decisionDisabled;
    });
    const objectType = group.objectType === 'timeline_event' ? 'timeline_event' : 'timeline_track';

    return {
      id: `${category}:${group.id}`,
      operationIds: group.operations.map((operation) => operation.id),
      element: (
        <TimelinePatchGroupCard
          key={`${category}:${group.id}`}
          scopeKey={ctx.scopeKey}
          projectId={ctx.projectId}
          groupId={`${category}:${group.id}`}
          targetLabel={group.label}
          operations={group.operations}
          category={category}
          objectType={objectType}
          decisionDisabled={!anyDecisionEnabled}
          onConfirm={ctx.onCommitDecisions}
          onConfirmAndPause={ctx.onCommitDecisionsAndPause}
        />
      ),
    };
  });
}

const timelineModule = defineToolCallUiModule({
  key: 'timeline',
  toolNames: TOOL_NAMES,
  mapOperation(params) {
    return buildObjectOperationVM(params);
  },
  buildRenderItems(operations, ctx) {
    const objectOps = operations as ObjectOperationVM[];
    const singles = objectOps.filter((operation) => operation.category !== 'patch' && operation.category !== 'patch_translation');
    const patches = objectOps.filter((operation) => operation.category === 'patch');
    const translationPatches = objectOps.filter((operation) => operation.category === 'patch_translation');
    return [
      ...buildSingleObjectRenderItems(singles, ctx),
      ...buildTimelinePatchRenderItems(patches, ctx, 'patch'),
      ...buildTimelinePatchRenderItems(translationPatches, ctx, 'patch_translation'),
    ];
  },
  getEditMeta(toolName, args) {
    return getObjectEditMeta(toolName, args);
  },
});

export default timelineModule;
