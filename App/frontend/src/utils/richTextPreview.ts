import { docToPlainText, normalizeDoc } from '../editor/manuscript/doc';

export function richContentToPlainText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value && typeof value === 'object') {
    return docToPlainText(normalizeDoc(value));
  }
  return '';
}

export function richContentToPreview(value: unknown, maxLength = 280): string {
  const text = richContentToPlainText(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength).trimEnd()}...`;
}
