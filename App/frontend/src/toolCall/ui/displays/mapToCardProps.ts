export interface CardDisplayData {
  name: string;
  description?: string;
  content?: string;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function mapStoryObjectData(values: Record<string, unknown>): CardDisplayData {
  return {
    name: str(values.name) ?? '',
    description: str(values.description),
    content: str(values.content),
  };
}

function mapBasicInfoData(values: Record<string, unknown>): CardDisplayData {
  const parts: string[] = [];
  const logline = str(values.logline);
  const genre = str(values.genre);
  if (logline) parts.push(`**Logline:** ${logline}`);
  if (genre) parts.push(`**Genre:** ${genre}`);

  return {
    name: str(values.title) ?? 'Basic Info',
    content: parts.length > 0 ? parts.join('\n\n') : undefined,
  };
}

function mapGuidelinesData(values: Record<string, unknown>): CardDisplayData {
  return {
    name: 'Guidelines',
    content: str(values.authorNote),
  };
}

export function mapObjectData(
  objectType: string,
  values: Record<string, unknown>,
): CardDisplayData {
  switch (objectType) {
    case 'basic_info':
      return mapBasicInfoData(values);
    case 'guidelines':
      return mapGuidelinesData(values);
    default:
      return mapStoryObjectData(values);
  }
}
