/**
 * Scenario tree structure for navigation in Prompts & Templates panel.
 *
 * category  → top-level groupings (Agent, Memory, …)
 * prompt    → expandable subtype node carrying taskType / taskSubtype
 * promptView → selectable leaf: either 'system' or 'blocks' view of the scenario
 */

import React from 'react';
import type { TaskType } from '../../../types/scenarios';
import { SpeechBubble, Globe, Edit, Palette } from '../../icons';

export type PromptViewKind = 'system' | 'blocks';

export interface PromptNode {
  id: string;
  label: string;
  icon?: React.ReactNode;
  type: 'category' | 'prompt' | 'promptView';

  // For scenario nodes (prompt + promptView)
  taskType?: TaskType;
  taskSubtype?: string;
  description?: string;

  // For promptView nodes
  viewKind?: PromptViewKind;

  // For expandable nodes (category + prompt)
  children?: PromptNode[];
  defaultExpanded?: boolean;
}

/** Build the two promptView children for a prompt node. */
function makeViewChildren(parentId: string, taskType: TaskType, taskSubtype: string): PromptNode[] {
  return [
    {
      id: `${parentId}-system`,
      label: 'System Prompt',
      type: 'promptView',
      taskType,
      taskSubtype,
      viewKind: 'system',
    },
    {
      id: `${parentId}-blocks`,
      label: 'Conversation Blocks',
      type: 'promptView',
      taskType,
      taskSubtype,
      viewKind: 'blocks',
    },
  ];
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
        defaultExpanded: true,
        children: makeViewChildren('agent-planMode', 'agent', 'planMode'),
      },
      {
        id: 'agent-agentMode',
        label: 'Agent Mode',
        type: 'prompt',
        taskType: 'agent',
        taskSubtype: 'agentMode',
        description: 'Scenario for Agent mode',
        defaultExpanded: true,
        children: makeViewChildren('agent-agentMode', 'agent', 'agentMode'),
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
        defaultExpanded: true,
        children: makeViewChildren('memory-summary', 'memory', 'summary'),
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
        defaultExpanded: true,
        children: makeViewChildren('translation-object', 'translation', 'object'),
      },
      {
        id: 'translation-message',
        label: 'Messages',
        type: 'prompt',
        taskType: 'translation',
        taskSubtype: 'message',
        description: 'Scenario for translating conversation messages',
        defaultExpanded: true,
        children: makeViewChildren('translation-message', 'translation', 'message'),
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
        defaultExpanded: true,
        children: makeViewChildren('editAssistant-manuscript', 'editAssistant', 'manuscript'),
      },
      {
        id: 'editAssistant-storyObject',
        label: 'Story Object',
        type: 'prompt',
        taskType: 'editAssistant',
        taskSubtype: 'storyObject',
        description: 'Scenario for editing story objects',
        defaultExpanded: true,
        children: makeViewChildren('editAssistant-storyObject', 'editAssistant', 'storyObject'),
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
        defaultExpanded: true,
        children: makeViewChildren('imagePrompt-object', 'imagePrompt', 'object'),
      },
      {
        id: 'imagePrompt-scene',
        label: 'Scene',
        type: 'prompt',
        taskType: 'imagePrompt',
        taskSubtype: 'scene',
        description: 'Scenario for scene image prompts',
        defaultExpanded: true,
        children: makeViewChildren('imagePrompt-scene', 'imagePrompt', 'scene'),
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

/** Collect all selectable leaf nodes (promptView). */
export function getAllPromptNodes(tree: PromptNode[] = PROMPT_TREE): PromptNode[] {
  const prompts: PromptNode[] = [];
  for (const node of tree) {
    if (node.type === 'promptView') {
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
