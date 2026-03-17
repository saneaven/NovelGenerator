export interface CardDisplayData {
  name: string;
  description?: string;
  content?: string;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function mapObjectCardData(values: Record<string, unknown>): CardDisplayData {
  return {
    name: str(values.name) ?? '',
    description: str(values.description),
    content: str(values.content),
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
    case 'guidelines':
      return mapGuidelinesData(values);
    default:
      return mapObjectCardData(values);
  }
}
