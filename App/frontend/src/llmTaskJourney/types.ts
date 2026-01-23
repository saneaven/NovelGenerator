import type { ChatMessage, ContentPart, Role } from '../llm/requestTypes';
import type { ToolCallSchema } from '../toolCall';
import type { LLMRunConfig } from '../llmSession';
import { generateTempId } from '../utils/tempId';

export type EditingTargets =
  | {
      kind: 'aiEdit';
      projectId: string;
      category: string;
      targetId: string;
      selectedContextIds: string[];
      language: string;
    }
  | {
      kind: 'translateObjects';
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
      kind: 'sceneImage';
      projectId: string;
      contextType: 'scene';
      promptMode: string;
      sceneContext?: { preContext: string; postContext: string };
      selectedObjectIds?: string[];
    }
  | {
      kind: 'agentTranslation';
      projectId: string;
      agentId: string;
      messageId: string;
      sourceLanguage: string;
      targetLanguage: string;
    };

export type LLMTaskJourney = {
  id: string;
  label: string;
  createdAt: number;
  updatedAt: number;

  // Operation metadata for computing context + apply targets
  editingTargets: EditingTargets;

  // Tools allowed for this journey (undefined when outputMode != tool_call)
  tools?: ToolCallSchema[];

  // All messages (user input + assistant outputs) - LLMTask renders templates
  messages: ChatMessage[];
};

export function createChatMessage(params: {
  role: Role;
  content: string;
  idPrefix?: string;
  timestamp?: Date;
}): ChatMessage {
  const { role, content, idPrefix, timestamp } = params;
  const contentParts: ContentPart[] = content ? [{ type: 'content', text: content }] : [];
  return {
    id: `${idPrefix ?? 'journey-msg'}-${generateTempId()}`,
    role,
    contentParts,
    timestamp: timestamp ?? new Date(),
  };
}

export function collapseContentParts(parts: ContentPart[]): string {
  return parts
    .filter((p) => p.type === 'content')
    .map((p) => p.text)
    .join('');
}

/**
 * JourneySpec - High-level spec for UI components
 *
 * UI components create JourneySpecs (fire-and-forget).
 * JourneyRuntime converts them to ExecutorConfig and manages:
 * - Multi-turn conversations
 * - Notifications
 * - Modals
 * - Session state
 */
export interface JourneySpec<TInput, TResult = void> {
  kind: string;

  /** Generate human-readable label for notifications/UI */
  label: (input: TInput) => string;

  /** Build editing targets for context tracking */
  buildEditingTargets: (input: TInput) => EditingTargets;

  /** Build LLM executor config for each attempt */
  buildLLMConfig: (input: TInput, journey: LLMTaskJourney) => LLMRunConfig;

  /** Handle result when outputMode is 'raw_output' */
  handleRawOutput?: (input: TInput, journey: LLMTaskJourney, text: string) => Promise<TResult>;
}
