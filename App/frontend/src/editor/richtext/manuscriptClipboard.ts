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
  convertImageToPng?: ImageToPngConverter;
}

export interface PrepareManuscriptClipboardOptions extends ManuscriptClipboardDependencies {
  doc: TipTapDoc;
  mode: ManuscriptClipboardMode;
  authToken?: string | null;
  apiBaseUrl?: string;
}

export type WriteManuscriptClipboardOptions = PrepareManuscriptClipboardOptions;

const PROTECTED_ASSET_PREFIX = '/storage/assets/';
export const MANUSCRIPT_CLIPBOARD_MAX_IMAGE_DIMENSION = 2048;
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

export type ImageToPngConverter = (blob: Blob, maxDimension: number) => Promise<Blob>;

export type ConstrainedImageDimensions = {
  width: number;
  height: number;
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

function percentEncodedDataToBytes(payload: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < payload.length;) {
    if (payload[index] === '%' && /^[0-9a-f]{2}$/i.test(payload.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(payload.slice(index + 1, index + 3), 16));
      index += 3;
      continue;
    }

    const codePoint = payload.codePointAt(index);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    bytes.push(...new TextEncoder().encode(character));
    index += character.length;
  }
  return new Uint8Array(bytes);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0 || !/^data:/i.test(dataUrl)) {
    throw new Error('Image data URL is invalid');
  }

  const metadata = dataUrl.slice(5, commaIndex);
  const metadataParts = metadata.split(';');
  const mimeType = metadataParts[0]?.trim().toLowerCase() ?? '';
  if (!mimeType.startsWith('image/')) {
    throw new Error('Data URL is not an image');
  }

  const payload = dataUrl.slice(commaIndex + 1);
  const isBase64 = metadataParts.some((part) => part.trim().toLowerCase() === 'base64');
  if (!isBase64) {
    return new Blob([percentEncodedDataToBytes(payload)], { type: mimeType });
  }

  const binary = atob(decodeURIComponent(payload).replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

export function constrainImageDimensions(
  width: number,
  height: number,
  maxDimension = MANUSCRIPT_CLIPBOARD_MAX_IMAGE_DIMENSION,
): ConstrainedImageDimensions {
  if (![width, height, maxDimension].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Image dimensions must be positive finite numbers');
  }

  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function defaultConvertImageToPng(blob: Blob, maxDimension: number): Promise<Blob> {
  if (
    typeof document === 'undefined'
    || typeof Image === 'undefined'
    || typeof URL.createObjectURL !== 'function'
  ) {
    throw new Error('Browser image conversion APIs are unavailable');
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Failed to decode image'));
      image.src = objectUrl;
    });

    const dimensions = constrainImageDimensions(
      image.naturalWidth,
      image.naturalHeight,
      maxDimension,
    );
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Failed to create canvas context');
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((convertedBlob) => {
        if (convertedBlob) {
          resolve(convertedBlob);
        } else {
          reject(new Error('Failed to encode image as PNG'));
        }
      }, 'image/png');
    });
    if (pngBlob.type.toLowerCase() !== 'image/png') {
      throw new Error('Canvas returned an unexpected image format');
    }
    return pngBlob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function fetchImageBlob(
  request: ResolvedImageRequest,
  authToken: string | null | undefined,
  fetchImpl: FetchImplementation,
): Promise<Blob> {
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
  return blob;
}

async function convertBlobToPngDataUrl(
  blob: Blob,
  convertImageToPng: ImageToPngConverter,
  blobToDataUrl: (blob: Blob) => Promise<string>,
): Promise<string> {
  if (!blob.type.toLowerCase().startsWith('image/')) {
    throw new Error('Source Blob is not an image');
  }
  const pngBlob = await convertImageToPng(blob, MANUSCRIPT_CLIPBOARD_MAX_IMAGE_DIMENSION);
  if (pngBlob.type.toLowerCase() !== 'image/png') {
    throw new Error('Image converter did not return PNG');
  }
  const dataUrl = await blobToDataUrl(pngBlob);
  if (!/^data:image\/png;base64,/i.test(dataUrl)) {
    throw new Error('PNG converter returned an invalid data URL');
  }
  return dataUrl;
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
  convertImageToPng = defaultConvertImageToPng,
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

    try {
      const isDataUrl = /^data:/i.test(src);
      const request = isDataUrl ? null : resolveImageRequest(src, apiBaseUrl, locationOrigin);
      const cacheKey = isDataUrl ? src : request?.url;
      if (!cacheKey) throw new Error('Image URL is invalid');

      let dataUrlPromise = inflightImages.get(cacheKey);
      if (!dataUrlPromise) {
        dataUrlPromise = (async () => {
          let blob: Blob;
          if (isDataUrl) {
            blob = dataUrlToBlob(src);
          } else {
            if (!fetchImpl || !request) throw new Error('Fetch API is unavailable');
            blob = await fetchImageBlob(request, authToken, fetchImpl);
          }
          return convertBlobToPngDataUrl(blob, convertImageToPng, blobToDataUrl);
        })();
        inflightImages.set(cacheKey, dataUrlPromise);
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
