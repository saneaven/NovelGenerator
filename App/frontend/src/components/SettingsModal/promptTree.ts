/**
 * Prompt tree structure for navigation in Prompts & Templates panel
 * Defines the hierarchical organization of all prompts in the system
 */

import type { FunctionType, PromptCategory } from '../../prompts/defaults';

export interface PromptNode {
  id: string;
  label: string;
  icon?: string;
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
    icon: '💬',
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
            id: 'chat-workspace-instructions',
            label: 'Function Instructions',
            type: 'prompt',
            functionType: 'chat',
            category: 'functionInstructions',
            name: 'workspace',
            description: 'Available function calling instructions for Workspace'
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
            id: 'chat-noveleditor-instructions',
            label: 'Function Instructions',
            type: 'prompt',
            functionType: 'chat',
            category: 'functionInstructions',
            name: 'novelEditor',
            description: 'Available function calling instructions for Novel Editor'
          }
        ]
      },
      {
        id: 'chat-prefill',
        label: 'Prefill Template',
        type: 'prompt',
        functionType: 'chat',
        category: 'prefill',
        description: 'AI response starter template'
      },
      {
        id: 'chat-user-system',
        label: 'User System Message',
        type: 'category',
        children: [
          {
            id: 'chat-user-system-lastmessage',
            label: 'Last User Message Tag',
            type: 'prompt',
            functionType: 'chat',
            category: 'userMessageTag',
            name: 'lastMessage',
            description: 'Wrapping format for the most recent user message in chat history'
          },
          {
            id: 'chat-user-system-nonlastmessage',
            label: 'Other Messages Tag',
            type: 'prompt',
            functionType: 'chat',
            category: 'userMessageTag',
            name: 'nonLastMessage',
            description: 'Wrapping format for previous user messages in chat history'
          }
        ]
      }
    ]
  },
  {
    id: 'translation',
    label: 'Translation',
    icon: '🌐',
    type: 'category',
    children: [
      {
        id: 'translation-system',
        label: 'System Prompt',
        type: 'prompt',
        functionType: 'translation',
        category: 'systemPrompt',
        description: 'Instructions for translation behavior and quality standards'
      },
      {
        id: 'translation-prefill',
        label: 'Prefill Template',
        type: 'prompt',
        functionType: 'translation',
        category: 'prefill',
        description: 'Template for translation responses'
      }
    ]
  },
  {
    id: 'storyedit',
    label: 'Story Edit',
    icon: '✏️',
    type: 'category',
    children: [
      {
        id: 'storyedit-system',
        label: 'System Prompt',
        type: 'prompt',
        functionType: 'storyEdit',
        category: 'systemPrompt',
        description: 'Instructions for story object editing behavior'
      },
      {
        id: 'storyedit-prefill',
        label: 'Prefill Template',
        type: 'prompt',
        functionType: 'storyEdit',
        category: 'prefill',
        description: 'Template for story edit responses'
      }
    ]
  },
  {
    id: 'chaptergen',
    label: 'Chapter Generation',
    icon: '📝',
    type: 'category',
    children: [
      {
        id: 'chaptergen-system',
        label: 'System Prompt',
        type: 'prompt',
        functionType: 'chapterGen',
        category: 'systemPrompt',
        description: 'Instructions for chapter content generation'
      },
      {
        id: 'chaptergen-prefill',
        label: 'Prefill Template',
        type: 'prompt',
        functionType: 'chapterGen',
        category: 'prefill',
        description: 'Template for chapter generation responses'
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
