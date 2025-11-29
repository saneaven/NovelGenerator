// Gemini-safe function schemas for workspace and novel editing.
// Only uses simple JSON Schema subset (type/properties/required) with no conditionals.

export interface FunctionCallSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, any>;
    required: string[];
  };
}

export interface FunctionCall {
  name: string;
  arguments: string; // JSON string
}

export interface FunctionCallResult {
  success: boolean;
  message: string;
  error?: string;
  data?: any;
}

// ----- Workspace: story-structure functions --------------------------------

const baseTextFields = {
  name: { type: "string" },
  description: { type: "string" },
};

const baseIdField = {
  id: { type: "string", description: "ID of the target object" },
};

export const WORKSPACE_FUNCTIONS: FunctionCallSchema[] = [
  {
    name: "create_basic_info",
    description: "Create or replace the project's basic info (title, logline, genre).",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        logline: { type: "string" },
        genre: { type: "string" },
      },
      required: ["title", "logline", "genre"],
    },
  },
  {
    name: "update_basic_info",
    description: "Update an existing basic info record.",
    parameters: {
      type: "object",
      properties: {
        ...baseIdField,
        title: { type: "string" },
        logline: { type: "string" },
        genre: { type: "string" },
      },
      required: ["id"],
    },
  },

  // Characters
  {
    name: "create_character",
    description: "Create a character.",
    parameters: {
      type: "object",
      properties: {
        ...baseTextFields,
      },
      required: ["name", "description"],
    },
  },
  {
    name: "update_character",
    description: "Update a character by id.",
    parameters: {
      type: "object",
      properties: {
        ...baseIdField,
        ...baseTextFields,
      },
      required: ["id"],
    },
  },
  {
    name: "delete_character",
    description: "Delete a character by id.",
    parameters: {
      type: "object",
      properties: {
        ...baseIdField,
      },
      required: ["id"],
    },
  },

  // Organizations
  {
    name: "create_organization",
    description: "Create an organization.",
    parameters: {
      type: "object",
      properties: {
        ...baseTextFields,
      },
      required: ["name", "description"],
    },
  },
  {
    name: "update_organization",
    description: "Update an organization by id.",
    parameters: {
      type: "object",
      properties: {
        ...baseIdField,
        ...baseTextFields,
      },
      required: ["id"],
    },
  },
  {
    name: "delete_organization",
    description: "Delete an organization by id.",
    parameters: {
      type: "object",
      properties: {
        ...baseIdField,
      },
      required: ["id"],
    },
  },

  // Locations
  {
    name: "create_location",
    description: "Create a location.",
    parameters: {
      type: "object",
      properties: {
        ...baseTextFields,
      },
      required: ["name", "description"],
    },
  },
  {
    name: "update_location",
    description: "Update a location by id.",
    parameters: {
      type: "object",
      properties: {
        ...baseIdField,
        ...baseTextFields,
      },
      required: ["id"],
    },
  },
  {
    name: "delete_location",
    description: "Delete a location by id.",
    parameters: {
      type: "object",
      properties: {
        ...baseIdField,
      },
      required: ["id"],
    },
  },

  // Lorebook
  {
    name: "create_lorebook_entry",
    description: "Create a lorebook entry.",
    parameters: {
      type: "object",
      properties: {
        ...baseTextFields,
      },
      required: ["name", "description"],
    },
  },
  {
    name: "update_lorebook_entry",
    description: "Update a lorebook entry by id.",
    parameters: {
      type: "object",
      properties: {
        ...baseIdField,
        ...baseTextFields,
      },
      required: ["id"],
    },
  },
  {
    name: "delete_lorebook_entry",
    description: "Delete a lorebook entry by id.",
    parameters: {
      type: "object",
      properties: {
        ...baseIdField,
      },
      required: ["id"],
    },
  },

  // Acts
  {
    name: "create_act",
    description: "Create an act. Optionally include chapters to create with it.",
    parameters: {
      type: "object",
      properties: {
        ...baseTextFields,
        order: { type: "integer", description: "0-based order within the outline" },
        chapters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ...baseTextFields,
              order: { type: "integer", description: "0-based order within the act" },
            },
            required: ["name", "description", "order"],
          },
        },
      },
      required: ["name", "description"],
    },
  },
  {
    name: "update_act",
    description: "Update an act by id.",
    parameters: {
      type: "object",
      properties: {
        ...baseIdField,
        ...baseTextFields,
        order: { type: "integer", description: "0-based order within the outline" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_act",
    description: "Delete an act by id.",
    parameters: {
      type: "object",
      properties: {
        ...baseIdField,
      },
      required: ["id"],
    },
  },

  // Chapters
  {
    name: "create_chapter",
    description: "Create a chapter within an act.",
    parameters: {
      type: "object",
      properties: {
        ...baseTextFields,
        actId: { type: "string", description: "ID of the parent act" },
        order: { type: "integer", description: "0-based order within the act" },
      },
      required: ["name", "description", "actId", "order"],
    },
  },
  {
    name: "update_chapter",
    description: "Update a chapter by id.",
    parameters: {
      type: "object",
      properties: {
        ...baseIdField,
        ...baseTextFields,
        actId: { type: "string", description: "New parent act id (optional)" },
        order: { type: "integer", description: "0-based order within the act" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_chapter",
    description: "Delete a chapter by id.",
    parameters: {
      type: "object",
      properties: {
        ...baseIdField,
      },
      required: ["id"],
    },
  },
];

// ----- Novel editor functions (unchanged, already Gemini-safe) -------------

export const NOVEL_EDITOR_FUNCTIONS: FunctionCallSchema[] = [
  {
    name: "update_manuscript",
    description: "Update the manuscript content of a specific chapter. Used for AI-generated chapter content or content modifications.",
    parameters: {
      type: "object",
      properties: {
        chapterId: {
          type: "string",
          description: "The ID of the chapter to update",
        },
        content: {
          type: "string",
          description: "The new content for the chapter",
        },
      },
      required: ["chapterId", "content"],
    },
  },
];

// ---------------------------------------------------------------------------
// Function call message types for chat
// ---------------------------------------------------------------------------

export interface FunctionCallMessage {
  id: string;
  role: "assistant";
  content: string | null;
  function_call?: FunctionCall;
  timestamp: Date;
}

export interface FunctionResultMessage {
  id: string;
  role: "function";
  name: string;
  content: string;
  timestamp: Date;
}

