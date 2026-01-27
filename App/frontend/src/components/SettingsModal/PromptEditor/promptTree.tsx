/**
 * Prompt tree structure for navigation in Prompts & Templates panel
 * Defines the hierarchical organization of all prompts in the system
 */

import React from 'react';
import type { TaskType, PromptCategory } from '../../../types/prompts';
import { SpeechBubble, Globe, Edit, Palette } from '../../icons';

export interface PromptNode {
  id: string;
  label: string;
  icon?: React.ReactNode;
  type: 'category' | 'prompt';

  // For prompt nodes
  taskType?: TaskType;
  category?: PromptCategory;
  name?: string;
  description?: string;

  // For category nodes
  children?: PromptNode[];
  defaultExpanded?: boolean;
}

/**
 * Complete tree structure of all prompts
 */
export const PROMPT_TREE: PromptNode[] = [
  {
    id: 'agent',
    label: 'Agent',
    icon: <SpeechBubble size="sm" />,
    type: 'category',
    defaultExpanded: true,
    children: [
      {
        id: 'agent-storyobject',
        label: 'Story Object Mode',
        type: 'category',
        defaultExpanded: true,
        children: [
          {
            id: 'agent-storyobject-system',
            label: 'System Prompt',
            type: 'prompt',
            taskType: 'agent',
            category: 'systemPrompt',
            name: 'storyObject',
            description: 'Main AI behavior for Story Object conversations'
          },
          {
            id: 'agent-storyobject-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'agent',
            category: 'userPrompt',
            name: 'storyObject',
            description: 'Default template for user messages (middle messages in multi-turn)'
          },
          {
            id: 'agent-storyobject-first',
            label: 'First User Prompt',
            type: 'prompt',
            taskType: 'agent',
            category: 'firstUserPrompt',
            name: 'storyObject',
            description: 'Template for the first user message in conversation'
          },
          {
            id: 'agent-storyobject-last',
            label: 'Last User Prompt',
            type: 'prompt',
            taskType: 'agent',
            category: 'lastUserPrompt',
            name: 'storyObject',
            description: 'Template for the last (current) user message in agent'
          },
          {
            id: 'agent-storyobject-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            taskType: 'agent',
            category: 'prefill',
            name: 'storyObject',
            description: 'AI response starter for Story Object mode'
          }
        ]
      },
      {
        id: 'agent-noveleditor',
        label: 'Novel Editor Mode',
        type: 'category',
        children: [
          {
            id: 'agent-noveleditor-system',
            label: 'System Prompt',
            type: 'prompt',
            taskType: 'agent',
            category: 'systemPrompt',
            name: 'novelEditor',
            description: 'Main AI behavior for Novel Editor conversations'
          },
          {
            id: 'agent-noveleditor-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'agent',
            category: 'userPrompt',
            name: 'novelEditor',
            description: 'Default template for user messages (middle messages in multi-turn)'
          },
          {
            id: 'agent-noveleditor-first',
            label: 'First User Prompt',
            type: 'prompt',
            taskType: 'agent',
            category: 'firstUserPrompt',
            name: 'novelEditor',
            description: 'Template for the first user message in novel editor conversation'
          },
          {
            id: 'agent-noveleditor-last',
            label: 'Last User Prompt',
            type: 'prompt',
            taskType: 'agent',
            category: 'lastUserPrompt',
            name: 'novelEditor',
            description: 'Template for the last (current) user message in novel editor agent'
          },
          {
            id: 'agent-noveleditor-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            taskType: 'agent',
            category: 'prefill',
            name: 'novelEditor',
            description: 'AI response starter for Novel Editor mode'
          }
        ]
      },
      {
        id: 'agent-outlinemanager',
        label: 'Outline Manager Mode',
        type: 'category',
        children: [
          {
            id: 'agent-outlinemanager-system',
            label: 'System Prompt',
            type: 'prompt',
            taskType: 'agent',
            category: 'systemPrompt',
            name: 'outlineManager',
            description: 'Main AI behavior for Outline Manager conversations'
          },
          {
            id: 'agent-outlinemanager-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'agent',
            category: 'userPrompt',
            name: 'outlineManager',
            description: 'Default template for user messages (middle messages in multi-turn)'
          },
          {
            id: 'agent-outlinemanager-first',
            label: 'First User Prompt',
            type: 'prompt',
            taskType: 'agent',
            category: 'firstUserPrompt',
            name: 'outlineManager',
            description: 'Template for the first user message in outline manager conversation'
          },
          {
            id: 'agent-outlinemanager-last',
            label: 'Last User Prompt',
            type: 'prompt',
            taskType: 'agent',
            category: 'lastUserPrompt',
            name: 'outlineManager',
            description: 'Template for the last (current) user message in outline manager agent'
          },
          {
            id: 'agent-outlinemanager-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            taskType: 'agent',
            category: 'prefill',
            name: 'outlineManager',
            description: 'AI response starter for Outline Manager mode'
          }
        ]
      },
      {
        id: 'agent-memory',
        label: 'Memory',
        type: 'category',
        children: [
          {
            id: 'agent-memory-summary-system',
            label: 'Memory Summary - System Prompt',
            type: 'prompt',
            taskType: 'agent',
            category: 'systemPrompt',
            name: 'memorySummary',
            description: 'System instructions for rolling memory summarization'
          },
          {
            id: 'agent-memory-summary-user',
            label: 'Memory Summary - User Prompt',
            type: 'prompt',
            taskType: 'agent',
            category: 'userPrompt',
            name: 'memorySummary',
            description: 'User prompt template that includes previous summary + archived messages'
          }
        ]
      }
    ]
  },
  {
    id: 'translation',
    label: 'Translation',
    icon: <Globe size="sm" />,
    type: 'category',
    children: [
      {
        id: 'translation-object',
        label: 'Story Objects',
        type: 'category',
        defaultExpanded: true,
        children: [
          {
            id: 'translation-object-system',
            label: 'System Prompt',
            type: 'prompt',
            taskType: 'translation',
            category: 'systemPrompt',
            name: 'object',
            description: 'Instructions for translating story objects (single or batch)'
          },
          {
            id: 'translation-object-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'translation',
            category: 'userPrompt',
            name: 'object',
            description: 'Auto-generated user message with story object payload'
          },
          {
            id: 'translation-object-initial',
            label: 'Initial User Prompt',
            type: 'prompt',
            taskType: 'translation',
            category: 'initialUserPrompt',
            name: 'object',
            description: 'Template for single-message translation requests (rich context)'
          },
          {
            id: 'translation-object-first',
            label: 'First User Prompt',
            type: 'prompt',
            taskType: 'translation',
            category: 'firstUserPrompt',
            name: 'object',
            description: 'Template for first feedback in multi-turn translation sessions'
          },
          {
            id: 'translation-object-last',
            label: 'Last User Prompt',
            type: 'prompt',
            taskType: 'translation',
            category: 'lastUserPrompt',
            name: 'object',
            description: 'Template for last feedback in multi-turn translation sessions'
          },
          {
            id: 'translation-object-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            taskType: 'translation',
            category: 'prefill',
            name: 'object',
            description: 'Template for story-object translation responses'
          }
        ]
      },
      {
        id: 'translation-message',
        label: 'Agent Messages',
        type: 'category',
        children: [
          {
            id: 'translation-message-system',
            label: 'System Prompt',
            type: 'prompt',
            taskType: 'translation',
            category: 'systemPrompt',
            name: 'message',
            description: 'Instructions for translating agent messages'
          },
          {
            id: 'translation-message-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'translation',
            category: 'userPrompt',
            name: 'message',
            description: 'Auto-generated user message with agent message payload'
          },
          {
            id: 'translation-message-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            taskType: 'translation',
            category: 'prefill',
            name: 'message',
            description: 'Template for agent message translation responses'
          }
        ]
      }
    ]
  },
  {
    id: 'editassistant',
    label: 'Edit Assistant',
    icon: <Edit size="sm" />,
    type: 'category',
    children: [
      {
        id: 'editassistant-manuscript',
        label: 'Manuscript',
        type: 'category',
        defaultExpanded: true,
        children: [
          {
            id: 'editassistant-manuscript-system',
            label: 'System Prompt',
            type: 'prompt',
            taskType: 'editAssistant',
            category: 'systemPrompt',
            name: 'manuscript',
            description: 'Instructions for manuscript editing behavior'
          },
          {
            id: 'editassistant-manuscript-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'editAssistant',
            category: 'userPrompt',
            name: 'manuscript',
            description: 'Auto-generated user message that conveys manuscript content and requests'
          },
          {
            id: 'editassistant-manuscript-initial',
            label: 'Initial User Prompt',
            type: 'prompt',
            taskType: 'editAssistant',
            category: 'initialUserPrompt',
            name: 'manuscript',
            description: 'Template for single-message manuscript edit requests (rich context)'
          },
          {
            id: 'editassistant-manuscript-first',
            label: 'First User Prompt',
            type: 'prompt',
            taskType: 'editAssistant',
            category: 'firstUserPrompt',
            name: 'manuscript',
            description: 'Template for first feedback in multi-turn manuscript edit sessions'
          },
          {
            id: 'editassistant-manuscript-last',
            label: 'Last User Prompt',
            type: 'prompt',
            taskType: 'editAssistant',
            category: 'lastUserPrompt',
            name: 'manuscript',
            description: 'Template for last feedback in multi-turn manuscript edit sessions'
          },
          {
            id: 'editassistant-manuscript-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            taskType: 'editAssistant',
            category: 'prefill',
            name: 'manuscript',
            description: 'Template for manuscript edit responses'
          }
        ]
      },
      {
        id: 'editassistant-storyobject',
        label: 'Story Object',
        type: 'category',
        children: [
          {
            id: 'editassistant-storyobject-system',
            label: 'System Prompt',
            type: 'prompt',
            taskType: 'editAssistant',
            category: 'systemPrompt',
            name: 'storyObject',
            description: 'Instructions for story object editing behavior'
          },
          {
            id: 'editassistant-storyobject-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'editAssistant',
            category: 'userPrompt',
            name: 'storyObject',
            description: 'Auto-generated user message that delivers object context and current data'
          },
          {
            id: 'editassistant-storyobject-initial',
            label: 'Initial User Prompt',
            type: 'prompt',
            taskType: 'editAssistant',
            category: 'initialUserPrompt',
            name: 'storyObject',
            description: 'Template for single-message story object edit requests (rich context)'
          },
          {
            id: 'editassistant-storyobject-first',
            label: 'First User Prompt',
            type: 'prompt',
            taskType: 'editAssistant',
            category: 'firstUserPrompt',
            name: 'storyObject',
            description: 'Template for first feedback in multi-turn story object edit sessions'
          },
          {
            id: 'editassistant-storyobject-last',
            label: 'Last User Prompt',
            type: 'prompt',
            taskType: 'editAssistant',
            category: 'lastUserPrompt',
            name: 'storyObject',
            description: 'Template for last feedback in multi-turn story object edit sessions'
          },
          {
            id: 'editassistant-storyobject-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            taskType: 'editAssistant',
            category: 'prefill',
            name: 'storyObject',
            description: 'Template for story object edit responses'
          }
        ]
      }
    ]
  },
  {
    id: 'imageprompt',
    label: 'Image Prompt',
    icon: <Palette size="sm" />,
    type: 'category',
    children: [
      {
        id: 'imageprompt-object',
        label: 'Object Prompt',
        type: 'category',
        defaultExpanded: true,
        children: [
          {
            id: 'imageprompt-object-system',
            label: 'System Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            category: 'systemPrompt',
            name: 'object',
            description: 'Instructions for generating prompts for story object images'
          },
          {
            id: 'imageprompt-object-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            category: 'userPrompt',
            name: 'object',
            description: 'Template for object image prompt requests'
          },
          {
            id: 'imageprompt-object-initial',
            label: 'Initial User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            category: 'initialUserPrompt',
            name: 'object',
            description: 'Template for single-message object image prompt requests (rich context)'
          },
          {
            id: 'imageprompt-object-first',
            label: 'First User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            category: 'firstUserPrompt',
            name: 'object',
            description: 'Template for first feedback in multi-turn object image prompt sessions'
          },
          {
            id: 'imageprompt-object-last',
            label: 'Last User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            category: 'lastUserPrompt',
            name: 'object',
            description: 'Template for last feedback in multi-turn object image prompt sessions'
          },
          {
            id: 'imageprompt-object-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            taskType: 'imagePrompt',
            category: 'prefill',
            name: 'object',
            description: 'Template for object image prompt responses'
          }
        ]
      },
      {
        id: 'imageprompt-scene',
        label: 'Scene Prompt',
        type: 'category',
        children: [
          {
            id: 'imageprompt-scene-system',
            label: 'System Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            category: 'systemPrompt',
            name: 'scene',
            description: 'Instructions for generating scene image prompts with object selection'
          },
          {
            id: 'imageprompt-scene-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            category: 'userPrompt',
            name: 'scene',
            description: 'Template for scene image prompt requests with available objects'
          },
          {
            id: 'imageprompt-scene-initial',
            label: 'Initial User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            category: 'initialUserPrompt',
            name: 'scene',
            description: 'Template for single-message scene image prompt requests (rich context)'
          },
          {
            id: 'imageprompt-scene-first',
            label: 'First User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            category: 'firstUserPrompt',
            name: 'scene',
            description: 'Template for first feedback in multi-turn scene image prompt sessions'
          },
          {
            id: 'imageprompt-scene-last',
            label: 'Last User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            category: 'lastUserPrompt',
            name: 'scene',
            description: 'Template for last feedback in multi-turn scene image prompt sessions'
          },
          {
            id: 'imageprompt-scene-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            taskType: 'imagePrompt',
            category: 'prefill',
            name: 'scene',
            description: 'Template for scene image prompt responses'
          }
        ]
      },
      {
        id: 'imageprompt-coverimage',
        label: 'Cover Image Prompt',
        type: 'category',
        children: [
          {
            id: 'imageprompt-coverimage-system',
            label: 'System Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            category: 'systemPrompt',
            name: 'coverImage',
            description: 'Instructions for generating cover image prompts from story context'
          },
          {
            id: 'imageprompt-coverimage-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            category: 'userPrompt',
            name: 'coverImage',
            description: 'Template for cover image prompt requests with title, logline, and selected objects'
          },
          {
            id: 'imageprompt-coverimage-initial',
            label: 'Initial User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            category: 'initialUserPrompt',
            name: 'coverImage',
            description: 'Template for single-message cover image prompt requests (rich context)'
          },
          {
            id: 'imageprompt-coverimage-first',
            label: 'First User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            category: 'firstUserPrompt',
            name: 'coverImage',
            description: 'Template for first feedback in multi-turn cover image prompt sessions'
          },
          {
            id: 'imageprompt-coverimage-last',
            label: 'Last User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            category: 'lastUserPrompt',
            name: 'coverImage',
            description: 'Template for last feedback in multi-turn cover image prompt sessions'
          },
          {
            id: 'imageprompt-coverimage-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            taskType: 'imagePrompt',
            category: 'prefill',
            name: 'coverImage',
            description: 'Template for cover image prompt responses'
          }
        ]
      }
    ]
  },
];

/**
 * Helper to find a prompt node by ID
 */
export function findPromptNode(nodeId: string, tree: PromptNode[] = PROMPT_TREE): PromptNode | null {
  for (const node of tree) {
    if (node.id === nodeId) {
      return node;
    }

    if (node.children) {
      const found = findPromptNode(nodeId, node.children);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Helper to get all prompt nodes (excluding categories)
 */
export function getAllPromptNodes(tree: PromptNode[] = PROMPT_TREE): PromptNode[] {
  const prompts: PromptNode[] = [];

  for (const node of tree) {
    if (node.type === 'prompt') {
      prompts.push(node);
    }

    if (node.children) {
      prompts.push(...getAllPromptNodes(node.children));
    }
  }

  return prompts;
}

/**
 * Helper to get the first prompt node (for default selection)
 */
export function getFirstPromptNode(tree: PromptNode[] = PROMPT_TREE): PromptNode | null {
  const allPrompts = getAllPromptNodes(tree);
  return allPrompts.length > 0 ? allPrompts[0] : null;
}
