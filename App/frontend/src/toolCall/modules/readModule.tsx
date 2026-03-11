import { defineToolCallUiModule } from '../registry/contracts';
import type { ObjectOperationVM } from '../ui/vmTypes';
import { buildObjectOperationVM, buildSingleObjectRenderItems, getObjectEditMeta } from './objectModuleShared';

const readModule = defineToolCallUiModule({
  prefix: 'read_',
  autoApproveCategories: ['read'],
  mapOperation(params) {
    return buildObjectOperationVM(params);
  },
  buildRenderItems(operations, ctx) {
    return buildSingleObjectRenderItems(operations as ObjectOperationVM[], ctx);
  },
  getEditMeta(toolName, args) {
    return getObjectEditMeta(toolName, args);
  },
});

export default readModule;
