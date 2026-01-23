import type { SimplifiedStoryObjects } from '../../../store/unifiedObjectStore';
import { parseToolName, resolveStoryObjectName } from '../../../agent/utils/objectNameResolver';

type EditType = "add" | "edit" | "remove" | "init";

interface ToolMeta {
  editType: EditType;
  title: string;
  description: string;
  summary?: (args: any) => string;
}

const meta: Record<string, ToolMeta> = {
  create_basic_info: {
    editType: "init",
    title: "Create Basic Info",
    description: "Set the project's title, logline, and genre.",
    summary: (args) =>
      [args?.title, args?.logline, args?.genre].filter(Boolean).join(" · "),
  },
  update_basic_info: {
    editType: "edit",
    title: "Update Basic Info",
    description: "Modify the project's basic info.",
    summary: (args) =>
      [args?.title, args?.logline, args?.genre].filter(Boolean).join(" · "),
  },

  create_character: {
    editType: "add",
    title: "Add Character",
    description: "Create a new character.",
    summary: (args) => args?.name || "New character",
  },
  update_character: {
    editType: "edit",
    title: "Edit Character",
    description: "Update a character.",
    summary: (args) => args?.name || args?.id || "Character",
  },
  delete_character: {
    editType: "remove",
    title: "Delete Character",
    description: "Remove a character.",
    summary: (args) => args?.id || "Character",
  },

  create_organization: {
    editType: "add",
    title: "Add Organization",
    description: "Create a new organization.",
    summary: (args) => args?.name || "Organization",
  },
  update_organization: {
    editType: "edit",
    title: "Edit Organization",
    description: "Update an organization.",
    summary: (args) => args?.name || args?.id || "Organization",
  },
  delete_organization: {
    editType: "remove",
    title: "Delete Organization",
    description: "Remove an organization.",
    summary: (args) => args?.id || "Organization",
  },

  create_location: {
    editType: "add",
    title: "Add Location",
    description: "Create a new location.",
    summary: (args) => args?.name || "Location",
  },
  update_location: {
    editType: "edit",
    title: "Edit Location",
    description: "Update a location.",
    summary: (args) => args?.name || args?.id || "Location",
  },
  delete_location: {
    editType: "remove",
    title: "Delete Location",
    description: "Remove a location.",
    summary: (args) => args?.id || "Location",
  },

  create_lorebook_entry: {
    editType: "add",
    title: "Add Lore Entry",
    description: "Create a lorebook entry.",
    summary: (args) => args?.name || "Lore entry",
  },
  update_lorebook_entry: {
    editType: "edit",
    title: "Edit Lore Entry",
    description: "Update a lorebook entry.",
    summary: (args) => args?.name || args?.id || "Lore entry",
  },
  delete_lorebook_entry: {
    editType: "remove",
    title: "Delete Lore Entry",
    description: "Remove a lorebook entry.",
    summary: (args) => args?.id || "Lore entry",
  },

  create_act: {
    editType: "add",
    title: "Add Act",
    description: "Create an act (optionally with chapters).",
    summary: (args) =>
      [args?.name, args?.order != null ? `order ${args.order}` : undefined]
        .filter(Boolean)
        .join(" · "),
  },
  update_act: {
    editType: "edit",
    title: "Edit Act",
    description: "Update an act.",
    summary: (args) =>
      [args?.name, args?.order != null ? `order ${args.order}` : undefined]
        .filter(Boolean)
        .join(" · ") || args?.id,
  },
  delete_act: {
    editType: "remove",
    title: "Delete Act",
    description: "Remove an act.",
    summary: (args) => args?.id || "Act",
  },

  create_chapter: {
    editType: "add",
    title: "Add Chapter",
    description: "Create a chapter within an act.",
    summary: (args) =>
      [args?.name, args?.actId ? `act ${args.actId}` : undefined]
        .filter(Boolean)
        .join(" · "),
  },
  update_chapter: {
    editType: "edit",
    title: "Edit Chapter",
    description: "Update a chapter.",
    summary: (args) =>
      [args?.name, args?.actId ? `act ${args.actId}` : undefined]
        .filter(Boolean)
        .join(" · ") || args?.id,
  },
  delete_chapter: {
    editType: "remove",
    title: "Delete Chapter",
    description: "Remove a chapter.",
    summary: (args) => args?.id || "Chapter",
  },
};

export interface ToolCallValidation {
  valid: boolean;
  error?: string;
}

export class ToolCallService {
  static mapToolToEditType(toolName: string): EditType {
    return meta[toolName]?.editType ?? "edit";
  }

  static getToolCallTitle(toolName: string): string {
    return meta[toolName]?.title ?? `Tool ${toolName}`;
  }

  static getToolCallDescription(toolName: string): string {
    return meta[toolName]?.description ?? "Tool call";
  }

  static getToolDisplayName(toolName: string): string {
    return meta[toolName]?.title ?? toolName;
  }

  static generateToolCallSummary(toolName: string, args: any): string {
    const base = meta[toolName];
    if (!base) return "Tool call";
    const summary = base.summary ? base.summary(args) : undefined;
    return summary ? `${base.description}: ${summary}` : base.description;
  }

  /**
   * Validate tool call arguments.
   * For update_* and delete_* tools:
   * - Requires a valid 'id' field
   * - If storyObjects provided, validates ID exists
   */
  static validateToolCall(
    toolName: string,
    args: any,
    storyObjects?: SimplifiedStoryObjects
  ): ToolCallValidation {
    const requiresId = toolName.startsWith('update_') || toolName.startsWith('delete_');
    if (requiresId) {
      if (!args?.id) {
        return {
          valid: false,
          error: 'Missing required ID for this operation',
        };
      }
      // Validate ID exists in storyObjects
      if (storyObjects) {
        const parsed = parseToolName(toolName);
        const resolvedName = resolveStoryObjectName(storyObjects, parsed?.objectType, args.id);
        if (!resolvedName) {
          return {
            valid: false,
            error: `Object with ID "${args.id}" not found`,
          };
        }
      }
    }
    return { valid: true };
  }
}

