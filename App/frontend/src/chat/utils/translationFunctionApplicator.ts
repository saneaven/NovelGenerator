/**
 * Translation Function Applicator
 * Handles applying translation function call results to the stores
 */

import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useNovelStore } from '../../store/novelStore';
import type { FunctionCallMetadata } from '../../llm_request/types';
import type { ObjectType } from '../../types/unifiedObject';

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
  category?: ObjectType;
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
        message: `Failed to apply ${functionCall.function_name || (functionCall as any).name || 'unknown'}`,
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
      message: `Invalid ${(functionCall.function_name || (functionCall as any).name || 'unknown')} arguments`,
      error: 'Failed to parse function arguments'
    };
  }

  // Route to appropriate handler
  const functionName = functionCall.function_name || (functionCall as any).name || 'unknown';
  switch (functionName) {
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
        message: `Unknown translation function: ${functionName}`,
        error: `Function ${functionName} is not supported`
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
  const store = useUnifiedObjectStore.getState();

  // Get basic info for this project
  const basicInfoList = await store.listObjects('basic_info', context.projectId);

  if (basicInfoList.length === 0) {
    return {
      success: false,
      message: 'Basic info not found',
      error: 'No basic info exists for this project'
    };
  }

  const basicInfo = basicInfoList[0];

  // Update basic info in target language
  await store.updateObject('basic_info', basicInfo.id, {
    data: {
      title: args.title,
      logline: args.logline,
      genre: args.genre
    },
    language: context.targetLanguage,
    create_new_version: false,
    user_request: 'Translation',
  });

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
  const store = useUnifiedObjectStore.getState();

  if (!context.category || !context.itemId) {
    return {
      success: false,
      message: 'Translation context missing category or itemId',
      error: 'Required context fields are missing'
    };
  }

  // Map old category names to ObjectType
  let objectType: ObjectType;
  switch (context.category) {
    case 'character':
      objectType = 'character';
      break;
    case 'organization':
      objectType = 'organization';
      break;
    case 'location':
      objectType = 'location';
      break;
    case 'lorebook':
      objectType = 'lorebook';
      break;
    default:
      return {
        success: false,
        message: `Unsupported category for translation: ${context.category}`,
        error: 'Invalid category'
      };
  }

  // Check if item exists
  const item = store.objects[context.itemId];
  if (!item) {
    return {
      success: false,
      message: `${context.category} not found`,
      error: `Item with id ${context.itemId} not found`
    };
  }

  // Update the item in the target language
  await store.updateObject(objectType, context.itemId, {
    data: {
      name: args.name,
      description: args.description
    },
    language: context.targetLanguage,
    create_new_version: false,
    user_request: 'Translation',
  });

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
  const store = useUnifiedObjectStore.getState();

  if (!context.chapterId) {
    return {
      success: false,
      message: 'Translation context missing chapterId',
      error: 'Required context fields are missing'
    };
  }

  // Check if chapter exists
  const chapter = store.objects[context.chapterId];
  if (!chapter) {
    return {
      success: false,
      message: 'Chapter not found',
      error: `Chapter with id ${context.chapterId} not found`
    };
  }

  // Update chapter metadata in target language
  await store.updateObject('chapter', context.chapterId, {
    data: {
      name: args.name,
      description: args.description
    },
    language: context.targetLanguage,
    create_new_version: false,
    user_request: 'Translation',
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
