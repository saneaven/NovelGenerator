/**
 * Prompt Type Field Definitions
 * Defines which fields to show for each prompt type in the preview modal.
 */

import type { TaskType } from '../../../types/prompts';

export interface PromptTypeField {
  path: string;           // e.g., 'agent.mode', 'editAssistant.targetParagraphs'
  label: string;          // Display label
  type: 'boolean' | 'text' | 'dropdown' | 'textarea';
  options?: string[];     // For dropdown type
  placeholder?: string;   // For text/textarea
}

// Agent prompts
const AGENT_FIELDS: PromptTypeField[] = [
  { path: 'agent.mode', label: 'Mode', type: 'dropdown', options: ['storyObject', 'novelEditor'] },
];

// Edit Assistant prompts
const EDIT_ASSISTANT_FIELDS: PromptTypeField[] = [
  { path: 'editAssistant.mode', label: 'Mode', type: 'dropdown', options: ['manuscript', 'storyObject'] },
];

// Translation prompts
const TRANSLATION_FIELDS: PromptTypeField[] = [
  { path: 'translation.sourceLanguage', label: 'Source Language', type: 'text', placeholder: 'English' },
  { path: 'translation.targetLanguage', label: 'Target Language', type: 'text', placeholder: 'Korean' },
];

// Image Prompt prompts
const IMAGE_PROMPT_FIELDS: PromptTypeField[] = [
  { path: 'imagePrompt.objectType', label: 'Object Type', type: 'dropdown', options: ['character', 'location', 'organization', 'lorebook'] },
  { path: 'imagePrompt.objectInfo', label: 'Object Info', type: 'textarea', placeholder: 'Character: Name - Description...' },
  { path: 'imagePrompt.promptMode', label: 'Prompt Mode', type: 'dropdown', options: ['natural', 'positive', 'negative'] },
  { path: 'imagePrompt.currentPrompt', label: 'Current Prompt', type: 'textarea', placeholder: 'A tall warrior with long hair...' },
  { path: 'imagePrompt.currentPromptPositive', label: 'Positive Tags', type: 'text', placeholder: 'warrior, long hair, armor' },
  { path: 'imagePrompt.currentPromptNegative', label: 'Negative Tags', type: 'text', placeholder: 'blurry, low quality' },
  { path: 'imagePrompt.scenePreContext', label: 'Scene Pre-Context', type: 'textarea', placeholder: 'The hero enters the cave...' },
  { path: 'imagePrompt.scenePostContext', label: 'Scene Post-Context', type: 'textarea', placeholder: 'He finds the treasure...' },
];

/**
 * Get the prompt type fields for a given task type.
 */
export function getPromptTypeFields(taskType: TaskType): PromptTypeField[] {
  switch (taskType) {
    case 'agent':
      return AGENT_FIELDS;
    case 'editAssistant':
      return EDIT_ASSISTANT_FIELDS;
    case 'translation':
      return TRANSLATION_FIELDS;
    case 'imagePrompt':
      return IMAGE_PROMPT_FIELDS;
    default:
      return [];
  }
}

/**
 * Get a nested value from an object using a dot-separated path.
 */
export function getNestedValue(obj: Record<string, any>, path: string): any {
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current === undefined || current === null) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Set a nested value in an object using a dot-separated path.
 * Returns a new object with the value set.
 */
export function setNestedValue(obj: Record<string, any>, path: string, value: any): Record<string, any> {
  const keys = path.split('.');
  const result = { ...obj };

  let current = result;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    current[key] = current[key] ? { ...current[key] } : {};
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
  return result;
}
