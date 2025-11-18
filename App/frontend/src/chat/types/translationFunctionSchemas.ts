/**
 * Translation Function Schema
 *
 * Unified approach: All translations use the batch schema.
 * Single translations are just batches with 1 object.
 */

export interface FunctionCallSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, any>;
    required: string[];
  };
}

// ============================================================================
// UNIFIED TRANSLATION FUNCTION
// ============================================================================

/**
 * Unified translation function schema - handles both single and batch translations
 */
export const TRANSLATE_BATCH_STORY_OBJECTS_FUNCTION: FunctionCallSchema = {
  name: "translate_batch_story_objects",
  description: "Translate one or more story objects. For single translations, return an array with 1 object. For batch translations, return an array with all objects. MUST return ALL objects with their translated content. Each object must include its type, ID, and the appropriate translated fields based on object type.",
  parameters: {
    type: "object",
    properties: {
      translations: {
        type: "array",
        description: "Array containing ALL translated story objects. This array MUST NOT be empty and MUST include every object from the input.",
        items: {
          type: "object",
          properties: {
            objectType: {
              type: "string",
              description: "Type of object - MUST match the source object type (character, organization, location, lorebook, chapter, act, basicInfo, chapterContent)"
            },
            objectId: {
              type: "string",
              description: "Unique identifier - MUST match the source object ID exactly"
            },
            name: {
              type: "string",
              description: "Translated name (REQUIRED for character, organization, location, lorebook, chapter, act objects)"
            },
            description: {
              type: "string",
              description: "Translated description (REQUIRED for character, organization, location, lorebook, chapter, act objects)"
            },
            title: {
              type: "string",
              description: "Translated title (REQUIRED for basicInfo objects)"
            },
            logline: {
              type: "string",
              description: "Translated logline (REQUIRED for basicInfo objects)"
            },
            genre: {
              type: "string",
              description: "Translated genre (REQUIRED for basicInfo objects)"
            },
            content: {
              type: "string",
              description: "Translated content (REQUIRED for chapterContent objects)"
            },
            wordCount: {
              type: "number",
              description: "Word count of translated content (REQUIRED for chapterContent objects)"
            }
          },
          required: ["objectType", "objectId"]
        }
      }
    },
    required: ["translations"]
  }
};

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Default export: the unified translation function schema
 */
export default TRANSLATE_BATCH_STORY_OBJECTS_FUNCTION;
