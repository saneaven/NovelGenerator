import { defineToolCallUiModule } from '../registry/contracts';
import type { ObjectOperationVM } from '../ui/vmTypes';
import {
  buildObjectOperationVM,
  buildPatchGroupRenderItems,
  buildSingleObjectRenderItems,
  getObjectEditMeta,
} from './objectModuleShared';

const TOOL_NAMES = [
  'read_story_entity',
  'create_story_entity',
  'replace_story_entity',
  'patch_story_entity',
  'delete_story_entity',
  'translate_story_entity',
  'patch_translation_story_entity',
  'read_story_entity_folder',
  'create_story_entity_folder',
  'replace_story_entity_folder',
  'patch_story_entity_folder',
  'delete_story_entity_folder',
  'translate_story_entity_folder',
  'patch_translation_story_entity_folder',
] as const;

const storyEntityModule = defineToolCallUiModule({
  key: 'story_entity',
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

export default storyEntityModule;
