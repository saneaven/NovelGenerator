/**
 * Prompt tree structure for navigation in Prompts & Templates panel
 * Defines the hierarchical organization of all prompts in the system
 */

import React from 'react';
import type { FunctionType, PromptCategory } from '../../types/prompts';
import { SpeechBubble, Globe, Edit, Palette, Settings } from '../icons';

export interface PromptNode {
  id: string;
  label: string;
  icon?: React.ReactNode;
  type: 'category' | 'prompt';

  // For prompt nodes
  functionType?: FunctionType;
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
            functionType: 'agent',
            category: 'systemPrompt',
            name: 'storyObject',
            description: 'Main AI behavior for Story Object conversations'
          },
          {
            id: 'agent-storyobject-user',
            label: 'User Prompt',
            type: 'prompt',
            functionType: 'agent',
            category: 'userPrompt',
            name: 'storyObject',
            description: 'Template for the last user message in agent'
          },
          {
            id: 'agent-storyobject-nonlast',
            label: 'Non-Last User Prompt',
            type: 'prompt',
            functionType: 'agent',
            category: 'nonLastUserPrompt',
            name: 'storyObject',
            description: 'Template for previous user messages in agent history'
          },
          {
            id: 'agent-storyobject-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            functionType: 'agent',
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
            functionType: 'agent',
            category: 'systemPrompt',
            name: 'novelEditor',
            description: 'Main AI behavior for Novel Editor conversations'
          },
          {
            id: 'agent-noveleditor-user',
            label: 'User Prompt',
            type: 'prompt',
            functionType: 'agent',
            category: 'userPrompt',
            name: 'novelEditor',
            description: 'Template for the last user message in novel editor agent'
          },
          {
            id: 'agent-noveleditor-nonlast',
            label: 'Non-Last User Prompt',
            type: 'prompt',
            functionType: 'agent',
            category: 'nonLastUserPrompt',
            name: 'novelEditor',
            description: 'Template for previous user messages in novel editor agent history'
          },
          {
            id: 'agent-noveleditor-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            functionType: 'agent',
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
            functionType: 'agent',
            category: 'systemPrompt',
            name: 'outlineManager',
            description: 'Main AI behavior for Outline Manager conversations'
          },
          {
            id: 'agent-outlinemanager-user',
            label: 'User Prompt',
            type: 'prompt',
            functionType: 'agent',
            category: 'userPrompt',
            name: 'outlineManager',
            description: 'Template for the last user message in outline manager agent'
          },
          {
            id: 'agent-outlinemanager-nonlast',
            label: 'Non-Last User Prompt',
            type: 'prompt',
            functionType: 'agent',
            category: 'nonLastUserPrompt',
            name: 'outlineManager',
            description: 'Template for previous user messages in outline manager agent history'
          },
          {
            id: 'agent-outlinemanager-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            functionType: 'agent',
            category: 'prefill',
            name: 'outlineManager',
            description: 'AI response starter for Outline Manager mode'
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
            functionType: 'translation',
            category: 'systemPrompt',
            name: 'object',
            description: 'Instructions for translating story objects (single or batch)'
          },
          {
            id: 'translation-object-user',
            label: 'User Prompt',
            type: 'prompt',
            functionType: 'translation',
            category: 'userPrompt',
            name: 'object',
            description: 'Auto-generated user message with story object payload'
          },
          {
            id: 'translation-object-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            functionType: 'translation',
            category: 'prefill',
            name: 'object',
            description: 'Template for story-object translation responses'
          }
        ]
      },
      {
        id: 'translation-agentMessages',
        label: 'Agent Messages',
        type: 'category',
        children: [
          {
            id: 'translation-agentMessages-system',
            label: 'System Prompt',
            type: 'prompt',
            functionType: 'translation',
            category: 'systemPrompt',
            name: 'agentMessages',
            description: 'Instructions for translating agent messages'
          },
          {
            id: 'translation-agentMessages-user',
            label: 'User Prompt',
            type: 'prompt',
            functionType: 'translation',
            category: 'userPrompt',
            name: 'agentMessages',
            description: 'Auto-generated user message with agent message payload'
          },
          {
            id: 'translation-agentMessages-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            functionType: 'translation',
            category: 'prefill',
            name: 'agentMessages',
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
            functionType: 'editAssistant',
            category: 'systemPrompt',
            name: 'manuscript',
            description: 'Instructions for manuscript editing behavior'
          },
          {
            id: 'editassistant-manuscript-user',
            label: 'User Prompt',
            type: 'prompt',
            functionType: 'editAssistant',
            category: 'userPrompt',
            name: 'manuscript',
            description: 'Auto-generated user message that conveys manuscript content and requests'
          },
          {
            id: 'editassistant-manuscript-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            functionType: 'editAssistant',
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
            functionType: 'editAssistant',
            category: 'systemPrompt',
            name: 'storyObject',
            description: 'Instructions for story object editing behavior'
          },
          {
            id: 'editassistant-storyobject-user',
            label: 'User Prompt',
            type: 'prompt',
            functionType: 'editAssistant',
            category: 'userPrompt',
            name: 'storyObject',
            description: 'Auto-generated user message that delivers object context and current data'
          },
          {
            id: 'editassistant-storyobject-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            functionType: 'editAssistant',
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
            functionType: 'imagePrompt',
            category: 'systemPrompt',
            name: 'object',
            description: 'Instructions for generating prompts for story object images'
          },
          {
            id: 'imageprompt-object-user',
            label: 'User Prompt',
            type: 'prompt',
            functionType: 'imagePrompt',
            category: 'userPrompt',
            name: 'object',
            description: 'Template for object image prompt requests'
          },
          {
            id: 'imageprompt-object-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            functionType: 'imagePrompt',
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
            functionType: 'imagePrompt',
            category: 'systemPrompt',
            name: 'scene',
            description: 'Instructions for generating scene image prompts with object selection'
          },
          {
            id: 'imageprompt-scene-user',
            label: 'User Prompt',
            type: 'prompt',
            functionType: 'imagePrompt',
            category: 'userPrompt',
            name: 'scene',
            description: 'Template for scene image prompt requests with available objects'
          },
          {
            id: 'imageprompt-scene-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            functionType: 'imagePrompt',
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
            functionType: 'imagePrompt',
            category: 'systemPrompt',
            name: 'coverImage',
            description: 'Instructions for generating cover image prompts from story context'
          },
          {
            id: 'imageprompt-coverimage-user',
            label: 'User Prompt',
            type: 'prompt',
            functionType: 'imagePrompt',
            category: 'userPrompt',
            name: 'coverImage',
            description: 'Template for cover image prompt requests with title, logline, and selected objects'
          },
          {
            id: 'imageprompt-coverimage-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            functionType: 'imagePrompt',
            category: 'prefill',
            name: 'coverImage',
            description: 'Template for cover image prompt responses'
          }
        ]
      }
    ]
  },
  {
    id: 'common',
    label: 'Common',
    icon: <Settings size="sm" />,
    type: 'category',
    children: [
      {
        id: 'common-feedback',
        label: 'Feedback',
        type: 'prompt',
        functionType: 'common',
        category: 'userPrompt',
        name: 'feedback',
        description: 'Template for feedback message about function call results. Appended to user input on retry.'
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
