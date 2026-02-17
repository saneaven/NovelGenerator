import { useSettingsStore } from '../store/settingsStore';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import type { JourneySpec, EditingTargets } from './types';

// =====================================================================
// Input Types
// =====================================================================

export type AiEditCategory = string;

export interface AiEditInput {
  projectId: string;
  category: AiEditCategory;
  targetId?: string;
  userRequest: string;
  selectedContextIds: string[];
  rawMode?: boolean;
}

export interface TranslateObjectsInput {
  projectId: string;
  sourceLanguage: string;
  targetLanguage: string;
  userInput?: string;
  objectIds: string[];
  contextObjectIds?: string[];
  rawMode?: boolean;
}

export type PromptMode = 'natural' | 'positive' | 'negative';
export type ContextType = 'object' | 'cover_image' | 'scene';

export interface ImagePromptInput {
  projectId: string;
  promptMode: PromptMode;
  contextType: ContextType;
  userRequest: string;
  objectType?: 'character' | 'location' | 'organization' | 'lorebook';
  objectId?: string;
  basicInfoId?: string;
  sceneContext?: { preContext: string; postContext: string };
  selectedObjectIds?: string[];
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
  character: 'Character',
  organization: 'Organization',
  location: 'Location',
  lorebook: 'Lorebook',
  outline: 'Outline',
  act: 'Act',
  chapter: 'Chapter',
  manuscript: 'Manuscript',
};

// =====================================================================
// aiEdit Spec
// =====================================================================

const aiEditSpec: JourneySpec<AiEditInput> = {
  kind: 'aiEdit',

  label: (input) => {
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
  },

  buildEditingTargets: (input) => {
    const settingsStore = useSettingsStore.getState();
    const mainLanguage = settingsStore.getSettings().mainLanguage;
    const targetId = (input.targetId ?? '').trim();
    if (!targetId) {
      throw new Error('aiEdit requires targetId.');
    }
    return {
      kind: 'aiEdit',
      projectId: input.projectId,
      category: input.category,
      targetId,
      selectedContextIds: input.selectedContextIds ?? [],
      language: mainLanguage,
    };
  },
};

// =====================================================================
// translateObjects Spec
// =====================================================================

const translateObjectsSpec: JourneySpec<TranslateObjectsInput> = {
  kind: 'translateObjects',

  label: () => 'Translation',

  buildEditingTargets: (input) => ({
    kind: 'translateObjects',
    projectId: input.projectId,
    objectIds: input.objectIds,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    contextObjectIds: input.contextObjectIds,
  }),
};

// =====================================================================
// imagePrompt Spec
// =====================================================================

const imagePromptSpec: JourneySpec<ImagePromptInput> = {
  kind: 'imagePrompt',

  label: (input) => (input.contextType === 'cover_image' ? 'Cover Image Prompt' : 'Image Prompt'),

  buildEditingTargets: (input) =>
    ({
      kind: input.contextType === 'scene' ? 'sceneImage' : 'imagePrompt',
      projectId: input.projectId,
      contextType: input.contextType as any,
      promptMode: input.promptMode,
      objectType: input.objectType,
      objectId: input.objectId,
      basicInfoId: input.basicInfoId,
      sceneContext: input.sceneContext,
      selectedObjectIds: input.selectedObjectIds,
    }) as EditingTargets,
};

// =====================================================================
// sceneImage Spec (uses same config as imagePrompt)
// =====================================================================

const sceneImageSpec: JourneySpec<ImagePromptInput> = {
  kind: 'sceneImage',
  label: () => 'Scene Image Prompt',
  buildEditingTargets: imagePromptSpec.buildEditingTargets,
};

// =====================================================================
// Registry
// =====================================================================

export const journeySpecs = {
  aiEdit: aiEditSpec,
  translateObjects: translateObjectsSpec,
  imagePrompt: imagePromptSpec,
  sceneImage: sceneImageSpec,
} as const;

export type JourneyKind = keyof typeof journeySpecs;

export function getJourneySpec<K extends JourneyKind>(kind: K): (typeof journeySpecs)[K] {
  const spec = journeySpecs[kind];
  if (!spec) {
    throw new Error(`Unknown journey kind: ${kind}`);
  }
  return spec;
}
