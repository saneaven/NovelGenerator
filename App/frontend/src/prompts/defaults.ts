/**
 * Bundled default prompts
 * These serve as fallbacks when DB prompts are not available
 * and as initial defaults for new users
 */

// System Prompts
import workspaceSystemPrompt from '../chat/managers/prompts/systemPrompts/WorkspaceSystemPrompt.md?raw';
import novelEditorSystemPrompt from '../chat/managers/prompts/systemPrompts/NovelEditorSystemPrompt.md?raw';
import translationPrompt from '../chat/managers/prompts/systemPrompts/TranslationPrompt.md?raw';
import batchTranslationPrompt from '../chat/managers/prompts/systemPrompts/BatchTranslationPrompt.md?raw';
import storyObjectEditPrompt from '../chat/managers/prompts/systemPrompts/StoryObjectEditPrompt.md?raw';
import chapterEditPrompt from '../chat/managers/prompts/systemPrompts/ChapterEditPrompt.md?raw';

// User Prompts
import translationUserPrompt from '../chat/managers/prompts/userPrompts/TranslationUserPrompt.md?raw';
import batchTranslationUserPrompt from '../chat/managers/prompts/userPrompts/BatchTranslationUserPrompt.md?raw';
import storyObjectEditUserPrompt from '../chat/managers/prompts/userPrompts/StoryObjectEditUserPrompt.md?raw';
import chapterEditUserPrompt from '../chat/managers/prompts/userPrompts/ChapterEditUserPrompt.md?raw';

// Function Instructions
import workspaceFunctionInstructions from '../chat/managers/prompts/systemPrompts/functionInstructions/workspace.md?raw';
import novelEditorFunctionInstructions from '../chat/managers/prompts/systemPrompts/functionInstructions/novelEditor.md?raw';

// Prefills
import chatPrefill from '../chat/managers/prompts/prefills/ChatPrefill.md?raw';
import translationPrefill from '../chat/managers/prompts/prefills/TranslationPrefill.md?raw';
import batchTranslationPrefill from '../chat/managers/prompts/prefills/BatchTranslationPrefill.md?raw';
import storyObjectEditPrefill from '../chat/managers/prompts/prefills/StoryObjectEditPrefill.md?raw';
import chapterEditPrefill from '../chat/managers/prompts/prefills/ChapterEditPrefill.md?raw';

// User Message Tags
import lastUserMessageTag from '../chat/managers/prompts/userMessageSystemPrompts/LastUserMessageTag.md?raw';
import nonLastUserMessageTag from '../chat/managers/prompts/userMessageSystemPrompts/NonLastUserMessageTag.md?raw';

/**
 * Prompt type definitions
 */
export type FunctionType = 'chat' | 'translation' | 'batchTranslation' | 'storyEdit' | 'chapterGen';
export type PromptCategory = 'systemPrompt' | 'functionInstructions' | 'prefill' | 'userMessageTag' | 'userPrompt';

export interface PromptDefaults {
  chat: {
    systemPrompt: {
      workspace: string;
      novelEditor: string;
    };
    functionInstructions: {
      workspace: string;
      novelEditor: string;
    };
    prefill: string;
    userMessageTag: {
      lastMessage: string;
      nonLastMessage: string;
    };
  };
  translation: {
    systemPrompt: string;
    userPrompt: string;
    prefill: string;
  };
  batchTranslation: {
    systemPrompt: string;
    userPrompt: string;
    prefill: string;
  };
  storyEdit: {
    systemPrompt: string;
    userPrompt: string;
    prefill: string;
  };
  chapterGen: {
    systemPrompt: string;
    userPrompt: string;
    prefill: string;
  };
}

/**
 * Default prompt contents bundled from .md files
 */
export const DEFAULT_PROMPTS: PromptDefaults = {
  chat: {
    systemPrompt: {
      workspace: workspaceSystemPrompt,
      novelEditor: novelEditorSystemPrompt,
    },
    functionInstructions: {
      workspace: workspaceFunctionInstructions,
      novelEditor: novelEditorFunctionInstructions,
    },
    prefill: chatPrefill,
    userMessageTag: {
      lastMessage: lastUserMessageTag,
      nonLastMessage: nonLastUserMessageTag,
    },
  },
  translation: {
    systemPrompt: translationPrompt,
    userPrompt: translationUserPrompt,
    prefill: translationPrefill,
  },
  batchTranslation: {
    systemPrompt: batchTranslationPrompt,
    userPrompt: batchTranslationUserPrompt,
    prefill: batchTranslationPrefill,
  },
  storyEdit: {
    systemPrompt: storyObjectEditPrompt,
    userPrompt: storyObjectEditUserPrompt,
    prefill: storyObjectEditPrefill,
  },
  chapterGen: {
    systemPrompt: chapterEditPrompt,
    userPrompt: chapterEditUserPrompt,
    prefill: chapterEditPrefill,
  },
};

/**
 * Helper to get a specific default prompt
 */
export function getDefaultPrompt(
  functionType: FunctionType,
  category: PromptCategory,
  name?: string
): string | null {
  const funcPrompts = DEFAULT_PROMPTS[functionType];
  if (!funcPrompts) return null;

  const categoryPrompts = funcPrompts[category];
  if (!categoryPrompts) return null;

  // If name is provided and categoryPrompts is an object
  if (name && typeof categoryPrompts === 'object' && !Array.isArray(categoryPrompts)) {
    return (categoryPrompts as any)[name] || null;
  }

  // If no name and categoryPrompts is a string
  if (!name && typeof categoryPrompts === 'string') {
    return categoryPrompts;
  }

  return null;
}

/**
 * Get prompt key for cache lookup
 */
export function getPromptKey(
  functionType: FunctionType,
  category: PromptCategory,
  name?: string
): string {
  return name ? `${functionType}:${category}:${name}` : `${functionType}:${category}`;
}
