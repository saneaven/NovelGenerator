export type EditingTargets =
  | {
      kind: 'objectEdit';
      projectId: string;
      category: string;
      targetId: string;
      selectedContextIds: string[];
      language: string;
    }
  | {
      kind: 'objectTranslation';
      projectId: string;
      objectIds: string[];
      sourceLanguage: string;
      targetLanguage: string;
      contextObjectIds?: string[];
    }
  | {
      kind: 'imagePrompt';
      projectId: string;
      contextType: 'object' | 'cover_image' | 'scene';
      promptMode: string;
      objectType?: string;
      objectId?: string;
      basicInfoId?: string;
      sceneContext?: { preContext: string; postContext: string };
      selectedObjectIds?: string[];
    }
  | {
      kind: 'sceneImagePrompt';
      projectId: string;
      contextType: 'scene';
      promptMode: string;
      sceneContext?: { preContext: string; postContext: string };
      selectedObjectIds?: string[];
    }
  | {
      kind: 'messageTranslation';
      projectId: string;
      sourceThreadId: string;
      sourceMessageId: string;
      sourceLanguage: string;
      targetLanguage: string;
    };

/**
 * JourneySpec - High-level spec for UI components.
 * Provides label generation and editing target construction.
 */
export interface JourneySpec<TInput> {
  kind: string;

  /** Generate human-readable label for notifications/UI */
  label: (input: TInput) => string;

  /** Build editing targets for context tracking */
  buildEditingTargets: (input: TInput) => EditingTargets;
}
