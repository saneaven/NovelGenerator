/**
 * Native Output Parser for Native Output Mode
 *
 * Parses JSON-formatted output from LLM responses when using native output mode.
 * Uses partial-json library to support streaming JSON parsing.
 */

import { Allow, parse } from 'partial-json';

export interface ParsedItem {
  id?: string;
  name?: string;
  description?: string;
  content?: string;
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
 * Extract raw content, stripping any thinking blocks and code fences.
 * Also handles common AI response patterns.
 */
export function extractRawContent(content: string): string {
  let result = content;

  // Remove thinking blocks (Claude-style)
  result = result.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

  // Remove markdown code blocks with language specifier
  result = result.replace(/^```(?:json)?\n?/gm, '');
  result = result.replace(/\n?```$/gm, '');

  return result.trim();
}
