export function getByDotPath(data: Record<string, unknown>, path: string): unknown {
  const keys = path
    .split('.')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  if (keys.length === 0) return undefined;

  let current: unknown = data;
  for (const key of keys) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function setByDotPath(
  data: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const keys = path
    .split('.')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  if (keys.length === 0) return { ...data };

  const root: Record<string, unknown> = { ...data };
  let current: Record<string, unknown> = root;

  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    const existing = current[key];
    const next =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    current[key] = next;
    current = next;
  }

  current[keys[keys.length - 1]] = value;
  return root;
}
