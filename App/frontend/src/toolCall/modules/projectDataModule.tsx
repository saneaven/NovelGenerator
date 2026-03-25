import { defineToolCallUiModule } from '../registry/contracts';
import type { ObjectOperationVM } from '../ui/vmTypes';
import {
  buildObjectOperationVM,
  buildPatchGroupRenderItems,
  buildSingleObjectRenderItems,
  getObjectEditMeta,
} from './objectModuleShared';

const TOOL_NAMES = [
  'replace_basic_info',
  'patch_basic_info',
  'translate_basic_info',
  'patch_translation_basic_info',
  'replace_guidelines',
  'patch_guidelines',
  'translate_guidelines',
  'patch_translation_guidelines',
] as const;

const projectDataModule = defineToolCallUiModule({
  key: 'project_data',
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

export default projectDataModule;
