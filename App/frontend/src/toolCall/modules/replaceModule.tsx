import { defineToolCallUiModule } from '../registry/contracts';
import type { ObjectOperationVM } from '../ui/vmTypes';
import { buildObjectOperationVM, buildSingleObjectRenderItems, getObjectEditMeta } from './objectModuleShared';

const replaceModule = defineToolCallUiModule({
  prefix: 'replace_',
  autoApproveCategories: ['replace'],
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

export default replaceModule;
