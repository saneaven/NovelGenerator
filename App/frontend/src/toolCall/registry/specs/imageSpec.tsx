import {
  buildOperationBase,
  coerceRecord,
  type AutoApproveCategory,
  type MapToolToVmParams,
  type RenderCardParams,
  type ToolUiSpec,
} from '../contracts';
import { ImageToolCard } from '../../ui/cards/ImageToolCard';
import type { ImageOperationVM } from '../../ui/vmTypes';

const IMAGE_TOOL_NAMES = new Set(['generate_object_image', 'generate_scene_image']);

function imageKindForTool(toolName: string, extraContent: Record<string, unknown>): 'object' | 'scene' {
  const kind = typeof extraContent.kind === 'string' ? extraContent.kind : '';
  if (kind === 'scene') return 'scene';
  if (kind === 'object') return 'object';
  return toolName === 'generate_scene_image' ? 'scene' : 'object';
}

function imageTitle(params: MapToolToVmParams, extraContent: Record<string, unknown>): string {
  const kind = imageKindForTool(params.toolName, extraContent);
  const targetLabel = typeof extraContent.object_label === 'string'
    ? extraContent.object_label
    : typeof extraContent.manuscript_label === 'string'
      ? extraContent.manuscript_label
      : '';
  if (kind === 'scene') {
    return targetLabel ? `Scene Image: ${targetLabel}` : 'Scene Image';
  }
  return targetLabel ? `Object Image: ${targetLabel}` : 'Object Image';
}

function imageState(extraContent: Record<string, unknown>): 'generating' | 'generated' {
  const raw = typeof extraContent.image_state === 'string' ? extraContent.image_state : 'generating';
  if (raw === 'generated') return raw;
  return 'generating';
}

function failureCode(params: MapToolToVmParams): string | undefined {
  const result = params.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  const data = (result as Record<string, unknown>).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  return typeof (data as Record<string, unknown>).failure_code === 'string'
    ? String((data as Record<string, unknown>).failure_code)
    : undefined;
}

const imageSpec: ToolUiSpec = {
  id: 'image',

  match(toolName: string): boolean {
    return IMAGE_TOOL_NAMES.has(toolName);
  },

  toOperationVM(params: MapToolToVmParams): ImageOperationVM {
    const args = coerceRecord(params.args);
    const extraContent = coerceRecord(params.extraContent);
    const targetLabel = typeof extraContent.object_label === 'string'
      ? extraContent.object_label
      : typeof extraContent.manuscript_label === 'string'
        ? extraContent.manuscript_label
        : undefined;
    const resolvedFailureCode = failureCode(params);

    const base = buildOperationBase(
      params,
      imageTitle(params, extraContent),
      typeof extraContent.object_id === 'string'
        ? extraContent.object_id
        : typeof extraContent.manuscript_id === 'string'
          ? extraContent.manuscript_id
          : undefined,
      targetLabel,
    );

    return {
      ...base,
      args,
      category: 'image',
      includeInBulkDecision: false,
      imageKind: imageKindForTool(params.toolName, extraContent),
      imageState: imageState(extraContent),
      prompt: typeof args.prompt === 'string' ? args.prompt : '',
      requestedRatio: typeof extraContent.requested_ratio === 'string'
        ? extraContent.requested_ratio
        : typeof args.ratio === 'string'
          ? args.ratio
          : '',
      resolvedRatio: typeof extraContent.resolved_ratio === 'string' ? extraContent.resolved_ratio : undefined,
      resolvedSize: typeof extraContent.resolved_size === 'string' ? extraContent.resolved_size : undefined,
      provider: typeof extraContent.provider === 'string' ? extraContent.provider : undefined,
      model: typeof extraContent.model === 'string' ? extraContent.model : undefined,
      previewAssetId: typeof extraContent.preview_asset_id === 'string' ? extraContent.preview_asset_id : undefined,
      previewAssetUrl: typeof extraContent.preview_asset_url === 'string' ? extraContent.preview_asset_url : undefined,
      objectType: typeof extraContent.object_type === 'string' ? extraContent.object_type : undefined,
      beforeExcerpt: typeof extraContent.before_excerpt === 'string' ? extraContent.before_excerpt : undefined,
      afterExcerpt: typeof extraContent.after_excerpt === 'string' ? extraContent.after_excerpt : undefined,
      failureCode: resolvedFailureCode,
      isUserRejectedFailure: base.status === 'failed' && resolvedFailureCode === 'user_rejected_generated_image',
    };
  },

  renderCard(params: RenderCardParams) {
    const operation = params.operation as ImageOperationVM;
    return (
      <ImageToolCard
        key={operation.id}
        threadId={params.threadId}
        scopeKey={params.scopeKey}
        projectId={params.projectId}
        operation={operation}
        showDecisionButtons={params.showDecisionButtons}
        decisionDisabled={params.decisionDisabled}
        onAccept={params.onAccept}
        onReject={params.onReject}
      />
    );
  },

  getEditTitle(toolName: string): string {
    return toolName === 'generate_scene_image' ? 'Generate Scene Image' : 'Generate Object Image';
  },

  getEditType(_toolName: string): string {
    return 'init';
  },

  getAutoApproveCategory(_toolName: string): AutoApproveCategory | null {
    return null;
  },
};

export default imageSpec;
