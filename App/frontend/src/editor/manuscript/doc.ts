import type { TipTapDoc } from '../../types/tiptap';

export function emptyDoc(): TipTapDoc {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  };
}

export function normalizeDoc(input: unknown): TipTapDoc {
  if (!input || typeof input !== 'object') return emptyDoc();
  const doc = input as TipTapDoc;
  if ((doc as any).type !== 'doc') return emptyDoc();
  const content = (doc as any).content;
  if (!Array.isArray(content) || content.length === 0) return emptyDoc();
  return doc;
}

const BLOCK_BREAK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'listItem',
  'tableRow',
  'tableHeader',
]);

export function docToPlainText(docInput: unknown): string {
  const doc = normalizeDoc(docInput);
  const out: string[] = [];

  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'text' && typeof node.text === 'string') {
      out.push(node.text);
      return;
    }

    const content = node.content;
    if (Array.isArray(content)) {
      for (const child of content) {
        walk(child);
      }
      if (BLOCK_BREAK_TYPES.has(node.type)) {
        out.push('\n');
      }
    }
  };

  walk(doc);
  return out.join('').replace(/\s+/g, ' ').trim();
}

export function docWordCount(docInput: unknown): number {
  const text = docToPlainText(docInput);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

export function stripImagesFromDoc(docInput: unknown): TipTapDoc {
  const doc = normalizeDoc(docInput);

  const strip = (node: any): any | null => {
    if (!node || typeof node !== 'object') return node;

    if (node.type === 'image') return null;

    const content = node.content;
    if (!Array.isArray(content)) return node;

    const nextContent: any[] = [];
    for (const child of content) {
      const next = strip(child);
      if (next) nextContent.push(next);
    }

    return { ...node, content: nextContent };
  };

  return normalizeDoc(strip(doc));
}

export type AssetImageRef = {
  assetId: string;
  position: number;
  src?: string;
};

export function extractAssetImageRefs(docInput: unknown): AssetImageRef[] {
  const doc = normalizeDoc(docInput);
  const out: AssetImageRef[] = [];

  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'image') {
      const attrs = node.attrs ?? {};
      const assetId = attrs['data-asset-id'] ?? attrs.assetId;
      if (typeof assetId === 'string' && assetId.length > 0) {
        out.push({ assetId, position: out.length, src: attrs.src });
      }
      return;
    }

    const content = node.content;
    if (Array.isArray(content)) {
      for (const child of content) walk(child);
    }
  };

  walk(doc);
  return out;
}
