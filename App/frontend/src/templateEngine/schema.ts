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

// Helper type for variable metadata
type VariableDef<T> = {
  desc: string;
  example: T;
};

/**
 * The Single Source of Truth for all prompt variables.
 */
export const UNIFIED_SCHEMA = {
  config: {
    mainLanguage: { desc: "Primary language", example: "Korean" },
    displayLanguage: { desc: "Current display language", example: "English" },
    today: { desc: "Current date (YYYY-MM-DD)", example: "2025-01-15" },
    isThinkingEnabled: { desc: "Thinking mode enabled", example: true },
    isPrefillEnabled: { desc: "Prefill enabled", example: true },
    isCustomThinkingEnabled: { desc: "Custom thinking enabled", example: false },
    outputMode: { desc: "LLM output mode ('tool_call' | 'native_function_call' | 'raw_output')", example: "tool_call" },
    isNativeFunctionCallMode: { desc: "True when outputMode is 'native_function_call'", example: false },
    isRawOutputMode: { desc: "True when outputMode is 'raw_output'", example: false },
  },

  project: {
    basicInfo: {
      desc: "Story basic info",
      example: {
        id: "proj-123",
        title: "The Last Kingdom",
        logline: "A warrior's journey to reclaim his homeland",
        genre: "Fantasy"
      } as { id: string; title: string; logline: string; genre: string }
    },
    objects: {
      desc: "Main language objects array",
      example: [{
        type: "character" as "character" | "location" | "organization" | "lorebook",
        id: "char-1",
        name: "Uhtred",
        description: "A Saxon lord raised by Danes...",
        imagePrompt: "A tall warrior with long hair...",
        imagePromptPositive: "warrior, medieval, armor",
        imagePromptNegative: "modern, futuristic"
      }] as Array<{ type: "character" | "location" | "organization" | "lorebook"; id: string; name: string; description: string; imagePrompt?: string; imagePromptPositive?: string; imagePromptNegative?: string }>
    },
    outline: {
      desc: "Story outline with acts and chapters",
      example: {
        acts: [{
          id: "act-1",
          name: "Act 1: The Fall",
          description: "Uhtred loses his birthright...",
          chapters: [{
            id: "ch-1",
            name: "Chapter 1: The Raid",
            description: "Danish raiders attack Bebbanburg..."
          }]
        }]
      } as { acts: Array<{ id: string; name: string; description: string; chapters: Array<{ id: string; name: string; description: string }> }> }
    },
    manuscripts: {
      desc: "All manuscripts array",
      example: [{
        id: "ms-1",
        chapterId: "ch-1",
        chapterName: "Chapter 1: The Raid",
        content: "The longships appeared at dawn...",
        wordCount: 1500
      }] as Array<{ id: string; chapterId: string; chapterName: string; content: string; wordCount: number }>
    },
    languages: {
      desc: "All language versions (keyed by language name)",
      example: {
        "English": {
          basicInfo: { id: "proj-123", title: "The Last Kingdom", logline: "A warrior's journey", genre: "Fantasy" },
          objects: [{ type: "character" as const, id: "char-1", name: "Uhtred", description: "A Saxon lord..." }],
          outline: { acts: [{ id: "act-1", name: "Act 1", description: "...", chapters: [] }] },
          manuscripts: [{ id: "ms-1", chapterId: "ch-1", chapterName: "Chapter 1", content: "...", wordCount: 100 }],
        },
        "Korean": {
          basicInfo: { id: "proj-123", title: "마지막 왕국", logline: "전사의 여정", genre: "판타지" },
          objects: [{ type: "character" as const, id: "char-1", name: "우트레드", description: "색슨 영주..." }],
          outline: { acts: [{ id: "act-1", name: "1막", description: "...", chapters: [] }] },
          manuscripts: [{ id: "ms-1", chapterId: "ch-1", chapterName: "1장", content: "...", wordCount: 100 }],
        }
      } as Record<string, {
        basicInfo: { id: string; title: string; logline: string; genre: string } | null;
        objects: Array<{ type: "character" | "location" | "organization" | "lorebook"; id: string; name: string; description: string; imagePrompt?: string; imagePromptPositive?: string; imagePromptNegative?: string }>;
        outline: { acts: Array<{ id: string; name: string; description: string; chapters: Array<{ id: string; name: string; description: string }> }> } | null;
        manuscripts: Array<{ id: string; chapterId: string; chapterName: string; content: string; wordCount: number }>;
      }>
    },
    guidelines: {
      desc: "Project guidelines for AI",
      example: {
        authorNote: "Focus on character development. Use formal tone."
      } as { authorNote: string }
    },
  },

  input: {
    userMessage: { desc: "User's input message", example: "Help me write a scene where..." },
    functionResults: {
      desc: "Previous function call results",
      example: [{
        functionCallId: "fc-1",
        functionName: "update_manuscript",
        success: true,
        status: "accepted",
        resultMessage: "Applied successfully",
        acceptedAt: "2025-01-02T00:00:00Z"
      }] as Array<{ functionCallId: string; functionName: string; success: boolean; status: string; resultMessage: string; acceptedAt?: string }>
    },
  },

  feedback: {
    editingObjectIds: {
      desc: "IDs of target objects for the current operation (used by common/feedback templates)",
      example: ["char-1", "ms-1"] as string[],
    },
  },

  agent: {
    mode: { desc: "Agent mode", example: "storyObject" as "storyObject" | "novelEditor" },
    contextObjectIds: { desc: "IDs of objects to include in context", example: ["char-1", "loc-1"] as string[] },
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
    objectType: { desc: "Object type", example: "character" as "character" | "location" | "organization" | "lorebook" },
    objectInfo: { desc: "Object name and description", example: "Character: Uhtred - A Saxon lord raised by Danes..." },
    promptMode: { desc: "Prompt mode", example: "natural" as "natural" | "positive" | "negative" },
    currentPrompt: { desc: "Current natural language prompt", example: "A tall warrior with long dark hair..." },
    currentPromptPositive: { desc: "Current positive tags", example: "warrior, long hair, armor, sword" },
    currentPromptNegative: { desc: "Current negative tags", example: "blurry, low quality, deformed" },
    scenePreContext: { desc: "Scene pre-context (for scene mode)", example: "The hero enters the dark cave..." },
    scenePostContext: { desc: "Scene post-context (for scene mode)", example: "He finds the treasure chest." },
    selectedObjectIds: { desc: "IDs of selected reference objects", example: ["char-1", "loc-1"] as string[] },
    coverImage: {
      desc: "Cover image context (title, logline, genre)",
      example: {
        title: "The Last Kingdom",
        logline: "A warrior's journey to reclaim his homeland",
        genre: "Fantasy"
      } as { title: string; logline: string; genre: string }
    },
  },
} as const;

/**
 * Prompt types
 */
export type PromptType = 'agent' | 'editAssistant' | 'translation' | 'objectImagePrompt' | 'sceneImagePrompt' | 'coverImagePrompt';

/**
 * Maps which variable groups are available for each prompt type.
 */
export const PROMPT_TYPE_VARIABLES: Record<PromptType, string[]> = {
  agent: ['config', 'project', 'input', 'agent'],
  editAssistant: ['config', 'project', 'input', 'editAssistant'],
  translation: ['config', 'project', 'input', 'translation'],
  objectImagePrompt: ['config', 'project', 'input', 'imagePrompt'],
  sceneImagePrompt: ['config', 'project', 'input', 'imagePrompt'],
  coverImagePrompt: ['config', 'project', 'input', 'imagePrompt'],
};

// Type extraction helpers
type ExtractExample<T> = T extends VariableDef<infer V> ? V : T extends { example: infer E } ? E : never;

type ExtractProps<T> = {
  [K in keyof T]: ExtractExample<T[K]>;
};

// Exported types from unified schema
export type ConfigData = ExtractProps<typeof UNIFIED_SCHEMA['config']>;
export type ProjectData = ExtractProps<typeof UNIFIED_SCHEMA['project']>;
export type InputData = ExtractProps<typeof UNIFIED_SCHEMA['input']>;
export type AgentModeData = ExtractProps<typeof UNIFIED_SCHEMA['agent']>;
export type EditAssistantModeData = ExtractProps<typeof UNIFIED_SCHEMA['editAssistant']>;
export type TranslationModeData = ExtractProps<typeof UNIFIED_SCHEMA['translation']>;
export type ImagePromptModeData = ExtractProps<typeof UNIFIED_SCHEMA['imagePrompt']>;

// Full unified data structure (same as TemplateData in types.ts)
export interface PromptData {
  config: ConfigData;
  project: ProjectData;
  input: InputData;
  agent?: AgentModeData;
  editAssistant?: EditAssistantModeData;
  translation?: TranslationModeData;
  imagePrompt?: ImagePromptModeData;
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
