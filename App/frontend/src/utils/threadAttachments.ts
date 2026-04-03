import type { TFunction } from 'i18next';
import type { MessageAttachment, ThreadMessage } from '../types/thread';

export const CHAT_ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv,text/xml,text/html,text/markdown,application/json,application/xml,application/yaml,application/x-yaml,application/toml,.txt,.json,.csv,.xml,.yaml,.yml,.md,.html,.toml';
export const CHAT_ATTACHMENT_MAX_FILES = 5;
export const CHAT_ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const TEXT_FILE_MIME_TYPES = new Set([
  'text/plain',
  'text/csv',
  'text/xml',
  'text/html',
  'text/markdown',
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
]);

const TEXT_FILE_EXTENSION_TO_MIME = new Map<string, string>([
  ['.txt', 'text/plain'],
  ['.json', 'application/json'],
  ['.csv', 'text/csv'],
  ['.xml', 'application/xml'],
  ['.yaml', 'application/yaml'],
  ['.yml', 'application/yaml'],
  ['.md', 'text/markdown'],
  ['.html', 'text/html'],
  ['.toml', 'application/toml'],
]);

const TEXT_FILE_EXTENSIONS = new Set(TEXT_FILE_EXTENSION_TO_MIME.keys());

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  ...TEXT_FILE_MIME_TYPES,
]);

export interface PendingAttachment {
  clientId: string;
  file: File;
  kind: MessageAttachment['kind'];
  name: string;
  size: number;
  mimeType: string;
  previewUrl?: string;
  width?: number | null;
  height?: number | null;
}

function extensionFromFilename(filename?: string): string {
  const normalized = (filename || '').trim().toLowerCase();
  const index = normalized.lastIndexOf('.');
  return index >= 0 ? normalized.slice(index) : '';
}

function resolveAttachmentMimeType(mimeType: string, filename?: string): string {
  const normalizedMimeType = (mimeType || '').trim().toLowerCase();
  if (normalizedMimeType && normalizedMimeType !== 'application/octet-stream') {
    return normalizedMimeType;
  }

  const extension = extensionFromFilename(filename);
  if (TEXT_FILE_EXTENSIONS.has(extension)) {
    return TEXT_FILE_EXTENSION_TO_MIME.get(extension) ?? normalizedMimeType;
  }
  return normalizedMimeType;
}

export function isSupportedAttachmentMimeType(mimeType: string, filename?: string): boolean {
  return ALLOWED_ATTACHMENT_MIME_TYPES.has(resolveAttachmentMimeType(mimeType, filename));
}

export function createPendingAttachment(file: File): PendingAttachment {
  const mimeType = resolveAttachmentMimeType(file.type || '', file.name);
  const kind: MessageAttachment['kind'] = mimeType === 'application/pdf'
    ? 'document'
    : TEXT_FILE_MIME_TYPES.has(mimeType)
      ? 'text_file'
      : 'image';
  const previewUrl = kind === 'image' ? URL.createObjectURL(file) : undefined;
  return {
    clientId: `pending:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    file,
    kind,
    name: file.name,
    size: file.size,
    mimeType,
    previewUrl,
  };
}

export function toOptimisticMessageAttachment(
  attachment: PendingAttachment,
  index: number,
): MessageAttachment {
  return {
    id: attachment.clientId,
    messageId: '',
    sortOrder: index,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    originalFilename: attachment.name,
    fileSize: attachment.size,
    url: attachment.kind === 'image' ? URL.createObjectURL(attachment.file) : '',
    width: attachment.width ?? null,
    height: attachment.height ?? null,
    createdAt: null,
  };
}

export function toMessageAttachment(raw: unknown): MessageAttachment {
  const attachment = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(attachment.id ?? ''),
    messageId: String(attachment.message_id ?? ''),
    sortOrder: Number(attachment.sort_order ?? 0),
    kind: String(attachment.kind ?? 'document') as MessageAttachment['kind'],
    mimeType: String(attachment.mime_type ?? ''),
    originalFilename: String(attachment.original_filename ?? ''),
    fileSize: Number(attachment.file_size ?? 0),
    url: String(attachment.url ?? ''),
    width: attachment.width === null || attachment.width === undefined ? null : Number(attachment.width),
    height: attachment.height === null || attachment.height === undefined ? null : Number(attachment.height),
    createdAt: attachment.created_at ? String(attachment.created_at) : null,
  };
}

export function revokeAttachmentPreview(attachment: Pick<PendingAttachment, 'previewUrl'>): void {
  if (attachment.previewUrl && attachment.previewUrl.startsWith('blob:')) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

export function revokeMessageAttachmentObjectUrls(message: Pick<ThreadMessage, 'attachments'>): void {
  for (const attachment of message.attachments ?? []) {
    if (attachment.url?.startsWith('blob:')) {
      URL.revokeObjectURL(attachment.url);
    }
  }
}

export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function countAttachments(
  attachments: MessageAttachment[] | PendingAttachment[],
): { imageCount: number; pdfCount: number; textFileCount: number } {
  let imageCount = 0;
  let pdfCount = 0;
  let textFileCount = 0;
  for (const attachment of attachments) {
    if (attachment.kind === 'image') {
      imageCount += 1;
    } else if (attachment.kind === 'document') {
      pdfCount += 1;
    } else if (attachment.kind === 'text_file') {
      textFileCount += 1;
    }
  }
  return { imageCount, pdfCount, textFileCount };
}

export function buildAttachmentSummary(
  attachments: MessageAttachment[],
  t: TFunction,
): string {
  const { imageCount, pdfCount, textFileCount } = countAttachments(attachments);
  const parts: string[] = [];
  if (imageCount > 0) {
    parts.push(t('agent.imageCount', { count: imageCount }));
  }
  if (pdfCount > 0) {
    parts.push(t('agent.pdfCount', { count: pdfCount }));
  }
  if (textFileCount > 0) {
    parts.push(t('agent.textFileCount', { count: textFileCount }));
  }
  return parts.join(' + ');
}
