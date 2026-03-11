import { defineToolCallUiModule } from '../registry/contracts';
import type { ObjectOperationVM } from '../ui/vmTypes';
import { buildObjectOperationVM, buildSingleObjectRenderItems, getObjectEditMeta } from './objectModuleShared';

const translateModule = defineToolCallUiModule({
  prefix: 'translate_',
  autoApproveCategories: ['translate'],
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

export default translateModule;
