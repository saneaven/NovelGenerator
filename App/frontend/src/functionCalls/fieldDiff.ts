export interface ComputeChangedFieldsInput {
  args: Record<string, unknown>;
  currentData?: Record<string, unknown>;
  currentMetadata?: Record<string, unknown>;
  keys: string[];
  metadataKeys?: Record<string, string>;
}

function normalizeScalar(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function valuesEffectivelyEqual(a: unknown, b: unknown): boolean {
  return normalizeScalar(a) === normalizeScalar(b);
}

export function computeChangedFields(input: ComputeChangedFieldsInput): string[] {
  const { args, currentData = {}, currentMetadata = {}, keys, metadataKeys = {} } = input;

  const changed: string[] = [];
  for (const key of keys) {
    if (!(key in args)) continue;

    const nextValue = args[key];
    const metadataKey = metadataKeys[key];
    const currentValue = metadataKey ? currentMetadata[metadataKey] : currentData[key];

    if (!valuesEffectivelyEqual(nextValue, currentValue)) {
      changed.push(key);
    }
  }

  return changed;
}

export function pickChangedValues(
  args: Record<string, unknown>,
  changedFields: string[]
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const key of changedFields) {
    if (key in args) {
      next[key] = args[key];
    }
  }
  return next;
}

export function pickProvidedValues(
  args: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in args) {
      next[key] = args[key];
    }
  }
  return next;
}
