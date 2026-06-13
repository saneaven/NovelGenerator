export interface NumberInputParseOpts {
  min?: number;
  max?: number;
  integer: boolean;
  allowEmpty: boolean;
  /** Value committed for empty/NaN input when normalizing on blur. */
  fallback: number;
}

export interface NumberInputParseResult {
  /** Whether onValueChange should be called. */
  commit: boolean;
  /** Value to commit when `commit` is true. */
  value: number | undefined;
  /** Normalized text to write back into the field (blur only). */
  display?: string;
}

/**
 * Pure parse/clamp decision shared by NumberInput's change and blur handlers.
 * `final=false` is the live (keystroke) path: it commits a parsed value but
 * tolerates in-progress input (NaN / empty) by not committing, so the user can
 * keep typing. `final=true` is the blur path: it additionally normalizes empty
 * and NaN input to `fallback` and reports the text to sync back into the field.
 */
export function resolveNumberInput(
  raw: string,
  opts: NumberInputParseOpts,
  final: boolean,
): NumberInputParseResult {
  const trimmed = raw.trim();

  if (trimmed === '') {
    if (opts.allowEmpty) {
      return { commit: true, value: undefined, display: final ? '' : undefined };
    }
    return final
      ? { commit: true, value: opts.fallback, display: String(opts.fallback) }
      : { commit: false, value: undefined };
  }

  let parsed = opts.integer ? parseInt(trimmed, 10) : parseFloat(trimmed);

  if (Number.isNaN(parsed)) {
    return final
      ? { commit: true, value: opts.fallback, display: String(opts.fallback) }
      : { commit: false, value: undefined };
  }

  if (opts.min !== undefined) parsed = Math.max(opts.min, parsed);
  if (opts.max !== undefined) parsed = Math.min(opts.max, parsed);
  if (opts.integer) parsed = Math.trunc(parsed);

  return { commit: true, value: parsed, display: final ? String(parsed) : undefined };
}
