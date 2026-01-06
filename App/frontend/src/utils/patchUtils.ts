/**
 * Patch Utilities for Search-Replace based editing
 *
 * This module provides utilities for applying search-replace patches to text.
 * Used by patch_* function calls to perform partial text modifications.
 */

import type { Replacement, PatchResult, ReplacementResult } from '../types/patchTypes';

/**
 * Normalize text for consistent matching.
 * - Converts CRLF and CR to LF
 * - Applies Unicode NFC normalization
 */
function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
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

/**
 * Apply multiple search-replace operations sequentially.
 * Each replacement is applied to the result of the previous one.
 * Continues processing even if some replacements fail, applying successful ones.
 *
 * @param text - The original text
 * @param replacements - Array of {old, new} pairs
 * @returns PatchResult with the modified text (including successful patches) and detailed error info
 */
export function applyPatch(
  text: string,
  replacements: Array<{ old: string; new: string }>
): PatchResult {
  if (!replacements || replacements.length === 0) {
    return { success: true, value: text, successCount: 0, failureCount: 0 };
  }

  let current = text;
  const replacementResults: ReplacementResult[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < replacements.length; i++) {
    const r = replacements[i];
    const result = applySingleReplacement(current, r.old, r.new);

    if (!result.success) {
      // Record failure but continue with other replacements
      replacementResults.push({
        index: i,
        success: false,
        old: r.old,
        new: r.new,
        error: result.error,
      });
      failureCount++;
    } else {
      current = result.value;
      replacementResults.push({
        index: i,
        success: true,
        old: r.old,
        new: r.new,
      });
      successCount++;
    }
  }

  if (failureCount > 0) {
    // Build detailed error message
    const failedItems = replacementResults
      .filter(r => !r.success)
      .map(r => `[${r.index + 1}] "${r.old.slice(0, 30)}${r.old.length > 30 ? '...' : ''}" - ${r.error}`)
      .join('\n');

    return {
      success: false,
      value: current,  // Return text with successful patches applied
      error: `${failureCount}/${replacements.length} replacements failed:\n${failedItems}`,
      replacementResults,
      successCount,
      failureCount,
    };
  }

  return {
    success: true,
    value: current,
    replacementResults,
    successCount,
    failureCount: 0,
  };
}

/**
 * Apply patches to a specific field of an object.
 * Filters replacements by field name and applies them.
 *
 * @param currentValue - Current value of the field
 * @param fieldName - Name of the field being patched
 * @param replacements - Array of replacements with field, old, new
 * @returns PatchResult
 */
export function applyFieldPatch(
  currentValue: string,
  fieldName: string,
  replacements: Replacement[]
): PatchResult {
  // Filter replacements for this field
  const fieldReplacements = replacements
    .filter((r) => r.field === fieldName)
    .map((r) => ({ old: r.old, new: r.new }));

  if (fieldReplacements.length === 0) {
    return { success: true, value: currentValue };
  }

  return applyPatch(currentValue, fieldReplacements);
}

/**
 * Apply patches to multiple fields of an object.
 *
 * @param currentValues - Object with current field values
 * @param replacements - Array of replacements with field, old, new
 * @returns Object with patched values and any errors
 */
export function applyMultiFieldPatch<T extends Record<string, string>>(
  currentValues: T,
  replacements: Replacement[]
): {
  success: boolean;
  values: T;
  errors: Array<{ field: string; error: string }>;
} {
  const errors: Array<{ field: string; error: string }> = [];
  const values = { ...currentValues };

  // Group replacements by field
  const byField = new Map<string, Array<{ old: string; new: string }>>();
  for (const r of replacements) {
    if (r.field) {
      const existing = byField.get(r.field) || [];
      existing.push({ old: r.old, new: r.new });
      byField.set(r.field, existing);
    }
  }

  // Apply to each field
  for (const [field, fieldReplacements] of byField) {
    if (field in currentValues) {
      const result = applyPatch(currentValues[field], fieldReplacements);
      if (result.success) {
        (values as Record<string, string>)[field] = result.value;
      } else {
        errors.push({ field, error: result.error || 'Unknown error' });
      }
    }
  }

  return {
    success: errors.length === 0,
    values,
    errors,
  };
}
