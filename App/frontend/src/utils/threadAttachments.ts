import type { TFunction } from 'i18next';
import type { MessageAttachment, ThreadMessage } from '../types/thread';

export const CHAT_ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf';
export const CHAT_ATTACHMENT_MAX_FILES = 5;
export const CHAT_ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
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

export function isSupportedAttachmentMimeType(mimeType: string): boolean {
  return ALLOWED_ATTACHMENT_MIME_TYPES.has((mimeType || '').toLowerCase());
}

export function createPendingAttachment(file: File): PendingAttachment {
  const mimeType = (file.type || '').toLowerCase();
  const kind: MessageAttachment['kind'] = mimeType === 'application/pdf' ? 'document' : 'image';
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

export function countAttachments(attachments: MessageAttachment[] | PendingAttachment[]): { imageCount: number; pdfCount: number } {
  let imageCount = 0;
  let pdfCount = 0;
  for (const attachment of attachments) {
    if (attachment.kind === 'image') {
      imageCount += 1;
    } else if (attachment.kind === 'document') {
      pdfCount += 1;
    }
  }
  return { imageCount, pdfCount };
}

export function buildAttachmentSummary(
  attachments: MessageAttachment[],
  t: TFunction,
): string {
  const { imageCount, pdfCount } = countAttachments(attachments);
  const parts: string[] = [];
  if (imageCount > 0) {
    parts.push(t('agent.imageCount', { count: imageCount }));
  }
  if (pdfCount > 0) {
    parts.push(t('agent.pdfCount', { count: pdfCount }));
  }
  return parts.join(' + ');
}
