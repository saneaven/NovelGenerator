import { useSettingsStore } from '../store/settingsStore';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import type { JourneySpec, EditingTargets } from './types';

// =====================================================================
// Input Types
// =====================================================================

export type ObjectEditCategory = string;

export interface ObjectEditInput {
  projectId: string;
  category: ObjectEditCategory;
  targetId?: string;
  userRequest: string;
  selectedContextIds: string[];
  rawMode?: boolean;
}

export interface ObjectTranslationInput {
  projectId: string;
  sourceLanguage: string;
  targetLanguage: string;
  userInput?: string;
  objectIds: string[];
  contextObjectIds?: string[];
  rawMode?: boolean;
}

export interface MessageTranslationInput {
  projectId: string;
  sourceThreadId: string;
  sourceMessageId: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export type PromptMode = 'natural' | 'positive' | 'negative';
export type ContextType = 'object' | 'scene';

export interface ImagePromptInput {
  projectId: string;
  promptMode: PromptMode;
  contextType: ContextType;
  userRequest: string;
  objectType?: 'basic_info' | 'story_entity';
  objectKind?: 'character' | 'location' | 'organization' | 'lorebook';
  objectId?: string;
  sceneContext?: { preContext: string; postContext: string };
  selectedEntityIds?: string[];
}

export interface ImagePromptResult {
  prompt: string;
  mode: PromptMode;
}

// =====================================================================
// Helpers
// =====================================================================

const CATEGORY_LABELS: Record<string, string> = {
  basic_info: 'Basic Info',
  story_entity: 'Story Entity',
  outline: 'Outline',
  act: 'Act',
  chapter: 'Chapter',
  manuscript: 'Manuscript',
};

// =====================================================================
// Shared helpers for object-edit specs
// =====================================================================

type ObjectEditJourneyKind = 'manuscriptEdit' | 'outlineEdit' | 'objectEdit';

function objectEditLabel(input: ObjectEditInput): string {
  const categoryLabel = CATEGORY_LABELS[input.category] ?? input.category;
  if (!input.targetId) {
    return `AI Edit: ${categoryLabel}`;
  }

  const store = useUnifiedObjectStore.getState();
  const mainLanguage = useSettingsStore.getState().getSettings().mainLanguage;

  if (input.category === 'manuscript') {
    const chapter = store.getObject(input.targetId);
    const langData = chapter?.data?.[mainLanguage] || (chapter?.data ? Object.values(chapter.data)[0] : undefined);
    const chapterName = (langData as any)?.name ?? '';
    return chapterName ? `AI Edit: ${categoryLabel} - ${chapterName}` : `AI Edit: ${categoryLabel}`;
  }

  const obj = store.getObject(input.targetId);
  const name =
    (obj?.data ? (obj.data as any)[mainLanguage] : undefined)?.name ??
    (obj?.data ? (obj.data as any)[mainLanguage] : undefined)?.title ??
    (obj?.data ? (Object.values(obj.data)[0] as any) : undefined)?.name ??
    (obj?.data ? (Object.values(obj.data)[0] as any) : undefined)?.title ??
    '';

  return name ? `AI Edit: ${categoryLabel} - ${name}` : `AI Edit: ${categoryLabel}`;
}

function objectEditBuildTargets(kind: ObjectEditJourneyKind, input: ObjectEditInput): EditingTargets {
  const mainLanguage = useSettingsStore.getState().getSettings().mainLanguage;
  const targetId = (input.targetId ?? '').trim();
  if (!targetId) {
    throw new Error(`${kind} requires targetId.`);
  }
  return {
    kind,
    projectId: input.projectId,
    category: input.category,
    targetId,
    selectedContextIds: input.selectedContextIds ?? [],
    language: mainLanguage,
  };
}

// =====================================================================
// manuscriptEdit / outlineEdit / objectEdit Specs
// =====================================================================

const manuscriptEditSpec: JourneySpec<ObjectEditInput> = {
  kind: 'manuscriptEdit',
  label: objectEditLabel,
  buildEditingTargets: (input) => objectEditBuildTargets('manuscriptEdit', input),
};

const outlineEditSpec: JourneySpec<ObjectEditInput> = {
  kind: 'outlineEdit',
  label: objectEditLabel,
  buildEditingTargets: (input) => objectEditBuildTargets('outlineEdit', input),
};

const objectEditSpec: JourneySpec<ObjectEditInput> = {
  kind: 'objectEdit',
  label: objectEditLabel,
  buildEditingTargets: (input) => objectEditBuildTargets('objectEdit', input),
};

// =====================================================================
// objectTranslation Spec
// =====================================================================

const objectTranslationSpec: JourneySpec<ObjectTranslationInput> = {
  kind: 'objectTranslation',

  label: () => 'Translation',

  buildEditingTargets: (input) => ({
    kind: 'objectTranslation',
    projectId: input.projectId,
    objectIds: input.objectIds,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    contextObjectIds: input.contextObjectIds,
  }),
};

// =====================================================================
// messageTranslation Spec
// =====================================================================

const messageTranslationSpec: JourneySpec<MessageTranslationInput> = {
  kind: 'messageTranslation',
  label: () => 'Message Translation',
  buildEditingTargets: (input) => ({
    kind: 'messageTranslation',
    projectId: input.projectId,
    sourceThreadId: input.sourceThreadId,
    sourceMessageId: input.sourceMessageId,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
  }),
};

// =====================================================================
// imagePrompt Spec
// =====================================================================

const imagePromptSpec: JourneySpec<ImagePromptInput> = {
  kind: 'imagePrompt',

  label: () => 'Image Prompt',

  buildEditingTargets: (input) =>
    ({
      kind: input.contextType === 'scene' ? 'sceneImagePrompt' : 'imagePrompt',
      projectId: input.projectId,
      contextType: input.contextType as any,
      promptMode: input.promptMode,
      objectType: input.objectType,
      objectKind: input.objectKind,
      objectId: input.objectId,
      sceneContext: input.sceneContext,
      selectedEntityIds: input.selectedEntityIds,
    }) as EditingTargets,
};

// =====================================================================
// sceneImagePrompt Spec (uses same config as imagePrompt)
// =====================================================================

const sceneImagePromptSpec: JourneySpec<ImagePromptInput> = {
  kind: 'sceneImagePrompt',
  label: () => 'Scene Image Prompt',
  buildEditingTargets: imagePromptSpec.buildEditingTargets,
};

// =====================================================================
// Registry
// =====================================================================

export const journeySpecs = {
  manuscriptEdit: manuscriptEditSpec,
  outlineEdit: outlineEditSpec,
  objectEdit: objectEditSpec,
  objectTranslation: objectTranslationSpec,
  imagePrompt: imagePromptSpec,
  sceneImagePrompt: sceneImagePromptSpec,
  messageTranslation: messageTranslationSpec,
} as const;

export type JourneyKind = keyof typeof journeySpecs;

export function getJourneySpec<K extends JourneyKind>(kind: K): (typeof journeySpecs)[K] {
  const spec = journeySpecs[kind];
  if (!spec) {
    throw new Error(`Unknown journey kind: ${kind}`);
  }
  return spec;
}
