export type TranslationChunkSizePreset = '1' | '5' | '10' | '20' | 'custom';

export const TRANSLATION_CHUNK_SIZE_OPTIONS = [
  { value: '1', label: '1' },
  { value: '5', label: '5' },
  { value: '10', label: '10' },
  { value: '20', label: '20' },
  { value: 'custom', label: 'Custom' },
] as const;

export function resolveTranslationChunkSize(
  preset: TranslationChunkSizePreset,
  customSize: number | undefined,
  itemCount: number,
): number {
  const requested = preset === 'custom' ? customSize : Number(preset);
  const normalized = Number.isFinite(requested)
    ? Math.max(1, Math.floor(requested as number))
    : 1;

  return itemCount > 0 ? Math.min(normalized, itemCount) : 1;
}

export function chunkTranslationItems<T>(items: readonly T[], chunkSize: number): T[][] {
  if (items.length === 0) return [];

  const size = Math.max(1, Math.floor(chunkSize));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function startTranslationGroupsConcurrently<T>(
  groups: readonly T[][],
  startGroup: (group: T[], index: number) => Promise<void>,
): Promise<PromiseSettledResult<void>[]> {
  return Promise.allSettled(
    groups.map((group, index) => startGroup(group, index)),
  );
}
