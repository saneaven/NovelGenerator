export interface CardDisplayData {
  name: string;
  description?: string;
  contentMarkdown?: string;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function mapObjectCardData(values: Record<string, unknown>): CardDisplayData {
  return {
    name: str(values.name) ?? '',
    description: str(values.description),
    contentMarkdown: str(values.content),
  };
}

function mapGuidelinesData(values: Record<string, unknown>): CardDisplayData {
  return {
    name: 'Guidelines',
    contentMarkdown: str(values.authorNote),
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
