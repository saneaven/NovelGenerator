/**
 * Schema definitions for prompt templates.
 * Single Source of Truth for available variables in templates.
 *
 * Variable Groups:
 * - config.* - Settings data (auto-loaded, available to ALL prompts)
 * - project.* - All project data (auto-loaded, available to ALL prompts)
 * - input.* - User input (available to ALL prompts)
 * - Mode-specific: agent.*, editAssistant.*, translation.*, imagePrompt.*
 */

import {
  buildPromptProjectDataSkeleton,
  type PromptProjectBasicInfo,
  type PromptProjectContentByLanguage,
  type PromptProjectGuidelines,
  type PromptProjectManuscript,
  type PromptProjectObject,
  type PromptProjectOutline,
} from './projectShape';

// Helper type for variable metadata
type VariableDef<T> = {
  desc: string;
  example: T;
};

const PROJECT_SCHEMA_EXAMPLE = buildPromptProjectDataSkeleton({
  languages: ['English', 'Korean'],
});

/**
 * The Single Source of Truth for all prompt variables.
 */
export const UNIFIED_SCHEMA = {
  config: {
    mainLanguage: { desc: "Primary language", example: "Korean" as string },
    displayLanguage: { desc: "Current display language", example: "English" as string },
    today: { desc: "Current date (YYYY-MM-DD)", example: "2025-01-15" as string },
    thinking_mode: { desc: "Thinking mode ('off' | 'model' | 'custom')", example: "off" as 'off' | 'model' | 'custom' },
    outputMode: { desc: "LLM output mode ('tool_call' | 'native_tool_call' | 'raw_output')", example: "tool_call" as 'tool_call' | 'native_tool_call' | 'raw_output' },
  },

  project: {
    basicInfo: {
      desc: "Story basic info",
      example: PROJECT_SCHEMA_EXAMPLE.basicInfo as PromptProjectBasicInfo,
    },
    objects: {
      desc: "Main language objects array",
      example: PROJECT_SCHEMA_EXAMPLE.objects as PromptProjectObject[],
    },
    outline: {
      desc: "Story outline with acts and chapters",
      example: PROJECT_SCHEMA_EXAMPLE.outline as PromptProjectOutline,
    },
    manuscripts: {
      desc: "All manuscripts array",
      example: PROJECT_SCHEMA_EXAMPLE.manuscripts as PromptProjectManuscript[],
    },
    contentByLang: {
      desc: "All language versions (keyed by language name)",
      example: PROJECT_SCHEMA_EXAMPLE.contentByLang as PromptProjectContentByLanguage,
    },
    guidelines: {
      desc: "Project guidelines for AI",
      example: PROJECT_SCHEMA_EXAMPLE.guidelines as PromptProjectGuidelines,
    },
  },

  input: {
    userMessage: { desc: "User's input message", example: "Help me write a scene where..." as string },
    agentMessage: {
      desc: "Agent message passed into a Sub Agent (call_{agent_name} args.input)",
      example: "Collect character setting details for character char-1." as string
    },
    subAgentMessage: {
      desc: "Sub Agent's response message (used when rendering subAgent scenario assistant templates)",
      example: "Here are the character setting details for char-1..." as string,
    },
    toolResults: {
      desc: "Previous tool call results",
      example: [{
        toolCallId: "tool-call-1",
        toolName: "update_manuscript",
        success: true,
        status: "accepted",
        resultMessage: "Applied successfully",
        acceptedAt: "2025-01-02T00:00:00Z"
      }] as Array<{ toolCallId: string; toolName: string; success: boolean; status: string; resultMessage: string; acceptedAt?: string }>
    },
  },

  agent: {
    runMode: { desc: "Agent run mode", example: "planMode" as "planMode" | "agentMode" },
    surface: {
      desc: "Current workspace surface (right-side panel)",
      example: "story-object" as "story-object" | "outline-manager" | "novel-editor" | "config",
    },
    contextObjectIds: { desc: "IDs of objects to include in context", example: ["char-1", "loc-1"] as string[] },
  },

  memory: {
    summaries: {
      desc: "Rolling memory summaries in chronological order",
      example: ["Facts: ...\nDecisions: ...\nOpen Questions: ..."] as string[],
    },
    historyChats: {
      desc: "Retrieved archived chat snippets",
      example: [{
        messageId: "msg-123",
        role: "assistant",
        matchedSnippet: "Created outline: The Hollow Crown - Main Storyline",
        match: { kind: "tool_call", fieldPath: "tool_calls/call-1/result", chunkIndex: 0 },
        toolCall: { id: "call-1", name: "create_outline", status: "accepted", result: "Applied successfully" },
      }] as Array<{
        messageId: string;
        role: string;
        matchedSnippet: string;
        distance?: number | null;
        match: { kind: "content" | "tool_call"; fieldPath: string; chunkIndex?: number | null };
        toolCall?: { id?: string; name: string; status: string; result: string };
      }>,
    },
  },

  memorySummary: {
    previousSummary: { desc: "Previous rolling summary text", example: "Facts: ...\nDecisions: ..." },
    messages: {
      desc: "Messages being archived and summarized",
      example: [{
        role: "user",
        content: "Let's make the main character a detective.",
        messageId: "msg-1",
        createdAt: "2026-01-01T00:00:00Z",
      }] as Array<{ role: string; content: string; messageId: string; createdAt?: string }>,
    },
    language: { desc: "Target summary language", example: "Korean" },
    archiveUntilMessageId: { desc: "Archive boundary message ID", example: "msg-100" },
  },

  editAssistant: {
    mode: { desc: "Edit assistant mode", example: "manuscript" as "manuscript" | "storyObject" },
    manuscript: {
      desc: "Manuscript editing context",
      example: {
        currentId: "ms-123",
        currentChapterId: "ch-123",
        currentChapterName: "Chapter 1: The Raid",
        currentChapterManuscript: "The longships appeared at dawn...",
        objectIds: ["char-1", "ch-1", "ms-1"],
      } as { currentId: string; currentChapterId: string; currentChapterName: string; currentChapterManuscript: string; objectIds?: string[] }
    },
    storyObject: {
      desc: "Story object editing context",
      example: {
        targetIds: ["char-1", "char-2"],
        contextIds: ["char-3", "loc-1"],
        categoryName: "characters",
        editScope: "selected",
      } as { targetIds: string[]; contextIds?: string[]; categoryName?: string; editScope?: string }
    },
  },

  translation: {
    sourceLanguage: { desc: "Source language", example: "English" },
    targetLanguage: { desc: "Target language", example: "Korean" },
    objectIds: { desc: "IDs of story objects to translate (filter from project.objects)", example: ["char-1", "char-2"] as string[] },
    contextObjectIds: { desc: "IDs of reference objects for terminology consistency", example: ["char-3", "loc-1"] as string[] },
    currentTranslatedContents: {
      desc: "Current translations of objects being edited (for set/patch decision)",
      example: [{
        id: "char-1",
        type: "character",
        name: "Character Name",
        translatedContent: "Name: 캐릭터\nDescription: 설명..."
      }] as Array<{ id: string; type: string; name: string; translatedContent: string }>
    },
    messages: {
      desc: "Agent messages to translate (only for agent message translation)",
      example: [{ id: "msg-1", content: "Hello there" }] as Array<{ id: string; content: string }>
    },
  },

  imagePrompt: {
    promptMode: { desc: "Prompt mode", example: "natural" as "natural" | "positive" | "negative" },
    currentObject: {
      desc: "Current object context for image prompt generation",
      example: {
        type: "character",
        name: "Uhtred of Bebbanburg",
        description: "A Saxon lord raised by Danes...",
        content: "Tall, battle-scarred warrior. Wears worn leather and a wolfskin cloak...",
        image_prompt: "A rugged warrior with long dark hair, battle-worn leather armor...",
        image_prompt_positive: "warrior, long hair, leather armor, wolfskin cloak",
        image_prompt_negative: "blurry, low quality, deformed",
      } as {
        type?: string;
        name: string;
        description: string;
        content: string;
        image_prompt: string | null;
        image_prompt_positive: string | null;
        image_prompt_negative: string | null;
      }
    },
    scenePreContext: { desc: "Scene pre-context (for scene mode)", example: "The hero enters the dark cave..." },
    scenePostContext: { desc: "Scene post-context (for scene mode)", example: "He finds the treasure chest." },
    selectedObjectIds: { desc: "IDs of selected reference objects", example: ["char-1", "loc-1"] as string[] },
  },

  // User-defined variables (dynamic, fields determined by user configuration)
  variables: {
    _dynamic: {
      desc: "User-defined prompt variables. Fields are dynamically defined by the user.",
      example: {} as Record<string, string | number | boolean | null>
    },
  },
} as const;

/**
 * Prompt types
 */
export type PromptType = 'agent' | 'memory' | 'editAssistant' | 'translation' | 'objectImagePrompt' | 'sceneImagePrompt' | 'subAgent';

/**
 * Maps which variable groups are available for each prompt type.
 */
export const PROMPT_TYPE_VARIABLES: Record<PromptType, string[]> = {
  agent: ['config', 'project', 'input', 'agent', 'memory', 'variables'],
  memory: ['config', 'project', 'input', 'memorySummary', 'variables'],
  editAssistant: ['config', 'project', 'input', 'editAssistant', 'variables'],
  translation: ['config', 'project', 'input', 'translation', 'variables'],
  objectImagePrompt: ['config', 'project', 'input', 'imagePrompt', 'variables'],
  sceneImagePrompt: ['config', 'project', 'input', 'imagePrompt', 'variables'],
  subAgent: ['config', 'project', 'input', 'variables'],
};

// Type extraction helpers
type ExtractExample<T> = T extends VariableDef<infer V>
  ? V
  : T extends { example: infer E }
    ? E
    : never;

type ExtractProps<T> = {
  [K in keyof T]: ExtractExample<T[K]>;
};

// Exported types from unified schema
export type ConfigData = ExtractProps<typeof UNIFIED_SCHEMA['config']>;
export type ProjectData = ExtractProps<typeof UNIFIED_SCHEMA['project']>;
export type InputData = ExtractProps<typeof UNIFIED_SCHEMA['input']>;
export type AgentModeData = ExtractProps<typeof UNIFIED_SCHEMA['agent']>;
export type MemoryData = ExtractProps<typeof UNIFIED_SCHEMA['memory']>;
export type EditAssistantModeData = ExtractProps<typeof UNIFIED_SCHEMA['editAssistant']>;
export type TranslationModeData = ExtractProps<typeof UNIFIED_SCHEMA['translation']>;
export type ImagePromptModeData = ExtractProps<typeof UNIFIED_SCHEMA['imagePrompt']>;
export type MemorySummaryData = ExtractProps<typeof UNIFIED_SCHEMA['memorySummary']>;

// Variables data type
export type VariablesData = Record<string, string | number | boolean | null>;

// Full unified data structure (same as TemplateData in types.ts)
export interface PromptData {
  config: ConfigData;
  project: ProjectData;
  input: InputData;
  agent?: AgentModeData;
  memory?: MemoryData;
  memorySummary?: MemorySummaryData;
  editAssistant?: EditAssistantModeData;
  translation?: TranslationModeData;
  imagePrompt?: ImagePromptModeData;
  variables?: VariablesData;
}

/**
 * Get available variable groups for a prompt type
 */
export function getAvailableGroups(type: PromptType): string[] {
  return PROMPT_TYPE_VARIABLES[type] || [];
}

/**
 * Get all variables in a group from unified schema
 */
export function getGroupVariables(group: keyof typeof UNIFIED_SCHEMA): string[] {
  const groupSchema = UNIFIED_SCHEMA[group];
  return groupSchema ? Object.keys(groupSchema) : [];
}

/**
 * Check if a variable group is available for a prompt type
 */
export function isGroupAvailableForType(group: string, type: PromptType): boolean {
  const availableGroups = PROMPT_TYPE_VARIABLES[type];
  return availableGroups?.includes(group) ?? false;
}
