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
    name: "manage_story_objects",
    description: "Create, update, or delete story objects in a single operation. Supports batch operations for efficient management.",
    parameters: {
      type: "object",
      properties: {
        operations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["create", "update", "delete"],
                description: "The action to perform on the story object"
              },
              type: {
                type: "string",
                enum: ["basic_info", "character", "organization", "location", "lorebook", "act", "chapter"],
                description: "The type of story object to manage"
              },
              id: {
                type: "string",
                description: "Required for update and delete actions. When action is 'create' just type 'null'. The ID of the object to modify or remove."
              },
              data: {
                type: "object",
                description: "Required for create and update actions. The object data.",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  title: { type: "string", description: "Only for basic_info type" },
                  logline: { type: "string", description: "Only for basic_info type" },
                  genre: { type: "string", description: "Only for basic_info type" },
                  actId: { type: "string", description: "Only for chapter type" },
                  chapters: {
                    type: "array",
                    description: "Only for act type",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        description: { type: "string" }
                      },
                      required: ["name", "description"]
                    }
                  }
                }
              }
            },
            required: ["action", "type"],
            allOf: [
              {
                if: {
                  properties: { action: { const: "update" } }
                },
                then: {
                  required: ["id", "data"]
                }
              },
              {
                if: {
                  properties: { action: { const: "delete" } }
                },
                then: {
                  required: ["id"]
                }
              },
              {
                if: {
                  properties: { action: { const: "create" } }
                },
                then: {
                  required: ["data"]
                }
              },
              {
                if: {
                  properties: { 
                    type: { const: "basic_info" },
                    action: { enum: ["create", "update"] }
                  }
                },
                then: {
                  properties: {
                    data: {
                      required: ["title", "logline", "genre"]
                    }
                  }
                }
              },
              {
                if: {
                  properties: { 
                    type: { const: "chapter" },
                    action: { enum: ["create", "update"] }
                  }
                },
                then: {
                  properties: {
                    data: {
                      required: ["name", "description", "actId"]
                    }
                  }
                }
              },
              {
                if: {
                  properties: { 
                    type: { const: "act" },
                    action: { enum: ["create", "update"] }
                  }
                },
                then: {
                  properties: {
                    data: {
                      required: ["name", "description"]
                    }
                  }
                }
              },
              {
                if: {
                  properties: { 
                    type: { enum: ["character", "organization", "location", "lorebook"] },
                    action: { enum: ["create", "update"] }
                  }
                },
                then: {
                  properties: {
                    data: {
                      required: ["name", "description"]
                    }
                  }
                }
              }
            ]
          }
        }
      },
      required: ["operations"]
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