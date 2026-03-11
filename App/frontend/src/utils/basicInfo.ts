import type { BasicInfoData } from '../types/unifiedObject';

export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  value.forEach((item) => {
    const text = String(item ?? '').trim();
    if (!text || seen.has(text)) {
      return;
    }
    seen.add(text);
    normalized.push(text);
  });
  return normalized;
}

export function normalizeBasicInfoData(value: unknown): BasicInfoData {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    title: String(data.title ?? '').trim(),
    logline: String(data.logline ?? ''),
    genres: normalizeStringList(data.genres),
    tags: normalizeStringList(data.tags),
  };
}

export function formatBasicInfoList(value: unknown): string {
  return normalizeStringList(value).join(', ');
}

export function buildBasicInfoSummary(value: unknown): string {
  const data = normalizeBasicInfoData(value);
  return [
    `Title: ${data.title}`,
    `Logline: ${data.logline}`,
    `Genres: ${formatBasicInfoList(data.genres)}`,
    `Tags: ${formatBasicInfoList(data.tags)}`,
  ].join('\n').trim();
}
