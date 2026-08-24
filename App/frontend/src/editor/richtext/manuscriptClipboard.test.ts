import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example.test');
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
});

import type { TipTapDoc } from '../../types/tiptap';
import {
  MANUSCRIPT_CLIPBOARD_MAX_IMAGE_DIMENSION,
  ManuscriptClipboardWriteError,
  constrainImageDimensions,
  prepareManuscriptClipboard,
  writeManuscriptToClipboard,
  type ManuscriptClipboardItem,
} from './manuscriptClipboard';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function serializeHTML(doc: TipTapDoc): string {
  const render = (node: unknown): string => {
    if (!node || typeof node !== 'object') return '';
    const value = node as Record<string, unknown>;
    if (value.type === 'text') return escapeHtml(String(value.text ?? ''));

    const attrs = value.attrs && typeof value.attrs === 'object'
      ? value.attrs as Record<string, unknown>
      : {};
    if (value.type === 'image') {
      const renderedAttrs = Object.entries(attrs)
        .filter(([, attrValue]) => attrValue !== null && attrValue !== undefined)
        .map(([name, attrValue]) => ` ${name}="${escapeHtml(String(attrValue))}"`)
        .join('');
      return `<img class="novel-inline-image"${renderedAttrs}>`;
    }

    const content = Array.isArray(value.content) ? value.content.map(render).join('') : '';
    if (value.type === 'doc') return content;
    if (value.type === 'heading') return `<h1>${content}</h1>`;
    if (value.type === 'paragraph') return `<p>${content}</p>`;
    return content;
  };
  return render(doc);
}

function serializeText(doc: TipTapDoc): string {
  const blocks: string[] = [];
  const render = (node: unknown): string => {
    if (!node || typeof node !== 'object') return '';
    const value = node as Record<string, unknown>;
    if (value.type === 'text') return String(value.text ?? '');
    const content = Array.isArray(value.content) ? value.content.map(render).join('') : '';
    if (value.type === 'paragraph' || value.type === 'heading') blocks.push(content);
    return content;
  };
  render(doc);
  return blocks.join('\n\n');
}

function imageDoc(images: Array<Record<string, unknown>>): TipTapDoc {
  return {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: images.map((attrs) => ({ type: 'image', attrs })),
    }],
  };
}

function response(bytes: number[], mimeType: string, status = 200): Response {
  return new Response(new Uint8Array(bytes), {
    status,
    headers: { 'Content-Type': mimeType },
  });
}

function decodeDataUrl(dataUrl: string): { mimeType: string; bytes: number[] } {
  const match = /^data:([^;]*);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error(`Not a base64 data URL: ${dataUrl}`);
  const binary = atob(match[2]);
  return {
    mimeType: match[1],
    bytes: Array.from(binary, (character) => character.charCodeAt(0)),
  };
}

function pngConverter() {
  return vi.fn(async (blob: Blob, _maxDimension: number) => new Blob([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    await blob.arrayBuffer(),
  ], { type: 'image/png' }));
}

class TestClipboardItem implements ManuscriptClipboardItem {
  readonly entries: Record<string, string | Blob | PromiseLike<string | Blob>>;
  readonly types: ReadonlyArray<string>;

  constructor(entries: Record<string, string | Blob | PromiseLike<string | Blob>>) {
    this.entries = entries;
    this.types = Object.keys(entries);
  }
}

describe('prepareManuscriptClipboard', () => {
  it('clones the document and replaces images with title/meaningful-alt placeholders', async () => {
    const uuid = '86ed0fd5-e54b-4e88-a919-c0518e785f24';
    const doc = imageDoc([
      { src: '/storage/assets/title.avif', title: 'Cover', alt: 'ignored' },
      { src: '/storage/assets/alt.avif', alt: 'Character portrait' },
      { src: '/storage/assets/uuid.avif', alt: uuid },
      { src: '/storage/assets/id.avif', alt: 'asset-key', 'data-asset-id': 'asset-key' },
      { src: '/storage/assets/empty.avif', alt: '   ' },
    ]);
    doc.content?.push({ type: 'paragraph', content: [{ type: 'text', text: 'Keep class="prose" as text' }] });
    const original = JSON.parse(JSON.stringify(doc));

    const prepared = await prepareManuscriptClipboard({
      doc,
      mode: 'without-images',
      serializeHTML,
      serializeText,
    });

    expect(prepared).toEqual({
      html: '<p>[Image: Cover][Image: Character portrait][Image][Image][Image]</p><p>Keep class=&quot;prose&quot; as text</p>',
      text: '[Image: Cover][Image: Character portrait][Image][Image][Image]\n\nKeep class="prose" as text',
      includedImages: 0,
      omittedImages: 5,
    });
    expect(doc).toEqual(original);
  });

  it('converts fetched and existing data URL images to PNG, deduplicates, and omits failed images', async () => {
    const originalDataUrl = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    const doc = imageDoc([
      { src: '/storage/assets/originals/a.avif', alt: 'first', 'data-asset-id': 'asset-a', class: 'private' },
      { src: '/storage/assets/originals/a.avif', alt: 'duplicate', 'data-asset-id': 'asset-a' },
      { src: 'https://cdn.example.test/image.webp', title: 'External' },
      { src: 'blob:https://app.example.test/blob-id', alt: 'Blob image' },
      { src: originalDataUrl, alt: 'Inline image' },
      { src: '/storage/assets/missing.avif', title: 'Missing image' },
    ]);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/originals/a.avif')) return response([0, 1, 2, 253, 254, 255], 'image/avif');
      if (url === 'https://cdn.example.test/image.webp') return response([4, 5, 6], 'image/webp');
      if (url.startsWith('blob:')) return response([7, 8, 9], 'image/jpeg');
      if (url.endsWith('/missing.avif')) return response([], 'image/avif', 404);
      throw new Error(`Unexpected URL ${url} (${String(init)})`);
    });
    const convertImageToPng = pngConverter();

    const prepared = await prepareManuscriptClipboard({
      doc,
      mode: 'with-images',
      authToken: 'secret-token',
      apiBaseUrl: 'https://api.example.test',
      locationOrigin: 'https://app.example.test',
      fetchImpl,
      convertImageToPng,
      serializeHTML,
      serializeText,
    });

    expect(prepared.includedImages).toBe(5);
    expect(prepared.omittedImages).toBe(1);
    expect(prepared.html).toContain('[Image: Missing image]');
    expect(prepared.html).not.toContain(originalDataUrl);
    expect(prepared.html).not.toContain('/storage/assets/');
    expect(prepared.html).not.toContain('blob:');
    expect(prepared.html).not.toContain('data-asset-id');
    expect(prepared.html).not.toContain('class=');
    expect(prepared.html).toContain('data:image/png');

    const embeddedSources = Array.from(prepared.html.matchAll(/src="([^"]+)"/g), (match) => match[1]);
    expect(decodeDataUrl(embeddedSources[0])).toEqual({
      mimeType: 'image/png',
      bytes: [0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 253, 254, 255],
    });
    expect(embeddedSources[1]).toBe(embeddedSources[0]);
    expect(decodeDataUrl(embeddedSources[2])).toEqual({
      mimeType: 'image/png',
      bytes: [0x89, 0x50, 0x4e, 0x47, 4, 5, 6],
    });
    expect(decodeDataUrl(embeddedSources[3])).toEqual({
      mimeType: 'image/png',
      bytes: [0x89, 0x50, 0x4e, 0x47, 7, 8, 9],
    });
    expect(decodeDataUrl(embeddedSources[4]).mimeType).toBe('image/png');

    expect(convertImageToPng).toHaveBeenCalledTimes(4);
    expect(convertImageToPng.mock.calls.map(([blob]) => blob.type).sort()).toEqual([
      'image/avif',
      'image/gif',
      'image/jpeg',
      'image/webp',
    ]);
    expect(convertImageToPng.mock.calls.every(([, maxDimension]) => (
      maxDimension === MANUSCRIPT_CLIPBOARD_MAX_IMAGE_DIMENSION
    ))).toBe(true);

    const internalCalls = fetchImpl.mock.calls.filter(([input]) => String(input).endsWith('/originals/a.avif'));
    expect(internalCalls).toHaveLength(1);
    expect(internalCalls[0][1]?.headers).toEqual({ Authorization: 'Bearer secret-token' });
    const externalCall = fetchImpl.mock.calls.find(([input]) => String(input) === 'https://cdn.example.test/image.webp');
    expect(externalCall?.[1]).toEqual({ credentials: 'omit' });
    const blobCall = fetchImpl.mock.calls.find(([input]) => String(input).startsWith('blob:'));
    expect(blobCall?.[1]).toEqual({ credentials: 'omit' });
  });

  it('never sends authentication to a protected-looking URL on another origin', async () => {
    const fetchImpl = vi.fn(async () => response([1, 2, 3], 'image/avif'));

    await prepareManuscriptClipboard({
      doc: imageDoc([{ src: 'https://cdn.example.test/storage/assets/a.avif' }]),
      mode: 'with-images',
      authToken: 'secret-token',
      apiBaseUrl: 'https://api.example.test',
      fetchImpl,
      convertImageToPng: pngConverter(),
      serializeHTML,
      serializeText,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://cdn.example.test/storage/assets/a.avif',
      { credentials: 'omit' },
    );
  });

  it('uses a placeholder when a fetched resource has no image MIME type', async () => {
    const convertImageToPng = pngConverter();
    const prepared = await prepareManuscriptClipboard({
      doc: imageDoc([{ src: 'https://cdn.example.test/not-an-image', title: 'Invalid' }]),
      mode: 'with-images',
      fetchImpl: async () => response([1, 2, 3], ''),
      convertImageToPng,
      serializeHTML,
      serializeText,
    });

    expect(prepared.html).toBe('<p>[Image: Invalid]</p>');
    expect(prepared.includedImages).toBe(0);
    expect(prepared.omittedImages).toBe(1);
    expect(convertImageToPng).not.toHaveBeenCalled();
  });

  it('limits the long edge to 2048px without upscaling and preserves aspect ratio', () => {
    expect(constrainImageDimensions(4096, 2048)).toEqual({ width: 2048, height: 1024 });
    expect(constrainImageDimensions(1000, 3000)).toEqual({ width: 683, height: 2048 });
    expect(constrainImageDimensions(1024, 512)).toEqual({ width: 1024, height: 512 });
  });
});

describe('writeManuscriptToClipboard', () => {
  it('calls clipboard.write immediately with one item containing HTML and plain text', async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    let clipboardItem: TestClipboardItem | undefined;
    const write = vi.fn(async (items: ManuscriptClipboardItem[]) => {
      clipboardItem = items[0] as TestClipboardItem;
      await clipboardItem.entries['text/html'];
    });
    const writeText = vi.fn(async () => undefined);
    const convertImageToPng = pngConverter();

    const pending = writeManuscriptToClipboard({
      doc: imageDoc([{ src: '/storage/assets/a.avif', title: 'Cover' }]),
      mode: 'with-images',
      authToken: 'token',
      apiBaseUrl: 'https://api.example.test',
      fetchImpl,
      convertImageToPng,
      clipboard: { write, writeText },
      ClipboardItemCtor: TestClipboardItem,
      serializeHTML,
      serializeText,
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(clipboardItem).toBeDefined();
    expect(Object.keys(clipboardItem?.entries ?? {}).sort()).toEqual(['text/html', 'text/plain']);
    expect(clipboardItem?.entries['text/html']).toBeInstanceOf(Promise);
    resolveFetch?.(response([11, 12, 13], 'image/avif'));

    await expect(pending).resolves.toEqual({
      mode: 'with-images',
      includedImages: 1,
      omittedImages: 0,
      clipboardFormat: 'rich',
    });
    const htmlBlob = await clipboardItem?.entries['text/html'];
    const plainBlob = await clipboardItem?.entries['text/plain'];
    expect(htmlBlob).toBeInstanceOf(Blob);
    expect((htmlBlob as Blob).type).toBe('text/html');
    expect(await (htmlBlob as Blob).text()).toContain('data:image/png;base64,iVBORwsMDQ==');
    expect(plainBlob).toBeInstanceOf(Blob);
    expect((plainBlob as Blob).type).toBe('text/plain');
    expect(await (plainBlob as Blob).text()).toBe('[Image: Cover]');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to writeText and reports all images as omitted when rich write fails', async () => {
    const write = vi.fn(async () => {
      throw new Error('rich clipboard denied');
    });
    const writeText = vi.fn(async () => undefined);

    const result = await writeManuscriptToClipboard({
      doc: imageDoc([{ src: 'data:image/avif;base64,AA==', title: 'Cover' }]),
      mode: 'with-images',
      clipboard: { write, writeText },
      ClipboardItemCtor: TestClipboardItem,
      convertImageToPng: pngConverter(),
      serializeHTML,
      serializeText,
    });

    expect(result).toEqual({
      mode: 'with-images',
      includedImages: 0,
      omittedImages: 1,
      clipboardFormat: 'plain',
    });
    expect(writeText).toHaveBeenCalledWith('[Image: Cover]');
  });

  it('does not fetch images when only the plain-text clipboard is available', async () => {
    const fetchImpl = vi.fn(async () => response([1, 2, 3], 'image/avif'));
    const writeText = vi.fn(async () => undefined);

    const result = await writeManuscriptToClipboard({
      doc: imageDoc([{ src: '/storage/assets/a.avif', title: 'Cover' }]),
      mode: 'with-images',
      fetchImpl,
      clipboard: { writeText },
      serializeHTML,
      serializeText,
    });

    expect(result.clipboardFormat).toBe('plain');
    expect(writeText).toHaveBeenCalledWith('[Image: Cover]');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws a typed error only after both rich and plain clipboard writes fail', async () => {
    const richError = new Error('rich failed');
    const plainError = new Error('plain failed');

    const pending = writeManuscriptToClipboard({
      doc: imageDoc([]),
      mode: 'without-images',
      clipboard: {
        write: async () => { throw richError; },
        writeText: async () => { throw plainError; },
      },
      ClipboardItemCtor: TestClipboardItem,
      serializeHTML,
      serializeText,
    });

    await expect(pending).rejects.toMatchObject({
      name: 'ManuscriptClipboardWriteError',
      richClipboardError: richError,
      plainClipboardError: plainError,
    });
    await expect(pending).rejects.toBeInstanceOf(ManuscriptClipboardWriteError);
  });
});
