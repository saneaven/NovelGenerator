import { defineToolCallUiModule } from '../registry/contracts';
import type { ObjectOperationVM } from '../ui/vmTypes';
import {
  buildObjectOperationVM,
  buildPatchGroupRenderItems,
  buildSingleObjectRenderItems,
  getObjectEditMeta,
} from './objectModuleShared';

const TOOL_NAMES = [
  'read_timeline',
  'read_timeline_event',
  'create_timeline_track',
  'create_timeline_event',
  'create_timeline_event_link',
  'patch_timeline_track',
  'patch_timeline_event',
  'delete_timeline_track',
  'delete_timeline_event',
  'delete_timeline_event_link',
  'translate_timeline_track',
  'translate_timeline_event',
  'patch_translation_timeline_track',
  'patch_translation_timeline_event',
] as const;

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
      ...buildPatchGroupRenderItems(patches, ctx, 'patch'),
      ...buildPatchGroupRenderItems(translationPatches, ctx, 'patch_translation'),
    ];
  },
  getEditMeta(toolName, args) {
    return getObjectEditMeta(toolName, args);
  },
});

export default timelineModule;
