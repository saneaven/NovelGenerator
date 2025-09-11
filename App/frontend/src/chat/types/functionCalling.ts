// OpenAI Function Calling Types for Story Object Management

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

// Story Object Function Schemas
export const STORY_FUNCTIONS: FunctionCallSchema[] = [
  {
    name: "initialize_story_objects",
    description: "Initialize or completely replace all story objects for the project",
    parameters: {
      type: "object",
      properties: {
        basic_info: {
          type: "object",
          properties: {
            title: { type: "string" },
            logline: { type: "string" },
            genre: { type: "string" }
          }
        },
        characters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" }
            },
            required: ["name", "description"]
          }
        },
        organizations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" }
            },
            required: ["name", "description"]
          }
        },
        locations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" }
            },
            required: ["name", "description"]
          }
        },
        lorebook: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" }
            },
            required: ["name", "description"]
          }
        },
        acts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              chapters: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" }
                  },
                  required: ["name", "description"]
                }
              }
            },
            required: ["name", "description", "chapters"]
          }
        }
      },
      required: []
    }
  },
  {
    name: "add_story_objects",
    description: "Add new story objects to the project",
    parameters: {
      type: "object",
      properties: {
        characters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" }
            },
            required: ["name", "description"]
          }
        },
        organizations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" }
            },
            required: ["name", "description"]
          }
        },
        locations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" }
            },
            required: ["name", "description"]
          }
        },
        lorebook: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" }
            },
            required: ["name", "description"]
          }
        },
        acts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              chapters: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" }
                  },
                  required: ["name", "description"]
                }
              }
            },
            required: ["name", "description"]
          }
        },
        chapters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              actId: { type: "string" },
              name: { type: "string" },
              description: { type: "string" }
            },
            required: ["actId", "name", "description"]
          }
        }
      },
      required: []
    }
  },
  {
    name: "edit_story_objects",
    description: "Edit existing story objects by ID",
    parameters: {
      type: "object",
      properties: {
        basic_info: {
          type: "object",
          properties: {
            title: { type: "string" },
            logline: { type: "string" },
            genre: { type: "string" },
            description: { type: "string" }
          }
        },
        objects: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: { 
                type: "string",
                enum: ["character", "organization", "location", "lorebook", "act", "chapter"]
              },
              name: { type: "string" },
              description: { type: "string" },
            },
            required: ["id", "type", "name", "description"]
          }
        }
      },
      required: []
    }
  },
  {
    name: "remove_story_objects",
    description: "Remove story objects by ID",
    parameters: {
      type: "object",
      properties: {
        objects: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: { 
                type: "string",
                enum: ["character", "organization", "location", "lorebook", "act", "chapter"]
              }
            },
            required: ["id", "type"]
          }
        }
      },
      required: ["objects"]
    }
  }
];

// Function call message types for chat
export interface FunctionCallMessage {
  id: string;
  role: 'assistant';
  content: string | null;
  function_call?: FunctionCall;
  timestamp: Date;
}

export interface FunctionResultMessage {
  id: string;
  role: 'function';
  name: string;
  content: string;
  timestamp: Date;
}