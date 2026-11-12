import { buildOperationBase, coerceRecord, defineToolCallUiModule } from '../registry/contracts';
import { readAnyObjectFromCache } from '../../data/objects/objectCache';
import { ImageToolCard } from '../ui/cards/ImageToolCard';
import type { GenerateOperationVM } from '../ui/vmTypes';

function resolveObjectLabel(objectId: string | undefined): string | undefined {
  if (!objectId) return undefined;
  const object = readAnyObjectFromCache(objectId);
  if (!object) return undefined;
  const data = coerceRecord(object.data);
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

function resolveSceneLabel(manuscriptId: string | undefined): string | undefined {
  if (!manuscriptId) return undefined;
  const manuscript = readAnyObjectFromCache(manuscriptId);
  if (!manuscript) return undefined;
  const chapterId = typeof manuscript.metadata?.chapter_id === 'string' ? manuscript.metadata.chapter_id : null;
  if (chapterId) {
    const chapter = readAnyObjectFromCache(chapterId) ?? undefined;
    const chapterData = coerceRecord(chapter?.data);
    const chapterName = chapterData.name;
    if (typeof chapterName === 'string' && chapterName.trim()) {
      return `Manuscript: ${chapterName.trim()}`;
    }
  }
  return 'Manuscript';
}

function promptSections(args: Record<string, unknown>): GenerateOperationVM['promptSections'] {
  if (typeof args.prompt === 'string') {
    return [{ label: 'Prompt', text: args.prompt }];
  }
  const sections: GenerateOperationVM['promptSections'] = [];
  if (typeof args.positive === 'string') sections.push({ label: 'Positive', text: args.positive });
  if (typeof args.negative === 'string') sections.push({ label: 'Negative', text: args.negative });
  if (Array.isArray(args.characters)) {
    args.characters.forEach((rawCharacter, index) => {
      const character = coerceRecord(rawCharacter);
      if (typeof character.positive === 'string') {
        sections.push({ label: `Character ${index + 1} Positive`, text: character.positive });
      }
      if (typeof character.negative === 'string') {
        sections.push({ label: `Character ${index + 1} Negative`, text: character.negative });
      }
    });
  }
  return sections;
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
    const imageKind = params.toolName === 'generate_scene_image' ? 'scene' : 'object';
    const objectId = typeof args.object_id === 'string' ? args.object_id : undefined;
    const manuscriptId = typeof args.manuscript_id === 'string' ? args.manuscript_id : undefined;
    const targetLabel = imageKind === 'scene'
      ? resolveSceneLabel(manuscriptId) ?? manuscriptId
      : resolveObjectLabel(objectId) ?? objectId;
    const anchor = coerceRecord(args.anchor);
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
      promptSections: promptSections(args),
      anchor: imageKind === 'scene' ? {
        before: typeof anchor.before === 'string' ? anchor.before : '',
        after: typeof anchor.after === 'string' ? anchor.after : '',
      } : undefined,
      requestedRatio: typeof args.ratio === 'string' ? args.ratio : '',
      requestedImageSize: typeof args.image_size === 'string' ? args.image_size : undefined,
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
