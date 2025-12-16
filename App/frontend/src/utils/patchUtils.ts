/**
 * Patch Utilities for Search-Replace based editing
 *
 * This module provides utilities for applying search-replace patches to text.
 * Used by patch_* function calls to perform partial text modifications.
 */

import type { Replacement, PatchResult } from '../types/patchTypes';

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
  // Find the first occurrence
  const index = text.indexOf(old);

  if (index === -1) {
    return {
      success: false,
      value: text,
      error: `Text not found: "${old.slice(0, 50)}${old.length > 50 ? '...' : ''}"`,
      needsRetry: true,
    };
  }

  // Check for multiple occurrences
  const secondIndex = text.indexOf(old, index + 1);
  if (secondIndex !== -1) {
    return {
      success: false,
      value: text,
      error: `Text appears multiple times: "${old.slice(0, 50)}${old.length > 50 ? '...' : ''}" - include more surrounding context in 'old' to make it unique`,
      needsRetry: true,
    };
  }

  // Apply the replacement
  const result = text.slice(0, index) + newText + text.slice(index + old.length);

  return {
    success: true,
    value: result,
  };
}

/**
 * Apply multiple search-replace operations sequentially.
 * Each replacement is applied to the result of the previous one.
 *
 * @param text - The original text
 * @param replacements - Array of {old, new} pairs
 * @returns PatchResult with the final modified text or first error
 */
export function applyPatch(
  text: string,
  replacements: Array<{ old: string; new: string }>
): PatchResult {
  if (!replacements || replacements.length === 0) {
    return { success: true, value: text };
  }

  let current = text;

  for (let i = 0; i < replacements.length; i++) {
    const r = replacements[i];
    const result = applySingleReplacement(current, r.old, r.new);

    if (!result.success) {
      return {
        success: false,
        value: text, // Return original on failure
        error: `Replacement ${i + 1}/${replacements.length} failed: ${result.error}`,
        needsRetry: true,
      };
    }

    current = result.value;
  }

  return {
    success: true,
    value: current,
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
