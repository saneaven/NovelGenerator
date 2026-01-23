/**
 * Patch Utilities for Search-Replace based editing
 *
 * This module provides utilities for applying search-replace patches to text.
 * Used by patch_* tool calls to perform partial text modifications.
 * Each patch operation handles a single replacement (old → new).
 */

import type { PatchResult } from '../types/patchTypes';

/**
 * Normalize text for consistent matching.
 * Handles character differences that LLMs introduce when regenerating text:
 * - Line endings: CRLF/CR → LF
 * - Whitespace: various Unicode spaces → regular space
 * - Zero-width characters: removed
 * - Quotes: curly quotes → straight quotes
 * - Dashes: en-dash/em-dash → hyphen
 * - Unicode: NFC normalization
 */
function normalizeText(text: string): string {
  return text
    // Line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Whitespace normalization: various Unicode spaces → regular space
    // U+00A0 (NBSP), U+2000-U+200A (various spaces), U+202F (narrow NBSP),
    // U+205F (medium math space), U+3000 (ideographic space)
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    // Remove zero-width characters
    // U+200B (zero-width space), U+200C (ZWNJ), U+200D (ZWJ), U+FEFF (BOM)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Curly quotes → straight quotes
    // U+2018-U+201B (single quotes), U+201C-U+201F (double quotes)
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    // En-dash (U+2013), em-dash (U+2014) → hyphen-minus
    .replace(/[\u2013\u2014]/g, '-')
    // Unicode NFC normalization
    .normalize('NFC');
}

/**
 * Apply a single search-replace operation to text.
 *
 * @param text - The text to modify
 * @param old - The text to find (must be unique in the text)
 * @param newText - The replacement text
 * @returns PatchResult with success/failure and the modified text
 */
export function applySingleReplacement(
  text: string,
  old: string,
  newText: string
): PatchResult {
  // Normalize all inputs for consistent matching
  const normalizedText = normalizeText(text);
  const normalizedOld = normalizeText(old);
  const normalizedNew = normalizeText(newText);

  // Find the first occurrence
  const index = normalizedText.indexOf(normalizedOld);

  if (index === -1) {
    return {
      success: false,
      value: text,
      error: `Text not found: "${old.slice(0, 50)}${old.length > 50 ? '...' : ''}"`,
    };
  }

  // Check for multiple occurrences
  const secondIndex = normalizedText.indexOf(normalizedOld, index + 1);
  if (secondIndex !== -1) {
    return {
      success: false,
      value: text,
      error: `Text appears multiple times: "${old.slice(0, 50)}${old.length > 50 ? '...' : ''}" - include more surrounding context in 'old' to make it unique`,
    };
  }

  // Apply the replacement to normalized text
  const result = normalizedText.slice(0, index) + normalizedNew + normalizedText.slice(index + normalizedOld.length);

  return {
    success: true,
    value: result,
  };
}
