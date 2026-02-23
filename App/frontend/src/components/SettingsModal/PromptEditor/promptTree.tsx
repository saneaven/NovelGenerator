/**
 * Scenario tree structure for navigation in Prompts & Templates panel.
 * Leaf nodes represent a single ScenarioDocument for (task_type, task_subtype).
 */

import React from 'react';
import type { TaskType } from '../../../types/scenarios';
import { SpeechBubble, Globe, Edit, Palette } from '../../icons';

export interface PromptNode {
  id: string;
  label: string;
  icon?: React.ReactNode;
  type: 'category' | 'prompt';

  // For scenario nodes
  taskType?: TaskType;
  taskSubtype?: string;
  description?: string;

  // For category nodes
  children?: PromptNode[];
  defaultExpanded?: boolean;
}

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
        type: 'prompt',
        taskType: 'agent',
        taskSubtype: 'planMode',
        description: 'Scenario for Agent Plan mode',
      },
      {
        id: 'agent-agentMode',
        label: 'Agent Mode',
        type: 'prompt',
        taskType: 'agent',
        taskSubtype: 'agentMode',
        description: 'Scenario for Agent mode',
      },
    ],
  },
  {
    id: 'memory',
    label: 'Memory',
    icon: <SpeechBubble size="sm" />,
    type: 'category',
    defaultExpanded: true,
    children: [
      {
        id: 'memory-summary',
        label: 'Summary',
        type: 'prompt',
        taskType: 'memory',
        taskSubtype: 'summary',
        description: 'Scenario for rolling memory summarization prompt',
      },
    ],
  },
  {
    id: 'translation',
    label: 'Translation',
    icon: <Globe size="sm" />,
    type: 'category',
    defaultExpanded: true,
    children: [
      {
        id: 'translation-object',
        label: 'Story Objects',
        type: 'prompt',
        taskType: 'translation',
        taskSubtype: 'object',
        description: 'Scenario for translating story objects',
      },
      {
        id: 'translation-message',
        label: 'Messages',
        type: 'prompt',
        taskType: 'translation',
        taskSubtype: 'message',
        description: 'Scenario for translating conversation messages',
      },
    ],
  },
  {
    id: 'editAssistant',
    label: 'Edit Assistant',
    icon: <Edit size="sm" />,
    type: 'category',
    defaultExpanded: true,
    children: [
      {
        id: 'editAssistant-manuscript',
        label: 'Manuscript',
        type: 'prompt',
        taskType: 'editAssistant',
        taskSubtype: 'manuscript',
        description: 'Scenario for editing manuscripts',
      },
      {
        id: 'editAssistant-storyObject',
        label: 'Story Object',
        type: 'prompt',
        taskType: 'editAssistant',
        taskSubtype: 'storyObject',
        description: 'Scenario for editing story objects',
      },
    ],
  },
  {
    id: 'imagePrompt',
    label: 'Image Prompt',
    icon: <Palette size="sm" />,
    type: 'category',
    defaultExpanded: true,
    children: [
      {
        id: 'imagePrompt-object',
        label: 'Object',
        type: 'prompt',
        taskType: 'imagePrompt',
        taskSubtype: 'object',
        description: 'Scenario for object image prompts',
      },
      {
        id: 'imagePrompt-scene',
        label: 'Scene',
        type: 'prompt',
        taskType: 'imagePrompt',
        taskSubtype: 'scene',
        description: 'Scenario for scene image prompts',
      },
    ],
  },
];

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

export function getFirstPromptNode(tree: PromptNode[] = PROMPT_TREE): PromptNode | null {
  const allPrompts = getAllPromptNodes(tree);
  return allPrompts.length > 0 ? allPrompts[0] : null;
}

