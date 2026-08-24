import { generateHTML, generateText, type JSONContent } from '@tiptap/core';

import type { TipTapDoc } from '../../types/tiptap';
import { buildRichTextExtensions } from './extensions';

export type ManuscriptClipboardMode = 'with-images' | 'without-images';
export type ManuscriptClipboardFormat = 'rich' | 'plain';

export interface ManuscriptClipboardResult {
  mode: ManuscriptClipboardMode;
  includedImages: number;
  omittedImages: number;
  clipboardFormat: ManuscriptClipboardFormat;
}

export interface PreparedManuscriptClipboard {
  html: string;
  text: string;
  includedImages: number;
  omittedImages: number;
}

export interface ManuscriptClipboardItem {
  readonly types?: ReadonlyArray<string>;
}

export interface ManuscriptClipboardWriter {
  write?: (items: ManuscriptClipboardItem[]) => Promise<void>;
  writeText: (text: string) => Promise<void>;
}

export type ManuscriptClipboardItemConstructor = new (
  items: Record<string, string | Blob | PromiseLike<string | Blob>>,
) => ManuscriptClipboardItem;

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type DocumentSerializer = (doc: TipTapDoc) => string;

interface ManuscriptClipboardDependencies {
  fetchImpl?: FetchImplementation;
  clipboard?: ManuscriptClipboardWriter;
  ClipboardItemCtor?: ManuscriptClipboardItemConstructor;
  serializeHTML?: DocumentSerializer;
  serializeText?: DocumentSerializer;
  locationOrigin?: string;
  blobToDataUrl?: (blob: Blob) => Promise<string>;
}

export interface PrepareManuscriptClipboardOptions extends ManuscriptClipboardDependencies {
  doc: TipTapDoc;
  mode: ManuscriptClipboardMode;
  authToken?: string | null;
  apiBaseUrl?: string;
}

export type WriteManuscriptClipboardOptions = PrepareManuscriptClipboardOptions;

const PROTECTED_ASSET_PREFIX = '/storage/assets/';
const UUID_PATTERN = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;
const INTERNAL_HTML_ATTRIBUTE_PATTERN = /\s(?:class|data-asset-id)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

type ImageReference = {
  content: unknown[];
  index: number;
  node: Record<string, unknown>;
  label: string | null;
};

type ResolvedImageRequest = {
  url: string;
  authenticated: boolean;
};

export class ManuscriptClipboardWriteError extends Error {
  readonly richClipboardError: unknown;
  readonly plainClipboardError: unknown;

  constructor(richClipboardError: unknown, plainClipboardError: unknown) {
    super('Failed to write manuscript content to the clipboard');
    this.name = 'ManuscriptClipboardWriteError';
    this.richClipboardError = richClipboardError;
    this.plainClipboardError = plainClipboardError;
  }
}

function cloneDoc(doc: TipTapDoc): TipTapDoc {
  return JSON.parse(JSON.stringify(doc)) as TipTapDoc;
}

function imageLabel(node: Record<string, unknown>): string | null {
  const attrs = isRecord(node.attrs) ? node.attrs : {};
  const title = typeof attrs.title === 'string' ? attrs.title.trim() : '';
  if (title) return title;

  const alt = typeof attrs.alt === 'string' ? attrs.alt.trim() : '';
  if (!alt || UUID_PATTERN.test(alt)) return null;

  const assetId = typeof attrs['data-asset-id'] === 'string'
    ? attrs['data-asset-id'].trim()
    : typeof attrs.assetId === 'string'
      ? attrs.assetId.trim()
      : '';

  return assetId && alt.toLowerCase() === assetId.toLowerCase() ? null : alt;
}

function imagePlaceholder(label: string | null): Record<string, unknown> {
  return {
    type: 'text',
    text: label ? `[Image: ${label}]` : '[Image]',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function findImages(doc: TipTapDoc): ImageReference[] {
  const images: ImageReference[] = [];

  const visit = (node: unknown) => {
    if (!isRecord(node) || !Array.isArray(node.content)) return;

    node.content.forEach((child, index) => {
      if (!isRecord(child)) return;
      if (child.type === 'image') {
        images.push({
          content: node.content as unknown[],
          index,
          node: child,
          label: imageLabel(child),
        });
        return;
      }
      visit(child);
    });
  };

  visit(doc);
  return images;
}

function replaceImagesWithPlaceholders(doc: TipTapDoc): { doc: TipTapDoc; imageCount: number } {
  const cloned = cloneDoc(doc);
  const images = findImages(cloned);
  for (const image of images) {
    image.content[image.index] = imagePlaceholder(image.label);
  }
  return { doc: cloned, imageCount: images.length };
}

function sanitizeGeneratedHtml(html: string): string {
  return html.replace(/<[^>]+>/g, (tag) => tag.replace(INTERNAL_HTML_ATTRIBUTE_PATTERN, ''));
}

function defaultSerializeHTML(doc: TipTapDoc): string {
  return generateHTML(doc as JSONContent, buildRichTextExtensions());
}

function defaultSerializeText(doc: TipTapDoc): string {
  return generateText(doc as JSONContent, buildRichTextExtensions());
}

function resolveBaseUrl(apiBaseUrl: string | undefined, locationOrigin: string | undefined): URL | null {
  const rawApiBaseUrl = apiBaseUrl?.trim().replace(/\/+$/, '') ?? '';
  const browserOrigin = locationOrigin
    ?? (typeof window !== 'undefined' ? window.location.origin : undefined);

  try {
    if (rawApiBaseUrl) {
      return new URL(rawApiBaseUrl, browserOrigin);
    }
    return browserOrigin ? new URL(browserOrigin) : null;
  } catch {
    return null;
  }
}

function resolveImageRequest(
  src: string,
  apiBaseUrl: string | undefined,
  locationOrigin: string | undefined,
): ResolvedImageRequest {
  const baseUrl = resolveBaseUrl(apiBaseUrl, locationOrigin);

  let parsed: URL;
  try {
    parsed = baseUrl ? new URL(src, baseUrl) : new URL(src);
  } catch {
    throw new Error('Image URL is invalid');
  }

  if (parsed.protocol === 'blob:') {
    return { url: parsed.href, authenticated: false };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Image URL protocol is not supported');
  }

  const isProtectedAsset = parsed.pathname.startsWith(PROTECTED_ASSET_PREFIX);
  const isInternalOrigin = !!baseUrl && parsed.origin === baseUrl.origin;
  return {
    url: parsed.href,
    authenticated: isProtectedAsset && isInternalOrigin,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 3 * 8192;
  let encoded = '';

  for (let start = 0; start < bytes.length; start += chunkSize) {
    const chunk = bytes.subarray(start, Math.min(start + chunkSize, bytes.length));
    let binary = '';
    for (const byte of chunk) binary += String.fromCharCode(byte);
    encoded += btoa(binary);
  }

  return encoded;
}

async function defaultBlobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type};base64,${bytesToBase64(bytes)}`;
}

async function fetchImageAsDataUrl(
  request: ResolvedImageRequest,
  authToken: string | null | undefined,
  fetchImpl: FetchImplementation,
  blobToDataUrl: (blob: Blob) => Promise<string>,
): Promise<string> {
  let init: RequestInit | undefined;
  if (request.authenticated) {
    if (!authToken) throw new Error('Authentication token is missing');
    init = {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    };
  } else {
    init = { credentials: 'omit' };
  }

  const response = await fetchImpl(request.url, init);
  if (!response.ok) {
    throw new Error(`Failed to load image (${response.status})`);
  }
  const blob = await response.blob();
  if (!blob.type.toLowerCase().startsWith('image/')) {
    throw new Error('Fetched resource is not an image');
  }
  return blobToDataUrl(blob);
}

function browserClipboard(): ManuscriptClipboardWriter | undefined {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return undefined;
  return {
    write: (items) => navigator.clipboard.write(items as ClipboardItem[]),
    writeText: (text) => navigator.clipboard.writeText(text),
  };
}

function browserClipboardItemConstructor(): ManuscriptClipboardItemConstructor | undefined {
  if (typeof ClipboardItem === 'undefined') return undefined;
  return ClipboardItem as unknown as ManuscriptClipboardItemConstructor;
}

export async function prepareManuscriptClipboard({
  doc,
  mode,
  authToken,
  apiBaseUrl,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  serializeHTML = defaultSerializeHTML,
  serializeText = defaultSerializeText,
  locationOrigin,
  blobToDataUrl = defaultBlobToDataUrl,
}: PrepareManuscriptClipboardOptions): Promise<PreparedManuscriptClipboard> {
  const plain = replaceImagesWithPlaceholders(doc);
  const text = serializeText(plain.doc);

  if (mode === 'without-images') {
    return {
      html: sanitizeGeneratedHtml(serializeHTML(plain.doc)),
      text,
      includedImages: 0,
      omittedImages: plain.imageCount,
    };
  }

  const htmlDoc = cloneDoc(doc);
  const images = findImages(htmlDoc);
  const inflightImages = new Map<string, Promise<string>>();

  await Promise.all(images.map(async (image) => {
    const attrs = isRecord(image.node.attrs) ? { ...image.node.attrs } : {};
    delete attrs['data-asset-id'];
    delete attrs.assetId;
    delete attrs.class;

    const src = typeof attrs.src === 'string' ? attrs.src.trim() : '';
    if (!src) {
      image.content[image.index] = imagePlaceholder(image.label);
      return;
    }

    if (/^data:/i.test(src)) {
      attrs.src = src;
      image.node.attrs = attrs;
      return;
    }

    try {
      if (!fetchImpl) throw new Error('Fetch API is unavailable');
      const request = resolveImageRequest(src, apiBaseUrl, locationOrigin);
      let dataUrlPromise = inflightImages.get(request.url);
      if (!dataUrlPromise) {
        dataUrlPromise = fetchImageAsDataUrl(request, authToken, fetchImpl, blobToDataUrl);
        inflightImages.set(request.url, dataUrlPromise);
      }
      attrs.src = await dataUrlPromise;
      image.node.attrs = attrs;
    } catch {
      image.content[image.index] = imagePlaceholder(image.label);
    }
  }));

  const includedImages = findImages(htmlDoc).length;
  const omittedImages = images.length - includedImages;
  return {
    html: sanitizeGeneratedHtml(serializeHTML(htmlDoc)),
    text,
    includedImages,
    omittedImages,
  };
}

export async function writeManuscriptToClipboard(
  options: WriteManuscriptClipboardOptions,
): Promise<ManuscriptClipboardResult> {
  const clipboard = options.clipboard ?? browserClipboard();
  if (!clipboard) {
    throw new ManuscriptClipboardWriteError(undefined, new Error('Clipboard API is unavailable'));
  }

  const plain = replaceImagesWithPlaceholders(options.doc);
  const serializeText = options.serializeText ?? defaultSerializeText;
  const text = serializeText(plain.doc);
  const ClipboardItemCtor = options.ClipboardItemCtor ?? browserClipboardItemConstructor();
  let richClipboardError: unknown;

  if (clipboard.write && ClipboardItemCtor) {
    const preparation = prepareManuscriptClipboard(options);
    try {
      const htmlBlob = preparation.then(({ html }) => new Blob([html], { type: 'text/html' }));
      const item = new ClipboardItemCtor({
        'text/html': htmlBlob,
        'text/plain': new Blob([text], { type: 'text/plain' }),
      });

      await clipboard.write([item]);
      const prepared = await preparation;
      return {
        mode: options.mode,
        includedImages: prepared.includedImages,
        omittedImages: prepared.omittedImages,
        clipboardFormat: 'rich',
      };
    } catch (error) {
      richClipboardError = error;
    }
  } else {
    richClipboardError = new Error('Rich clipboard API is unavailable');
  }

  try {
    await clipboard.writeText(text);
    return {
      mode: options.mode,
      includedImages: 0,
      omittedImages: plain.imageCount,
      clipboardFormat: 'plain',
    };
  } catch (plainClipboardError) {
    throw new ManuscriptClipboardWriteError(richClipboardError, plainClipboardError);
  }
}
