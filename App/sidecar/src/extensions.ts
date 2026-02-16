import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Markdown } from '@tiptap/markdown';

export type HeadlessExtensionsOptions = {
  placeholder?: string;
  includeMarkdown?: boolean;
};

const HeadlessImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-asset-id': {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-asset-id'),
        renderHTML: (attrs: Record<string, unknown>) => {
          const assetId = attrs['data-asset-id'];
          if (typeof assetId !== 'string' || !assetId.trim()) {
            return {};
          }
          return { 'data-asset-id': assetId };
        },
      },
    };
  },
});

export function buildHeadlessExtensions(options: HeadlessExtensionsOptions = {}): AnyExtension[] {
  const { placeholder = '', includeMarkdown = true } = options;

  const extensions: AnyExtension[] = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
    }),
    HeadlessImage.configure({
      inline: true,
      allowBase64: true,
      HTMLAttributes: {
        class: 'novel-inline-image',
      },
    }),
    Placeholder.configure({ placeholder }),
    Table.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
  ];

  if (includeMarkdown) {
    extensions.push(Markdown.configure({ markedOptions: { gfm: true } }));
  }

  return extensions;
}
