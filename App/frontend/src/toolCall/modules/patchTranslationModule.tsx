import { defineToolCallUiModule } from '../registry/contracts';
import type { ObjectOperationVM } from '../ui/vmTypes';
import { buildObjectOperationVM, buildPatchGroupRenderItems, getObjectEditMeta } from './objectModuleShared';

const patchTranslationModule = defineToolCallUiModule({
  prefix: 'patch_translation_',
  autoApproveCategories: ['patch_translation'],
  mapOperation(params) {
    return buildObjectOperationVM(params);
  },
  buildRenderItems(operations, ctx) {
    return buildPatchGroupRenderItems(operations as ObjectOperationVM[], ctx, 'patch_translation');
  },
  getEditMeta(toolName, args) {
    return getObjectEditMeta(toolName, args);
  },
});

export default patchTranslationModule;
