import { defineToolCallUiModule } from '../registry/contracts';
import type { ObjectOperationVM } from '../ui/vmTypes';
import { buildObjectOperationVM, buildPatchGroupRenderItems, getObjectEditMeta } from './objectModuleShared';

const patchModule = defineToolCallUiModule({
  prefix: 'patch_',
  autoApproveCategories: ['patch'],
  mapOperation(params) {
    return buildObjectOperationVM(params);
  },
  buildRenderItems(operations, ctx) {
    return buildPatchGroupRenderItems(operations as ObjectOperationVM[], ctx, 'patch');
  },
  getEditMeta(toolName, args) {
    return getObjectEditMeta(toolName, args);
  },
});

export default patchModule;
