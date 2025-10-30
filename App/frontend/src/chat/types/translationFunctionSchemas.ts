// Function schemas for Translation operations using function calling

export interface FunctionCallSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, any>;
    required: string[];
  };
}

// ============================================
// TRANSLATION FUNCTIONS
// ============================================

export const TRANSLATE_BASIC_INFO_FUNCTION: FunctionCallSchema = {
  name: "translate_basic_info",
  description: "Translate the story's basic information (title, logline, genre) from one language to another",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "The translated story title"
      },
      logline: {
        type: "string",
        description: "The translated logline (one-sentence summary)"
      },
      genre: {
        type: "string",
        description: "The translated genre"
      }
    },
    required: ["title", "logline", "genre"]
  }
};

export const TRANSLATE_STORY_ITEM_FUNCTION: FunctionCallSchema = {
  name: "translate_story_item",
  description: "Translate a story item (character, organization, location, or lorebook entry) with name and description",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The translated name"
      },
      description: {
        type: "string",
        description: "The translated description"
      }
    },
    required: ["name", "description"]
  }
};

export const TRANSLATE_CHAPTER_METADATA_FUNCTION: FunctionCallSchema = {
  name: "translate_chapter_metadata",
  description: "Translate a chapter's metadata (name and description only, not the full content)",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The translated chapter name"
      },
      description: {
        type: "string",
        description: "The translated chapter description"
      }
    },
    required: ["name", "description"]
  }
};

export const TRANSLATE_CHAPTER_CONTENT_FUNCTION: FunctionCallSchema = {
  name: "translate_chapter_content",
  description: "Translate the full content of a chapter including word count calculation",
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The translated chapter content"
      },
      wordCount: {
        type: "number",
        description: "The word count of the translated content"
      }
    },
    required: ["content", "wordCount"]
  }
};

export const TRANSLATE_CHAT_MESSAGE_FUNCTION: FunctionCallSchema = {
  name: "translate_chat_message",
  description: "Translate a chat message from one language to another",
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The translated message content"
      }
    },
    required: ["content"]
  }
};

export const TRANSLATE_TEXT_FUNCTION: FunctionCallSchema = {
  name: "translate_text",
  description: "General purpose text translation for any content",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The translated text"
      }
    },
    required: ["text"]
  }
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Translation data type enum matching the old system
 */
export type TranslationDataType =
  | 'nameDescription'
  | 'basicInfo'
  | 'chapterData'
  | 'chapterContent'
  | 'chatMessage'
  | 'general';

/**
 * Get the appropriate translation function schema based on data type
 */
export function getTranslationFunctionSchema(dataType: TranslationDataType): FunctionCallSchema {
  switch (dataType) {
    case 'basicInfo':
      return TRANSLATE_BASIC_INFO_FUNCTION;
    case 'nameDescription':
      return TRANSLATE_STORY_ITEM_FUNCTION;
    case 'chapterData':
      return TRANSLATE_CHAPTER_METADATA_FUNCTION;
    case 'chapterContent':
      return TRANSLATE_CHAPTER_CONTENT_FUNCTION;
    case 'chatMessage':
      return TRANSLATE_CHAT_MESSAGE_FUNCTION;
    case 'general':
      return TRANSLATE_TEXT_FUNCTION;
    default:
      throw new Error(`Unknown translation data type: ${dataType}`);
  }
}

/**
 * Get all translation function schemas as an array
 */
export function getAllTranslationFunctionSchemas(): FunctionCallSchema[] {
  return [
    TRANSLATE_BASIC_INFO_FUNCTION,
    TRANSLATE_STORY_ITEM_FUNCTION,
    TRANSLATE_CHAPTER_METADATA_FUNCTION,
    TRANSLATE_CHAPTER_CONTENT_FUNCTION,
    TRANSLATE_CHAT_MESSAGE_FUNCTION,
    TRANSLATE_TEXT_FUNCTION
  ];
}
