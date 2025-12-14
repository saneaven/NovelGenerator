/**
 * Schema definitions for prompt templates.
 * This file serves as the Single Source of Truth for available variables in templates.
 * It defines both the runtime types and the UI metadata (descriptions, examples).
 */

// Helper type for variable metadata
type VariableDef<T> = {
  desc: string;
  example: T;
};

// The Single Source of Truth for all prompt variables
export const PROMPT_SCHEMAS = {
  chat: {
    variable: {
      mainLanguage: { desc: "Main language for responses", example: "Korean" },
      mode: { desc: "Operation mode", example: "novelEditor" as "novelEditor" | "workspace" },
      today: { desc: "Current date", example: "2025-11-22" },
      userInput: { desc: "User's chat message", example: "Help me write a scene" },
    },
    state: {
      enableThinking: { desc: "Enable thinking process", example: true },
      enablePrefill: { desc: "Enable prefill", example: true },
      enableCustomThinking: { desc: "Enable custom thinking", example: false },
      hasFunctions: { desc: "Whether functions are available", example: true },
    },
    context: {
      storyContext: {
        desc: "Full story objects - template author chooses which fields to use. Contains: basicInfo (id, title, logline, genre), characters/organizations/locations/lorebook (id, name, description), outline.acts (id, name, description, chapters[]), outline.acts[].chapters (id, name, description, actId)",
        example: {
          basicInfo: {
            id: "abc123",
            title: "The Last Kingdom",
            logline: "A warrior's journey to reclaim his homeland",
            genre: "Fantasy"
          },
          characters: [{
            id: "char1",
            name: "Uhtred",
            description: "A Saxon lord raised by Danes..."
          }],
          organizations: [{
            id: "org1",
            name: "The Saxon Army",
            description: "King Alfred's military force..."
          }],
          locations: [{
            id: "loc1",
            name: "Bebbanburg",
            description: "A fortress on the northern coast..."
          }],
          lorebook: [{
            id: "lore1",
            name: "Dane Law",
            description: "The legal system of the Danish settlers..."
          }],
          outline: {
            acts: [{
              id: "act1",
              name: "Act 1: The Fall",
              description: "Uhtred loses his birthright...",
              chapters: [{
                id: "ch1",
                name: "Chapter 1: The Raid",
                description: "Danish raiders attack Bebbanburg...",
                actId: "act1"
              }]
            }]
          }
        } as Record<string, any> | null
      },
      novelContent: {
        desc: "Novel manuscripts keyed by chapter ID. Each manuscript has: id, content, wordCount",
        example: {
          "ch1": {
            id: "ms1",
            content: "The longships appeared at dawn...",
            wordCount: 1500
          },
          "ch2": {
            id: "ms2",
            content: "Uhtred watched the flames...",
            wordCount: 2000
          }
        } as Record<string, any> | null
      },
      functionResults: {
        desc: "Previous function call results (applied/rejected/failed). Each result has: functionCallId, functionName, success, isRejected, resultMessage, appliedAt",
        example: [{
          functionCallId: "fc1",
          functionName: "update_manuscript",
          success: true,
          isRejected: false,
          resultMessage: "Applied successfully",
          appliedAt: "2025-01-02T00:00:00Z"
        }] as any[]
      },
    }
  },
  translation: {
    variable: {
      userInput: { desc: "User's translation request", example: "Translate naturally" },
      today: { desc: "Current date", example: "2025-11-22" },
      sourceLanguage: { desc: "Source language", example: "English" },
      targetLanguage: { desc: "Target language", example: "Korean" },
      objectCount: { desc: "Number of objects", example: 1 },
      dataTypeName: { desc: "Human-friendly data type label", example: "Chat Message" },
      sourceContent: { desc: "Source chat content", example: "Hello there" },
    },
    state: {
      enableThinking: { desc: "Enable thinking process", example: true },
      enablePrefill: { desc: "Enable prefill", example: true },
      enableCustomThinking: { desc: "Enable custom thinking", example: false },
      isNativeOutput: { desc: "Native output mode (no function calls, use XML format)", example: false },
    },
    context: {
      objectsArray: { desc: "Array of objects to translate", example: [] as Record<string, any>[] },
    }
  },
  storyObjectEdit: {
    variable: {
      mainLanguage: { desc: "Main language for responses", example: "Korean" },
      today: { desc: "Current date", example: "2025-11-22" },
      categoryName: { desc: "Category display name", example: "Character" },
      editScope: { desc: "Edit scope", example: "item" as "item" | "list" },
      targetId: { desc: "Target ID", example: "123" },
      userInput: { desc: "User's modification request", example: "Change age to 21" },
    },
    state: {
      enableThinking: { desc: "Enable thinking process", example: true },
      enablePrefill: { desc: "Enable prefill", example: true },
      enableCustomThinking: { desc: "Enable custom thinking", example: false },
      isNativeOutput: { desc: "Native output mode (no function calls)", example: false },
      isBatchEdit: { desc: "Whether editing multiple items", example: false },
    },
    context: {
      currentData: {
        desc: "Current data object being edited",
        example: { name: "John Doe", age: 20 } as Record<string, any>
      },
      contextData: {
        desc: "Related context data",
        example: { locations: ["Seoul"] } as Record<string, any>
      }
    }
  },
  chapterEdit: {
    variable: {
      mainLanguage: { desc: "Main language for responses", example: "Korean" },
      today: { desc: "Current date", example: "2025-11-22" },
      chapterName: { desc: "Chapter title", example: "Chapter 1" },
      currentContent: { desc: "Current chapter content", example: "Once upon a time..." },
      userInput: { desc: "User's request", example: "Make it darker" },
    },
    state: {
      enableThinking: { desc: "Enable thinking process", example: true },
      enablePrefill: { desc: "Enable prefill", example: true },
      enableCustomThinking: { desc: "Enable custom thinking", example: false },
      isNativeOutput: { desc: "Native output mode (no function calls)", example: false },
    },
    context: {
      contextData: { desc: "World setting info", example: { world: "Magic" } as Record<string, any> }
    }
  },
  objectImagePrompt: {
    variable: {
      mainLanguage: { desc: "Main language for responses", example: "Korean" },
      today: { desc: "Current date", example: "2025-11-22" },
      objectType: { desc: "Type of object", example: "character" as "character" | "location" | "organization" | "lorebook" },
      objectInfo: { desc: "Object name and description", example: "Character: John Doe" },
      userInput: { desc: "User's request", example: "Make it more detailed" },
      currentPrompt: { desc: "Current natural language prompt", example: "A tall man with blue eyes" },
      currentPromptPositive: { desc: "Current positive tags", example: "blue eyes, tall" },
      currentPromptNegative: { desc: "Current negative tags", example: "blurry, low quality" },
      promptMode: { desc: "Prompt mode", example: "natural" as "natural" | "positive" | "negative" },
    },
    state: {
      enableThinking: { desc: "Enable thinking process", example: true },
      enablePrefill: { desc: "Enable prefill", example: true },
      enableCustomThinking: { desc: "Enable custom thinking", example: false },
      isNaturalPrompt: { desc: "Natural language mode", example: true },
      isPositivePrompt: { desc: "Positive tags mode", example: false },
      isNegativePrompt: { desc: "Negative tags mode", example: false },
      hasUserInput: { desc: "Has user input", example: true },
      hasCurrentPrompt: { desc: "Has current prompt", example: false },
      isNativeOutput: { desc: "Native output mode (no function calls)", example: false },
    },
    context: {}
  },
  sceneImagePrompt: {
    variable: {
      mainLanguage: { desc: "Main language for responses", example: "Korean" },
      today: { desc: "Current date", example: "2025-11-22" },
      scenePreContext: { desc: "Scene pre-context", example: "The hero enters the dark cave..." },
      scenePostContext: { desc: "Scene post-context", example: "He finds the treasure chest." },
      userInput: { desc: "User's request", example: "Focus on the treasure" },
      promptMode: { desc: "Prompt mode", example: "natural" as "natural" | "positive" | "negative" },
    },
    state: {
      enableThinking: { desc: "Enable thinking process", example: true },
      enablePrefill: { desc: "Enable prefill", example: true },
      enableCustomThinking: { desc: "Enable custom thinking", example: false },
      isNaturalPrompt: { desc: "Natural language mode", example: true },
      isPositivePrompt: { desc: "Positive tags mode", example: false },
      isNegativePrompt: { desc: "Negative tags mode", example: false },
      hasUserInput: { desc: "Has user input", example: true },
      hasSelectedObjects: { desc: "Has selected reference objects", example: true },
      isNativeOutput: { desc: "Native output mode (no function calls)", example: false },
    },
    context: {
      selectedObjects: { desc: "Selected reference objects", example: [] as any[] },
    }
  }
} as const;

// --- Type Extraction Logic ---

type ExtractProps<T> = {
  [K in keyof T]: T[K] extends VariableDef<infer V> ? V : never;
};

type ExtractSchema<T extends { variable: any; state: any; context: any }> = {
  variable: ExtractProps<T['variable']>;
  state: ExtractProps<T['state']>;
  context: ExtractProps<T['context']>;
};

// Exported Types for use in application code
export type ChatData = ExtractSchema<typeof PROMPT_SCHEMAS['chat']>;
export type TranslationData = ExtractSchema<typeof PROMPT_SCHEMAS['translation']>;
export type StoryObjectEditData = ExtractSchema<typeof PROMPT_SCHEMAS['storyObjectEdit']>;
export type ChapterEditData = ExtractSchema<typeof PROMPT_SCHEMAS['chapterEdit']>;
export type ObjectImagePromptData = ExtractSchema<typeof PROMPT_SCHEMAS['objectImagePrompt']>;
export type SceneImagePromptData = ExtractSchema<typeof PROMPT_SCHEMAS['sceneImagePrompt']>;

// Union type for all possible data
export type PromptData = ChatData | TranslationData | StoryObjectEditData | ChapterEditData | ObjectImagePromptData | SceneImagePromptData;

/**
 * Helper to get schema for a specific prompt type
 */
export type PromptType = keyof typeof PROMPT_SCHEMAS;

export function getSchema(type: PromptType) {
  return PROMPT_SCHEMAS[type];
}
