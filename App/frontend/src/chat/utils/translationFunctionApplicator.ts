/**
 * Translation Function Applicator
 * Handles applying translation function call results to the stores
 */

import { useStoryObjectStore } from '../../store/storyObjectStore';
import { useNovelStore } from '../../store/novelStore';
import type { FunctionCallMetadata } from '../../llm_request/types';

export interface FunctionApplicationResult {
  success: boolean;
  message: string;
  error?: string;
  data?: any;
}

/**
 * Context for translation application
 */
export interface TranslationContext {
  projectId: string;
  targetLanguage: string;
  category?: string;
  itemId?: string;
  chapterId?: string;
  versionId?: string;
}

/**
 * Apply translation function calls to the store
 */
export async function applyTranslationFunctionCalls(
  functionCalls: FunctionCallMetadata[],
  context: TranslationContext
): Promise<FunctionApplicationResult[]> {
  const results: FunctionApplicationResult[] = [];

  for (const functionCall of functionCalls) {
    try {
      const result = await applyTranslationFunctionCall(functionCall, context);
      results.push(result);
    } catch (error) {
      console.error('Translation function application error:', error);
      results.push({
        success: false,
        message: `Failed to apply ${functionCall.name}`,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return results;
}

/**
 * Apply a single translation function call
 */
async function applyTranslationFunctionCall(
  functionCall: FunctionCallMetadata,
  context: TranslationContext
): Promise<FunctionApplicationResult> {
  let args: any;

  // Parse arguments
  try {
    args = typeof functionCall.arguments === 'string'
      ? JSON.parse(functionCall.arguments)
      : functionCall.arguments;
  } catch (error) {
    return {
      success: false,
      message: `Invalid ${functionCall.name} arguments`,
      error: 'Failed to parse function arguments'
    };
  }

  // Route to appropriate handler
  switch (functionCall.name) {
    case 'translate_basic_info':
      return await handleTranslateBasicInfo(context, args);

    case 'translate_story_item':
      return await handleTranslateStoryItem(context, args);

    case 'translate_chapter_metadata':
      return await handleTranslateChapterMetadata(context, args);

    case 'translate_chapter_content':
      return await handleTranslateChapterContent(context, args);

    case 'translate_chat_message':
      return await handleTranslateChatMessage(context, args);

    case 'translate_text':
      return await handleTranslateText(context, args);

    default:
      return {
        success: false,
        message: `Unknown translation function: ${functionCall.name}`,
        error: `Function ${functionCall.name} is not supported`
      };
  }
}

// ============================================
// TRANSLATION HANDLERS
// ============================================

async function handleTranslateBasicInfo(
  context: TranslationContext,
  args: { title: string; logline: string; genre: string }
): Promise<FunctionApplicationResult> {
  const store = useStoryObjectStore.getState();

  // Update basic info in target language
  await store.updateBasicInfo(
    context.projectId,
    {
      title: args.title,
      logline: args.logline,
      genre: args.genre
    },
    context.targetLanguage
  );

  return {
    success: true,
    message: `Basic info translated to ${context.targetLanguage}`,
    data: args
  };
}

async function handleTranslateStoryItem(
  context: TranslationContext,
  args: { name: string; description: string }
): Promise<FunctionApplicationResult> {
  const store = useStoryObjectStore.getState();

  if (!context.category || !context.itemId) {
    return {
      success: false,
      message: 'Translation context missing category or itemId',
      error: 'Required context fields are missing'
    };
  }

  // Update the item in the target language
  // Note: Current implementation updates directly, not via language versions
  const updateData = {
    name: args.name,
    description: args.description
  };

  switch (context.category) {
    case 'character':
      await store.updateCharacter(context.projectId, context.itemId, updateData);
      break;
    case 'organization':
      await store.updateOrganization(context.projectId, context.itemId, updateData);
      break;
    case 'location':
      await store.updateLocation(context.projectId, context.itemId, updateData);
      break;
    case 'lorebook':
      await store.updateLorebookEntry(context.projectId, context.itemId, updateData);
      break;
    default:
      return {
        success: false,
        message: `Unsupported category for translation: ${context.category}`,
        error: 'Invalid category'
      };
  }

  return {
    success: true,
    message: `${context.category} translated to ${context.targetLanguage}`,
    data: args
  };
}

async function handleTranslateChapterMetadata(
  context: TranslationContext,
  args: { name: string; description: string }
): Promise<FunctionApplicationResult> {
  const store = useStoryObjectStore.getState();

  if (!context.chapterId) {
    return {
      success: false,
      message: 'Translation context missing chapterId',
      error: 'Required context fields are missing'
    };
  }

  // Update chapter metadata in target language
  await store.updateChapter(context.projectId, context.chapterId, {
    name: args.name,
    description: args.description
  });

  return {
    success: true,
    message: `Chapter metadata translated to ${context.targetLanguage}`,
    data: args
  };
}

async function handleTranslateChapterContent(
  context: TranslationContext,
  args: { content: string; wordCount: number }
): Promise<FunctionApplicationResult> {
  const novelStore = useNovelStore.getState();

  if (!context.chapterId) {
    return {
      success: false,
      message: 'Translation context missing chapterId',
      error: 'Required context fields are missing'
    };
  }

  // Update chapter content in target language
  // If versionId is provided, add as translated version
  // Otherwise, update the active version
  if (context.versionId) {
    novelStore.addTranslatedContent(
      context.projectId,
      context.chapterId,
      context.versionId,
      args.content,
      context.targetLanguage
    );
  } else {
    await novelStore.updateChapterContentForLanguage(
      context.projectId,
      context.chapterId,
      args.content,
      context.targetLanguage
    );
  }

  return {
    success: true,
    message: `Chapter content translated to ${context.targetLanguage} (${args.wordCount} words)`,
    data: args
  };
}

async function handleTranslateChatMessage(
  context: TranslationContext,
  args: { content: string }
): Promise<FunctionApplicationResult> {
  // Chat message translation is typically handled differently
  // This returns the translated content for the caller to use
  return {
    success: true,
    message: `Chat message translated to ${context.targetLanguage}`,
    data: { translatedContent: args.content }
  };
}

async function handleTranslateText(
  context: TranslationContext,
  args: { text: string }
): Promise<FunctionApplicationResult> {
  // General text translation - returns the translated text
  return {
    success: true,
    message: `Text translated to ${context.targetLanguage}`,
    data: { translatedText: args.text }
  };
}
