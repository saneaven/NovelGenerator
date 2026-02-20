import {
  buildOperationBase,
  coerceRecord,
  type AutoApproveCategory,
  type MapToolToVmParams,
  type RenderCardParams,
  type ToolUiSpec,
} from '../contracts';
import type { ObjectOperationVM } from '../../ui/vmTypes';
import { getTargetId, inferObjectType, objectTypeLabel } from './objectOpsSpec';

const patchSpec: ToolUiSpec = {
  id: 'patch',

  match(toolName: string): boolean {
    return toolName.startsWith('patch_');
  },

  toOperationVM(params: MapToolToVmParams): ObjectOperationVM {
    const args = coerceRecord(params.args);
    const { objectType, storySubtype } = inferObjectType(params.toolName, args);
    const targetId = getTargetId(params.toolName, args);

    const base = buildOperationBase(params, objectTypeLabel(objectType, storySubtype), targetId, targetId);
    return {
      ...base,
      category: 'patch',
      objectType,
      storySubtype,
    };
  },

  renderCard(_params: RenderCardParams) {
    return null;
  },

  getEditTitle(toolName: string, args: Record<string, unknown>): string {
    const { objectType, storySubtype } = inferObjectType(toolName, args);
    return `Patch ${objectTypeLabel(objectType, storySubtype)}`;
  },

  getEditType(_toolName: string): string {
    return 'edit';
  },

  getAutoApproveCategory(_toolName: string): AutoApproveCategory {
    return 'patch';
  },
};

export default patchSpec;
