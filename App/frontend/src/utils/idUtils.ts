const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function createClientMessageId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `cm-${Date.now()}-${random}`;
}
