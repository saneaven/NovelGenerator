import type { ChatMessage, ContentPart, Role } from '../llm/requestTypes';
import type { FunctionCallSchema } from '../functionCall';
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

  // Already-rendered prefix blocks (system + initial userPrompt + optional prefill)
  preConversation: ChatMessage[];

  // Operation metadata for computing context + apply targets
  editingTargets: EditingTargets;

  // Functions allowed for this journey (undefined when outputMode != tool_call)
  functions?: FunctionCallSchema[];

  // All post-prefix messages (user feedback + assistant outputs)
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

