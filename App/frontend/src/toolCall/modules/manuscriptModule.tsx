import { defineToolCallUiModule } from '../registry/contracts';
import type { ObjectOperationVM } from '../ui/vmTypes';
import {
  buildObjectOperationVM,
  buildPatchGroupRenderItems,
  buildSingleObjectRenderItems,
  getObjectEditMeta,
} from './objectModuleShared';

const TOOL_NAMES = [
  'read_manuscript',
  'replace_manuscript',
  'patch_manuscript',
  'translate_manuscript',
  'patch_translation_manuscript',
] as const;

const manuscriptModule = defineToolCallUiModule({
  key: 'manuscript',
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

export default manuscriptModule;
