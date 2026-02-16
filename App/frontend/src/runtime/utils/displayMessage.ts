export interface LangEntry {
  contentParts: Array<{ type: string; text: string }>;
  thinkingDetails?: Array<Record<string, unknown>>;
}

/** Any message with multilingual `data` (RunMessage, ThreadMessage, ConversationMessage). */
interface MessageWithData {
  data: Record<string, LangEntry>;
}

export interface DisplayMessageResult {
  contentParts: Array<{ type: string; text: string }>;
  thinkingDetails?: Array<Record<string, unknown>>;
  displayLanguage: string;
  isFallback: boolean;
}

/**
 * Resolve the best language entry from a message's multilingual `data`.
 *
 * Priority:
 *   1. Exact match for `language`
 *   2. Exact match for `fallbackLanguage`
 *   3. First available language entry
 *   4. Empty result
 */
export function resolveRunMessageDisplay(
  message: MessageWithData,
  language: string,
  fallbackLanguage?: string,
): DisplayMessageResult {
  const data = message.data;

  // Exact match
  const exact = data[language];
  if (exact) {
    return {
      contentParts: exact.contentParts ?? [],
      thinkingDetails: exact.thinkingDetails,
      displayLanguage: language,
      isFallback: false,
    };
  }

  // Fallback language
  if (fallbackLanguage) {
    const fallback = data[fallbackLanguage];
    if (fallback) {
      return {
        contentParts: fallback.contentParts ?? [],
        thinkingDetails: fallback.thinkingDetails,
        displayLanguage: fallbackLanguage,
        isFallback: true,
      };
    }
  }

  // First available
  const languages = Object.keys(data);
  if (languages.length > 0) {
    const first = data[languages[0]];
    return {
      contentParts: first.contentParts ?? [],
      thinkingDetails: first.thinkingDetails,
      displayLanguage: languages[0],
      isFallback: true,
    };
  }

  // Empty
  return {
    contentParts: [],
    thinkingDetails: undefined,
    displayLanguage: language,
    isFallback: false,
  };
}

/**
 * Extract plain text from contentParts (content-type only).
 */
export function getRunMessageText(
  message: MessageWithData,
  language: string,
  fallbackLanguage?: string,
): string {
  const { contentParts } = resolveRunMessageDisplay(message, language, fallbackLanguage);
  return contentParts
    .filter((part) => part.type === 'content')
    .map((part) => part.text)
    .join('');
}

/**
 * Build a LangEntry from flat contentParts + thinkingDetails.
 */
export function buildLangEntry(
  contentParts: Array<{ type: string; text: string }>,
  thinkingDetails?: Array<Record<string, unknown>>,
): LangEntry {
  return {
    contentParts,
    ...(thinkingDetails !== undefined ? { thinkingDetails } : {}),
  };
}
