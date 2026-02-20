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
  taskSubtype?: string;
  category?: PromptCategory;
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
        id: 'agent-planMode',
        label: 'Plan Mode',
        type: 'category',
        defaultExpanded: true,
        children: [
          {
            id: 'agent-planMode-system',
            label: 'System Prompt',
            type: 'prompt',
            taskType: 'agent',
            taskSubtype: 'planMode',
            category: 'systemPrompt',
            description: 'Main AI behavior for Plan mode'
          },
          {
            id: 'agent-planMode-memory',
            label: 'Memory Prompt',
            type: 'prompt',
            taskType: 'agent',
            taskSubtype: 'planMode',
            category: 'memoryPrompt',
            description: 'Injected memory context (summary + relevant chats) as a synthetic user message'
          },
          {
            id: 'agent-planMode-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'agent',
            taskSubtype: 'planMode',
            category: 'userPrompt',
            description: 'Default template for user messages (middle messages in multi-turn)'
          },
          {
            id: 'agent-planMode-first',
            label: 'First User Prompt',
            type: 'prompt',
            taskType: 'agent',
            taskSubtype: 'planMode',
            category: 'firstUserPrompt',
            description: 'Template for the first user message in conversation'
          },
          {
            id: 'agent-planMode-last',
            label: 'Last User Prompt',
            type: 'prompt',
            taskType: 'agent',
            taskSubtype: 'planMode',
            category: 'lastUserPrompt',
            description: 'Template for the last (current) user message in agent'
          },
          {
            id: 'agent-planMode-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            taskType: 'agent',
            taskSubtype: 'planMode',
            category: 'prefill',
            description: 'AI response starter for Plan mode'
          }
        ]
      },
      {
        id: 'agent-agentMode',
        label: 'Agent Mode',
        type: 'category',
        children: [
          {
            id: 'agent-agentMode-system',
            label: 'System Prompt',
            type: 'prompt',
            taskType: 'agent',
            taskSubtype: 'agentMode',
            category: 'systemPrompt',
            description: 'Main AI behavior for Agent mode'
          },
          {
            id: 'agent-agentMode-memory',
            label: 'Memory Prompt',
            type: 'prompt',
            taskType: 'agent',
            taskSubtype: 'agentMode',
            category: 'memoryPrompt',
            description: 'Injected memory context (summary + relevant chats) as a synthetic user message'
          },
          {
            id: 'agent-agentMode-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'agent',
            taskSubtype: 'agentMode',
            category: 'userPrompt',
            description: 'Default template for user messages (middle messages in multi-turn)'
          },
          {
            id: 'agent-agentMode-first',
            label: 'First User Prompt',
            type: 'prompt',
            taskType: 'agent',
            taskSubtype: 'agentMode',
            category: 'firstUserPrompt',
            description: 'Template for the first user message in conversation'
          },
          {
            id: 'agent-agentMode-last',
            label: 'Last User Prompt',
            type: 'prompt',
            taskType: 'agent',
            taskSubtype: 'agentMode',
            category: 'lastUserPrompt',
            description: 'Template for the last (current) user message in agent'
          },
          {
            id: 'agent-agentMode-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            taskType: 'agent',
            taskSubtype: 'agentMode',
            category: 'prefill',
            description: 'AI response starter for Agent mode'
          }
        ]
      },
    ]
  },
  {
    id: 'memory',
    label: 'Memory',
    icon: <SpeechBubble size="sm" />,
    type: 'category',
    children: [
      {
        id: 'memory-summary',
        label: 'Summary',
        type: 'category',
        defaultExpanded: true,
        children: [
          {
            id: 'memory-summary-system',
            label: 'System Prompt',
            type: 'prompt',
            taskType: 'memory',
            taskSubtype: 'summary',
            category: 'systemPrompt',
            description: 'System instructions for rolling memory summarization'
          },
          {
            id: 'memory-summary-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'memory',
            taskSubtype: 'summary',
            category: 'userPrompt',
            description: 'Summary update prompt with previous summary and archived messages'
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
            taskSubtype: 'object',
            category: 'systemPrompt',
            description: 'Instructions for translating story objects (single or batch)'
          },
          {
            id: 'translation-object-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'translation',
            taskSubtype: 'object',
            category: 'userPrompt',
            description: 'Auto-generated user message with story object payload'
          },
          {
            id: 'translation-object-initial',
            label: 'Initial User Prompt',
            type: 'prompt',
            taskType: 'translation',
            taskSubtype: 'object',
            category: 'initialUserPrompt',
            description: 'Template for single-message translation requests (rich context)'
          },
          {
            id: 'translation-object-first',
            label: 'First User Prompt',
            type: 'prompt',
            taskType: 'translation',
            taskSubtype: 'object',
            category: 'firstUserPrompt',
            description: 'Template for first feedback in multi-turn translation sessions'
          },
          {
            id: 'translation-object-last',
            label: 'Last User Prompt',
            type: 'prompt',
            taskType: 'translation',
            taskSubtype: 'object',
            category: 'lastUserPrompt',
            description: 'Template for last feedback in multi-turn translation sessions'
          },
          {
            id: 'translation-object-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            taskType: 'translation',
            taskSubtype: 'object',
            category: 'prefill',
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
            taskSubtype: 'message',
            category: 'systemPrompt',
            description: 'Instructions for translating agent messages'
          },
          {
            id: 'translation-message-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'translation',
            taskSubtype: 'message',
            category: 'userPrompt',
            description: 'Auto-generated user message with agent message payload'
          },
          {
            id: 'translation-message-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            taskType: 'translation',
            taskSubtype: 'message',
            category: 'prefill',
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
            taskSubtype: 'manuscript',
            category: 'systemPrompt',
            description: 'Instructions for manuscript editing behavior'
          },
          {
            id: 'editassistant-manuscript-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'editAssistant',
            taskSubtype: 'manuscript',
            category: 'userPrompt',
            description: 'Auto-generated user message that conveys manuscript content and requests'
          },
          {
            id: 'editassistant-manuscript-initial',
            label: 'Initial User Prompt',
            type: 'prompt',
            taskType: 'editAssistant',
            taskSubtype: 'manuscript',
            category: 'initialUserPrompt',
            description: 'Template for single-message manuscript edit requests (rich context)'
          },
          {
            id: 'editassistant-manuscript-first',
            label: 'First User Prompt',
            type: 'prompt',
            taskType: 'editAssistant',
            taskSubtype: 'manuscript',
            category: 'firstUserPrompt',
            description: 'Template for first feedback in multi-turn manuscript edit sessions'
          },
          {
            id: 'editassistant-manuscript-last',
            label: 'Last User Prompt',
            type: 'prompt',
            taskType: 'editAssistant',
            taskSubtype: 'manuscript',
            category: 'lastUserPrompt',
            description: 'Template for last feedback in multi-turn manuscript edit sessions'
          },
          {
            id: 'editassistant-manuscript-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            taskType: 'editAssistant',
            taskSubtype: 'manuscript',
            category: 'prefill',
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
            taskSubtype: 'storyObject',
            category: 'systemPrompt',
            description: 'Instructions for story object editing behavior'
          },
          {
            id: 'editassistant-storyobject-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'editAssistant',
            taskSubtype: 'storyObject',
            category: 'userPrompt',
            description: 'Auto-generated user message that delivers object context and current data'
          },
          {
            id: 'editassistant-storyobject-initial',
            label: 'Initial User Prompt',
            type: 'prompt',
            taskType: 'editAssistant',
            taskSubtype: 'storyObject',
            category: 'initialUserPrompt',
            description: 'Template for single-message story object edit requests (rich context)'
          },
          {
            id: 'editassistant-storyobject-first',
            label: 'First User Prompt',
            type: 'prompt',
            taskType: 'editAssistant',
            taskSubtype: 'storyObject',
            category: 'firstUserPrompt',
            description: 'Template for first feedback in multi-turn story object edit sessions'
          },
          {
            id: 'editassistant-storyobject-last',
            label: 'Last User Prompt',
            type: 'prompt',
            taskType: 'editAssistant',
            taskSubtype: 'storyObject',
            category: 'lastUserPrompt',
            description: 'Template for last feedback in multi-turn story object edit sessions'
          },
          {
            id: 'editassistant-storyobject-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            taskType: 'editAssistant',
            taskSubtype: 'storyObject',
            category: 'prefill',
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
            taskSubtype: 'object',
            category: 'systemPrompt',
            description: 'Instructions for generating prompts for story object images'
          },
          {
            id: 'imageprompt-object-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            taskSubtype: 'object',
            category: 'userPrompt',
            description: 'Template for object image prompt requests'
          },
          {
            id: 'imageprompt-object-initial',
            label: 'Initial User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            taskSubtype: 'object',
            category: 'initialUserPrompt',
            description: 'Template for single-message object image prompt requests (rich context)'
          },
          {
            id: 'imageprompt-object-first',
            label: 'First User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            taskSubtype: 'object',
            category: 'firstUserPrompt',
            description: 'Template for first feedback in multi-turn object image prompt sessions'
          },
          {
            id: 'imageprompt-object-last',
            label: 'Last User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            taskSubtype: 'object',
            category: 'lastUserPrompt',
            description: 'Template for last feedback in multi-turn object image prompt sessions'
          },
          {
            id: 'imageprompt-object-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            taskType: 'imagePrompt',
            taskSubtype: 'object',
            category: 'prefill',
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
            taskSubtype: 'scene',
            category: 'systemPrompt',
            description: 'Instructions for generating scene image prompts with object selection'
          },
          {
            id: 'imageprompt-scene-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            taskSubtype: 'scene',
            category: 'userPrompt',
            description: 'Template for scene image prompt requests with available objects'
          },
          {
            id: 'imageprompt-scene-initial',
            label: 'Initial User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            taskSubtype: 'scene',
            category: 'initialUserPrompt',
            description: 'Template for single-message scene image prompt requests (rich context)'
          },
          {
            id: 'imageprompt-scene-first',
            label: 'First User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            taskSubtype: 'scene',
            category: 'firstUserPrompt',
            description: 'Template for first feedback in multi-turn scene image prompt sessions'
          },
          {
            id: 'imageprompt-scene-last',
            label: 'Last User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            taskSubtype: 'scene',
            category: 'lastUserPrompt',
            description: 'Template for last feedback in multi-turn scene image prompt sessions'
          },
          {
            id: 'imageprompt-scene-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            taskType: 'imagePrompt',
            taskSubtype: 'scene',
            category: 'prefill',
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
            taskSubtype: 'coverImage',
            category: 'systemPrompt',
            description: 'Instructions for generating cover image prompts from story context'
          },
          {
            id: 'imageprompt-coverimage-user',
            label: 'User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            taskSubtype: 'coverImage',
            category: 'userPrompt',
            description: 'Template for cover image prompt requests with title, logline, and selected objects'
          },
          {
            id: 'imageprompt-coverimage-initial',
            label: 'Initial User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            taskSubtype: 'coverImage',
            category: 'initialUserPrompt',
            description: 'Template for single-message cover image prompt requests (rich context)'
          },
          {
            id: 'imageprompt-coverimage-first',
            label: 'First User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            taskSubtype: 'coverImage',
            category: 'firstUserPrompt',
            description: 'Template for first feedback in multi-turn cover image prompt sessions'
          },
          {
            id: 'imageprompt-coverimage-last',
            label: 'Last User Prompt',
            type: 'prompt',
            taskType: 'imagePrompt',
            taskSubtype: 'coverImage',
            category: 'lastUserPrompt',
            description: 'Template for last feedback in multi-turn cover image prompt sessions'
          },
          {
            id: 'imageprompt-coverimage-prefill',
            label: 'Prefill Template',
            type: 'prompt',
            taskType: 'imagePrompt',
            taskSubtype: 'coverImage',
            category: 'prefill',
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
