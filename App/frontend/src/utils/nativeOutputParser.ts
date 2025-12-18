/**
 * Native Output Parser for Native Output Mode
 *
 * Parses JSON-formatted output from LLM responses when using native output mode.
 * Uses partial-json library to support streaming JSON parsing.
 *
 * Supports two formats for text fields:
 * - Direct strings (for full replacement)
 * - Replacement arrays: { replacements: [{old, new}] } (for search-replace patches)
 */

import { Allow, parse } from 'partial-json';

/**
 * Replacement operation for patch-style edits
 */
export interface ReplacementOperation {
  old: string;
  new: string;
}

/**
 * Text field that can be either a direct string or a patch operation
 */
export type TextFieldValue = string | { replacements: ReplacementOperation[] };

/**
 * Parsed item from LLM native output.
 * Text fields can be either direct strings or replacement arrays.
 */
export interface ParsedItem {
  id?: string | null;
  name?: TextFieldValue;
  description?: TextFieldValue;
  content?: TextFieldValue;
  // For acts with nested chapters
  chapters?: ParsedChapterItem[];
  order?: number;
  actId?: string | null;
  // For manuscript patches
  chapterId?: string;
  replacements?: ReplacementOperation[];
  // For editAssistant storyObject native output (function call format)
  function?: string;
  type?: string;
  // For basic info edits
  title?: TextFieldValue;
  logline?: TextFieldValue;
  genre?: TextFieldValue;
}

export interface ParsedChapterItem {
  id?: string | null;
  name?: TextFieldValue;
  description?: TextFieldValue;
  order?: number;
  actId?: string | null;
}

/**
 * Check if a value is a replacement operation (patch format)
 */
export function isReplacementOperation(
  value: unknown
): value is { replacements: ReplacementOperation[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'replacements' in value &&
    Array.isArray((value as any).replacements)
  );
}

/**
 * Parse potentially incomplete JSON during streaming.
 * Uses partial-json library to handle incomplete JSON gracefully.
 */
export function parsePartialJson<T>(content: string): T | null {
  try {
    const cleaned = extractRawContent(content);
    if (!cleaned.trim()) return null;
    return parse(cleaned, Allow.ALL) as T;
  } catch {
    return null;
  }
}

/**
 * Parse streaming JSON array output, returning parsed items so far.
 * Always returns an array - handles both array and single object inputs.
 */
export function parseStreamingItems(content: string): ParsedItem[] {
  const parsed = parsePartialJson<ParsedItem[] | ParsedItem>(content);
  if (!parsed) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * Parse complete JSON output.
 * Expects a JSON array of items.
 */
export function parseJsonOutput(content: string): ParsedItem[] {
  try {
    const cleaned = extractRawContent(content);
    const parsed = JSON.parse(cleaned);
    if (!parsed) return [];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/**
 * Parse a single item from JSON.
 * Returns the first item if array, or the object itself.
 */
export function parseSingleJsonOutput(content: string): ParsedItem {
  const items = parseJsonOutput(content);
  return items[0] || {};
}

/**
 * Extract raw content, stripping any thinking blocks and extracting JSON from code fences.
 * Also handles common AI response patterns.
 */
export function extractRawContent(content: string): string {
  let result = content;

  // Remove thinking blocks (Claude-style)
  result = result.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

  // Extract JSON from markdown code blocks if present
  const jsonBlockMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    result = jsonBlockMatch[1].trim();
  } else {
    // Fallback: try to extract raw JSON object/array
    const jsonMatch = result.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      result = jsonMatch[1].trim();
    }
  }

  return result.trim();
}
