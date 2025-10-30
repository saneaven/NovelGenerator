// Function schemas for AI Edit operations using function calling

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
// SINGLE ITEM EDIT FUNCTIONS
// ============================================

export const EDIT_BASIC_INFO_FUNCTION: FunctionCallSchema = {
  name: "edit_basic_info",
  description: "Edit the story's basic information including title, logline, and genre",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "The story title"
      },
      logline: {
        type: "string",
        description: "A brief one-sentence summary of the story"
      },
      genre: {
        type: "string",
        description: "The story genre (e.g., Fantasy, Science Fiction, Mystery)"
      }
    },
    required: ["title", "logline", "genre"]
  }
};

export const EDIT_CHARACTER_FUNCTION: FunctionCallSchema = {
  name: "edit_character",
  description: "Edit a single character's information",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The ID of the character to edit (keep existing ID)"
      },
      name: {
        type: "string",
        description: "The character's name"
      },
      description: {
        type: "string",
        description: "The character's description"
      }
    },
    required: ["id", "name", "description"]
  }
};

export const EDIT_ORGANIZATION_FUNCTION: FunctionCallSchema = {
  name: "edit_organization",
  description: "Edit a single organization's information",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The ID of the organization to edit (keep existing ID)"
      },
      name: {
        type: "string",
        description: "The organization's name"
      },
      description: {
        type: "string",
        description: "The organization's description"
      }
    },
    required: ["id", "name", "description"]
  }
};

export const EDIT_LOCATION_FUNCTION: FunctionCallSchema = {
  name: "edit_location",
  description: "Edit a single location's information",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The ID of the location to edit (keep existing ID)"
      },
      name: {
        type: "string",
        description: "The location's name"
      },
      description: {
        type: "string",
        description: "The location's description"
      }
    },
    required: ["id", "name", "description"]
  }
};

export const EDIT_LOREBOOK_ENTRY_FUNCTION: FunctionCallSchema = {
  name: "edit_lorebook_entry",
  description: "Edit a single lorebook entry",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The ID of the lorebook entry to edit (keep existing ID)"
      },
      name: {
        type: "string",
        description: "The lorebook entry's name"
      },
      description: {
        type: "string",
        description: "The lorebook entry's description"
      }
    },
    required: ["id", "name", "description"]
  }
};

export const EDIT_ACT_FUNCTION: FunctionCallSchema = {
  name: "edit_act",
  description: "Edit a single act's information including its name, description, and chapters",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The ID of the act to edit (keep existing ID)"
      },
      name: {
        type: "string",
        description: "The act's name"
      },
      description: {
        type: "string",
        description: "The act's description"
      },
      chapters: {
        type: "array",
        description: "The chapters within this act",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The chapter ID (keep existing ID for updates, use null for new chapters)"
            },
            name: {
              type: "string",
              description: "The chapter's name"
            },
            description: {
              type: "string",
              description: "The chapter's description"
            }
          },
          required: ["id", "name", "description"]
        }
      }
    },
    required: ["id", "name", "description", "chapters"]
  }
};

export const EDIT_CHAPTER_METADATA_FUNCTION: FunctionCallSchema = {
  name: "edit_chapter_metadata",
  description: "Edit a single chapter's metadata (name and description only, not content)",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The ID of the chapter to edit (keep existing ID)"
      },
      name: {
        type: "string",
        description: "The chapter's name"
      },
      description: {
        type: "string",
        description: "The chapter's description"
      }
    },
    required: ["id", "name", "description"]
  }
};

export const EDIT_OUTLINE_FUNCTION: FunctionCallSchema = {
  name: "edit_outline",
  description: "Edit the entire story outline including all acts and chapters",
  parameters: {
    type: "object",
    properties: {
      acts: {
        type: "array",
        description: "All acts in the story",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The act ID (keep existing ID for updates, use null for new acts)"
            },
            name: {
              type: "string",
              description: "The act's name"
            },
            description: {
              type: "string",
              description: "The act's description"
            },
            chapters: {
              type: "array",
              description: "The chapters within this act",
              items: {
                type: "object",
                properties: {
                  id: {
                    type: "string",
                    description: "The chapter ID (keep existing ID for updates, use null for new chapters)"
                  },
                  name: {
                    type: "string",
                    description: "The chapter's name"
                  },
                  description: {
                    type: "string",
                    description: "The chapter's description"
                  }
                },
                required: ["id", "name", "description"]
              }
            }
          },
          required: ["id", "name", "description", "chapters"]
        }
      }
    },
    required: ["acts"]
  }
};

// ============================================
// BATCH EDIT FUNCTIONS
// ============================================

export const EDIT_CHARACTERS_BATCH_FUNCTION: FunctionCallSchema = {
  name: "edit_characters_batch",
  description: "Edit multiple characters at once. Can modify existing characters or add new ones.",
  parameters: {
    type: "object",
    properties: {
      characters: {
        type: "array",
        description: "Array of characters to edit or create",
        items: {
          type: "object",
          properties: {
            id: {
              type: ["string", "null"],
              description: "The character ID. Use existing ID to modify, null to create new character"
            },
            name: {
              type: "string",
              description: "The character's name"
            },
            description: {
              type: "string",
              description: "The character's description"
            }
          },
          required: ["id", "name", "description"]
        }
      }
    },
    required: ["characters"]
  }
};

export const EDIT_ORGANIZATIONS_BATCH_FUNCTION: FunctionCallSchema = {
  name: "edit_organizations_batch",
  description: "Edit multiple organizations at once. Can modify existing organizations or add new ones.",
  parameters: {
    type: "object",
    properties: {
      organizations: {
        type: "array",
        description: "Array of organizations to edit or create",
        items: {
          type: "object",
          properties: {
            id: {
              type: ["string", "null"],
              description: "The organization ID. Use existing ID to modify, null to create new organization"
            },
            name: {
              type: "string",
              description: "The organization's name"
            },
            description: {
              type: "string",
              description: "The organization's description"
            }
          },
          required: ["id", "name", "description"]
        }
      }
    },
    required: ["organizations"]
  }
};

export const EDIT_LOCATIONS_BATCH_FUNCTION: FunctionCallSchema = {
  name: "edit_locations_batch",
  description: "Edit multiple locations at once. Can modify existing locations or add new ones.",
  parameters: {
    type: "object",
    properties: {
      locations: {
        type: "array",
        description: "Array of locations to edit or create",
        items: {
          type: "object",
          properties: {
            id: {
              type: ["string", "null"],
              description: "The location ID. Use existing ID to modify, null to create new location"
            },
            name: {
              type: "string",
              description: "The location's name"
            },
            description: {
              type: "string",
              description: "The location's description"
            }
          },
          required: ["id", "name", "description"]
        }
      }
    },
    required: ["locations"]
  }
};

export const EDIT_LOREBOOK_BATCH_FUNCTION: FunctionCallSchema = {
  name: "edit_lorebook_batch",
  description: "Edit multiple lorebook entries at once. Can modify existing entries or add new ones.",
  parameters: {
    type: "object",
    properties: {
      entries: {
        type: "array",
        description: "Array of lorebook entries to edit or create",
        items: {
          type: "object",
          properties: {
            id: {
              type: ["string", "null"],
              description: "The lorebook entry ID. Use existing ID to modify, null to create new entry"
            },
            name: {
              type: "string",
              description: "The entry's name"
            },
            description: {
              type: "string",
              description: "The entry's description"
            }
          },
          required: ["id", "name", "description"]
        }
      }
    },
    required: ["entries"]
  }
};

export const EDIT_ACTS_BATCH_FUNCTION: FunctionCallSchema = {
  name: "edit_acts_batch",
  description: "Edit multiple acts at once. Can modify existing acts or add new ones.",
  parameters: {
    type: "object",
    properties: {
      acts: {
        type: "array",
        description: "Array of acts to edit or create",
        items: {
          type: "object",
          properties: {
            id: {
              type: ["string", "null"],
              description: "The act ID. Use existing ID to modify, null to create new act"
            },
            name: {
              type: "string",
              description: "The act's name"
            },
            description: {
              type: "string",
              description: "The act's description"
            },
            chapters: {
              type: "array",
              description: "The chapters within this act",
              items: {
                type: "object",
                properties: {
                  id: {
                    type: ["string", "null"],
                    description: "The chapter ID (keep existing ID for updates, use null for new chapters)"
                  },
                  name: {
                    type: "string",
                    description: "The chapter's name"
                  },
                  description: {
                    type: "string",
                    description: "The chapter's description"
                  }
                },
                required: ["id", "name", "description"]
              }
            }
          },
          required: ["id", "name", "description", "chapters"]
        }
      }
    },
    required: ["acts"]
  }
};

export const EDIT_CHAPTERS_BATCH_FUNCTION: FunctionCallSchema = {
  name: "edit_chapters_batch",
  description: "Edit multiple chapter metadata entries at once (name and description only, not content). Can modify existing chapters or add new ones.",
  parameters: {
    type: "object",
    properties: {
      chapters: {
        type: "array",
        description: "Array of chapters to edit or create",
        items: {
          type: "object",
          properties: {
            id: {
              type: ["string", "null"],
              description: "The chapter ID. Use existing ID to modify, null to create new chapter"
            },
            actId: {
              type: "string",
              description: "The ID of the act this chapter belongs to (required for new chapters)"
            },
            name: {
              type: "string",
              description: "The chapter's name"
            },
            description: {
              type: "string",
              description: "The chapter's description"
            }
          },
          required: ["id", "name", "description"]
        }
      }
    },
    required: ["chapters"]
  }
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get the appropriate function schema based on category and edit scope
 */
export function getEditFunctionSchema(
  category: string,
  isSingleItem: boolean
): FunctionCallSchema {
  if (isSingleItem) {
    switch (category) {
      case 'basicInfo':
        return EDIT_BASIC_INFO_FUNCTION;
      case 'character':
        return EDIT_CHARACTER_FUNCTION;
      case 'organization':
        return EDIT_ORGANIZATION_FUNCTION;
      case 'location':
        return EDIT_LOCATION_FUNCTION;
      case 'lorebook':
        return EDIT_LOREBOOK_ENTRY_FUNCTION;
      case 'act':
        return EDIT_ACT_FUNCTION;
      case 'chapter':
        return EDIT_CHAPTER_METADATA_FUNCTION;
      case 'outline':
        return EDIT_OUTLINE_FUNCTION;
      default:
        throw new Error(`Unknown category: ${category}`);
    }
  } else {
    // Batch editing
    switch (category) {
      case 'basicInfo':
        return EDIT_BASIC_INFO_FUNCTION; // Basic info is always single
      case 'character':
        return EDIT_CHARACTERS_BATCH_FUNCTION;
      case 'organization':
        return EDIT_ORGANIZATIONS_BATCH_FUNCTION;
      case 'location':
        return EDIT_LOCATIONS_BATCH_FUNCTION;
      case 'lorebook':
        return EDIT_LOREBOOK_BATCH_FUNCTION;
      case 'act':
        return EDIT_ACTS_BATCH_FUNCTION;
      case 'chapter':
        return EDIT_CHAPTERS_BATCH_FUNCTION;
      case 'outline':
        return EDIT_OUTLINE_FUNCTION; // Outline is always the full structure
      default:
        throw new Error(`Unknown category: ${category}`);
    }
  }
}

/**
 * Get all edit function schemas as an array
 */
export function getAllEditFunctionSchemas(): FunctionCallSchema[] {
  return [
    EDIT_BASIC_INFO_FUNCTION,
    EDIT_CHARACTER_FUNCTION,
    EDIT_ORGANIZATION_FUNCTION,
    EDIT_LOCATION_FUNCTION,
    EDIT_LOREBOOK_ENTRY_FUNCTION,
    EDIT_ACT_FUNCTION,
    EDIT_CHAPTER_METADATA_FUNCTION,
    EDIT_OUTLINE_FUNCTION,
    EDIT_CHARACTERS_BATCH_FUNCTION,
    EDIT_ORGANIZATIONS_BATCH_FUNCTION,
    EDIT_LOCATIONS_BATCH_FUNCTION,
    EDIT_LOREBOOK_BATCH_FUNCTION,
    EDIT_ACTS_BATCH_FUNCTION,
    EDIT_CHAPTERS_BATCH_FUNCTION
  ];
}
