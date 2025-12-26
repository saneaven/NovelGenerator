/**
 * Function call schemas for image prompt generation.
 * Two separate systems:
 * 1. Object Image Prompt - for story object assets (character, location, etc.)
 * 2. Scene Image Prompt - for scene images in novel editor
 */

import type { FunctionCallSchema } from './chatFunctions';

/**
 * Function schema for generating image prompts for story objects.
 * Used in UnifiedImagePromptModal for character, location, organization, lorebook.
 * Returns only the prompt string.
 */
export const OBJECT_IMAGE_PROMPT_FUNCTION: FunctionCallSchema = {
  name: "generate_object_image_prompt",
  description: "Generate an image prompt for a story object (character, location, organization, or lorebook entry). The prompt should be optimized for the target image generation model.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "The generated image prompt optimized for the specified format (natural language or tag-based)"
      }
    },
    required: ["prompt"]
  }
};

/**
 * Function schema for generating scene image prompts.
 * Used in ImageGenerationModal for novel editor scenes.
 * Returns the prompt and IDs of story objects that should be visually referenced.
 */
export const SCENE_IMAGE_PROMPT_FUNCTION: FunctionCallSchema = {
  name: "generate_scene_image_prompt",
  description: "Generate an image prompt for a scene from the novel, selecting relevant story objects that should be visually represented in the image.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "The generated scene image prompt describing the visual composition"
      },
      reference_object_ids: {
        type: "array",
        items: { type: "string" },
        description: "IDs of story objects (characters, locations, etc.) that should be visually referenced in the scene image"
      }
    },
    required: ["prompt", "reference_object_ids"]
  }
};

/**
 * Get object image prompt functions
 */
export const OBJECT_IMAGE_PROMPT_FUNCTIONS: FunctionCallSchema[] = [
  OBJECT_IMAGE_PROMPT_FUNCTION
];

/**
 * Get scene image prompt functions
 */
export const SCENE_IMAGE_PROMPT_FUNCTIONS: FunctionCallSchema[] = [
  SCENE_IMAGE_PROMPT_FUNCTION
];
