import { buildOperationBase, coerceRecord, defineToolCallUiModule } from '../registry/contracts';
import { useSettingsStore } from '../../store/settingsStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { ImageToolCard } from '../ui/cards/ImageToolCard';
import type { GenerateOperationVM } from '../ui/vmTypes';

function resolveLanguage(): string {
  try {
    return useSettingsStore.getState().getSettings().mainLanguage || 'English';
  } catch {
    return 'English';
  }
}

function dataForLanguage(object: { data?: Record<string, unknown> } | undefined, language: string): Record<string, unknown> {
  const data = object?.data;
  if (!data || typeof data !== 'object') return {};
  const exact = data[language];
  if (exact && typeof exact === 'object' && !Array.isArray(exact)) {
    return exact as Record<string, unknown>;
  }
  for (const value of Object.values(data)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return {};
}

function resolveObjectLabel(objectId: string | undefined, language: string): string | undefined {
  if (!objectId) return undefined;
  const object = useUnifiedObjectStore.getState().objects[objectId];
  if (!object) return undefined;
  const data = dataForLanguage(object, language);
  if (object.type === 'basic_info') {
    const title = data.title;
    return typeof title === 'string' && title.trim() ? title.trim() : 'Basic Info';
  }
  for (const key of ['name', 'title']) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return object.id;
}

function resolveSceneLabel(manuscriptId: string | undefined, language: string): string | undefined {
  if (!manuscriptId) return undefined;
  const objects = useUnifiedObjectStore.getState().objects;
  const manuscript = objects[manuscriptId];
  if (!manuscript) return undefined;
  const chapterId = typeof manuscript.metadata?.chapter_id === 'string' ? manuscript.metadata.chapter_id : null;
  if (chapterId) {
    const chapter = objects[chapterId];
    const chapterData = dataForLanguage(chapter, language);
    const chapterName = chapterData.name;
    if (typeof chapterName === 'string' && chapterName.trim()) {
      return `Manuscript: ${chapterName.trim()}`;
    }
  }
  return 'Manuscript';
}

function failureCode(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  const data = (result as Record<string, unknown>).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  return typeof (data as Record<string, unknown>).failure_code === 'string'
    ? String((data as Record<string, unknown>).failure_code)
    : undefined;
}

const imageModule = defineToolCallUiModule({
  key: 'image',
  toolNames: ['generate_object_image', 'generate_scene_image'],
  mapOperation(params) {
    const args = coerceRecord(params.args);
    const language = resolveLanguage();
    const imageKind = params.toolName === 'generate_scene_image' ? 'scene' : 'object';
    const objectId = typeof args.object_id === 'string' ? args.object_id : undefined;
    const manuscriptId = typeof args.manuscript_id === 'string' ? args.manuscript_id : undefined;
    const targetLabel = imageKind === 'scene'
      ? resolveSceneLabel(manuscriptId, language)
      : resolveObjectLabel(objectId, language);
    const title = imageKind === 'scene'
      ? (targetLabel ? `Scene Image: ${targetLabel}` : 'Scene Image')
      : (targetLabel ? `Object Image: ${targetLabel}` : 'Object Image');
    const resolvedFailureCode = failureCode(params.result);
    const base = buildOperationBase(
      params,
      title,
      imageKind === 'scene' ? manuscriptId : objectId,
      targetLabel,
    );
    return {
      ...base,
      args,
      category: 'generate',
      includeInBulkDecision: false,
      imageKind,
      prompt: typeof args.prompt === 'string' ? args.prompt : '',
      requestedRatio: typeof args.ratio === 'string' ? args.ratio : '',
      isUserRejectedFailure: base.status === 'failed' && resolvedFailureCode === 'user_rejected_generated_image',
    } as GenerateOperationVM;
  },
  buildRenderItems(operations, ctx) {
    return (operations as GenerateOperationVM[]).map((operation) => {
      const decisionProps = ctx.getDecisionProps(operation);
      return {
        id: operation.id,
        operationIds: [operation.id],
        element: (
          <ImageToolCard
            key={operation.id}
            threadId={ctx.threadId}
            scopeKey={ctx.scopeKey}
            projectId={ctx.projectId}
            operation={operation}
            showDecisionButtons={decisionProps.showDecisionButtons}
            decisionDisabled={decisionProps.decisionDisabled}
            onAccept={decisionProps.onAccept}
            onReject={decisionProps.onReject}
          />
        ),
      };
    });
  },
  getEditMeta(toolName) {
    return {
      title: toolName === 'generate_scene_image' ? 'Generate Scene Image' : 'Generate Object Image',
      type: 'init',
    };
  },
});

export default imageModule;
