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
      language: { desc: "Output language", example: "Korean" },
      mode: { desc: "Operation mode", example: "novelEditor" as "novelEditor" | "workspace" },
      today: { desc: "Current date", example: "2025-11-22" },
      functionInstructions: { desc: "Function instructions", example: "..." },
    },
    state: {
      enableThinking: { desc: "Enable thinking process", example: true },
      enablePrefill: { desc: "Enable prefill", example: true },
      enableCustomThinking: { desc: "Enable custom thinking", example: false },
      hasFunctions: { desc: "Whether functions are available", example: true },
    },
    context: {
      recentMessages: { desc: "List of recent messages", example: [] as any[] },
      functionResults: { desc: "Function call results", example: [] as any[] },
      storyContext: { desc: "Simplified story context", example: {} as any },
      novelContent: { desc: "Novel content by acts", example: [] as any[] },
      customSections: { desc: "Custom user sections", example: [] as any[] },
    }
  },
  translation: {
    variable: {
      sourceLanguage: { desc: "Source language", example: "English" },
      targetLanguage: { desc: "Target language", example: "Korean" },
      objectCount: { desc: "Number of objects", example: 1 },
      userInstructions: { desc: "User instructions", example: "Translate nicely" },
      dataTypeName: { desc: "Human-friendly data type label", example: "Chat Message" },
      sourceContent: { desc: "Source chat content", example: "Hello there" },
    },
    state: {
      enableThinking: { desc: "Enable thinking process", example: true },
      enablePrefill: { desc: "Enable prefill", example: true },
      enableCustomThinking: { desc: "Enable custom thinking", example: false },
    },
    context: {
      objectsArray: { desc: "Array of objects to translate", example: [] as Record<string, any>[] },
    }
  },
  storyObjectEdit: {
    variable: {
      language: { desc: "Output language", example: "Korean" },
      category: { desc: "Category key", example: "character" },
      categoryName: { desc: "Category display name", example: "Character" },
      editScope: { desc: "Edit scope", example: "item" as "item" | "list" },
      targetId: { desc: "Target ID", example: "123" },
      userRequest: { desc: "User's modification request", example: "Change age to 21" },
    },
    state: {
      enableThinking: { desc: "Enable thinking process", example: true },
      enablePrefill: { desc: "Enable prefill", example: true },
      enableCustomThinking: { desc: "Enable custom thinking", example: false },
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
      language: { desc: "Output language", example: "Korean" },
      chapterName: { desc: "Chapter title", example: "Chapter 1" },
      currentContent: { desc: "Current chapter content", example: "Once upon a time..." },
      userRequest: { desc: "User's request", example: "Make it darker" },
    },
    state: {
      enableThinking: { desc: "Enable thinking process", example: true },
      enablePrefill: { desc: "Enable prefill", example: true },
      enableCustomThinking: { desc: "Enable custom thinking", example: false },
    },
    context: {
      contextData: { desc: "World setting info", example: { world: "Magic" } as Record<string, any> }
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

// Union type for all possible data
export type PromptData = ChatData | TranslationData | StoryObjectEditData | ChapterEditData;

/**
 * Helper to get schema for a specific prompt type
 */
export type PromptType = keyof typeof PROMPT_SCHEMAS;

export function getSchema(type: PromptType) {
  return PROMPT_SCHEMAS[type];
}
