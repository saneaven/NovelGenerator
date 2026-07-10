export type EditingTargets =
  | {
      kind: 'manuscriptEdit' | 'outlineEdit' | 'objectEdit';
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
      contextType: 'object' | 'scene';
      promptMode: string;
      objectType?: string;
      objectId?: string;
      manuscriptId?: string;
      sceneContext?: { preContext: string; postContext: string };
      selectedContextIds?: string[];
      /** @deprecated Legacy alias retained for persisted journeys. */
      selectedEntityIds?: string[];
    }
  | {
      kind: 'sceneImagePrompt';
      projectId: string;
      contextType: 'scene';
      promptMode: string;
      manuscriptId?: string;
      sceneContext?: { preContext: string; postContext: string };
      selectedContextIds?: string[];
      /** @deprecated Legacy alias retained for persisted journeys. */
      selectedEntityIds?: string[];
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
