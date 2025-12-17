/**
 * Prompt tree structure for navigation in Prompts & Templates panel
 * Defines the hierarchical organization of all prompts in the system
 */

import React from 'react';
import type { FunctionType, PromptCategory } from '../../types/prompts';
import { Chat, Globe, Edit, Document, Palette } from '../icons';

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
    id: 'chat',
    label: 'Chat',
    icon: <Chat size="sm" />,
    type: 'category',
    defaultExpanded: true,
    children: [
      {
        id: 'chat-workspace',
        label: 'Workspace Mode',
        type: 'category',
        defaultExpanded: true,
        children: [
          {
            id: 'chat-workspace-system',
            label: 'System Prompt',
            type: 'prompt',
            functionType: 'chat',
            category: 'systemPrompt',
            name: 'workspace',
            description: 'Main AI behavior for Workspace conversations'
          },
          {
            id: 'chat-workspace-user',
            label: 'User Prompt',
            type: 'prompt',
            functionType: 'chat',
            category: 'userPrompt',
            name: 'workspace',
            description: 'Template for the last user message in chat'
          },
          {
            id: 'chat-workspace-nonlast',
            label: 'Non-Last User Prompt',
            type: 'prompt',
            functionType: 'chat',
            category: 'nonLastUserPrompt',
            name: 'workspace',
            description: 'Template for previous user messages in chat history'
          },
          {
            id: 'chat-workspace-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            functionType: 'chat',
            category: 'prefill',
            name: 'workspace',
            description: 'AI response starter for Workspace mode'
          }
        ]
      },
      {
        id: 'chat-noveleditor',
        label: 'Novel Editor Mode',
        type: 'category',
        children: [
          {
            id: 'chat-noveleditor-system',
            label: 'System Prompt',
            type: 'prompt',
            functionType: 'chat',
            category: 'systemPrompt',
            name: 'novelEditor',
            description: 'Main AI behavior for Novel Editor conversations'
          },
          {
            id: 'chat-noveleditor-user',
            label: 'User Prompt',
            type: 'prompt',
            functionType: 'chat',
            category: 'userPrompt',
            name: 'novelEditor',
            description: 'Template for the last user message in novel editor chat'
          },
          {
            id: 'chat-noveleditor-nonlast',
            label: 'Non-Last User Prompt',
            type: 'prompt',
            functionType: 'chat',
            category: 'nonLastUserPrompt',
            name: 'novelEditor',
            description: 'Template for previous user messages in novel editor chat history'
          },
          {
            id: 'chat-noveleditor-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            functionType: 'chat',
            category: 'prefill',
            name: 'novelEditor',
            description: 'AI response starter for Novel Editor mode'
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
        id: 'translation-chat',
        label: 'Chat Messages',
        type: 'category',
        children: [
          {
            id: 'translation-chat-system',
            label: 'System Prompt',
            type: 'prompt',
            functionType: 'translation',
            category: 'systemPrompt',
            name: 'chat',
            description: 'Instructions for translating chat messages'
          },
          {
            id: 'translation-chat-user',
            label: 'User Prompt',
            type: 'prompt',
            functionType: 'translation',
            category: 'userPrompt',
            name: 'chat',
            description: 'Auto-generated user message with chat payload'
          },
          {
            id: 'translation-chat-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            functionType: 'translation',
            category: 'prefill',
            name: 'chat',
            description: 'Template for chat translation responses'
          }
        ]
      }
    ]
  },
  {
    id: 'storyobjectedit',
    label: 'Story Object Edit',
    icon: <Edit size="sm" />,
    type: 'category',
    children: [
      {
        id: 'storyobjectedit-system',
        label: 'System Prompt',
        type: 'prompt',
        functionType: 'storyObjectEdit',
        category: 'systemPrompt',
        description: 'Instructions for story object editing behavior'
      },
      {
        id: 'storyobjectedit-user',
        label: 'User Prompt',
        type: 'prompt',
        functionType: 'storyObjectEdit',
        category: 'userPrompt',
        description: 'Auto-generated user message that delivers object context and current data'
      },
      {
        id: 'storyobjectedit-prefill',
        label: 'Prefill Template',
        type: 'prompt',
        functionType: 'storyObjectEdit',
        category: 'prefill',
        description: 'Template for story object edit responses'
      }
    ]
  },
  {
    id: 'manuscriptedit',
    label: 'Manuscript Edit',
    icon: <Document size="sm" />,
    type: 'category',
    children: [
      {
        id: 'manuscriptedit-system',
        label: 'System Prompt',
        type: 'prompt',
        functionType: 'manuscriptEdit',
        category: 'systemPrompt',
        description: 'Instructions for manuscript editing behavior'
      },
      {
        id: 'manuscriptedit-user',
        label: 'User Prompt',
        type: 'prompt',
        functionType: 'manuscriptEdit',
        category: 'userPrompt',
        description: 'Auto-generated user message that conveys manuscript content and requests'
      },
      {
        id: 'manuscriptedit-prefill',
        label: 'Prefill Template',
        type: 'prompt',
        functionType: 'manuscriptEdit',
        category: 'prefill',
        description: 'Template for manuscript edit responses'
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
      }
    ]
  }
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
