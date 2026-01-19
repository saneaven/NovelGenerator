import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Markdown } from '@tiptap/markdown';

import ImageWithOverlay from '../../components/RichTextEditor/extensions/ImageWithOverlay';

export type ManuscriptExtensionsOptions = {
  placeholder?: string;
  includeMarkdown?: boolean;
};

export function buildManuscriptExtensions(
  options: ManuscriptExtensionsOptions = {}
) {
  const { placeholder = 'Start writing...', includeMarkdown = false } = options;

  const extensions: AnyExtension[] = [
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3, 4, 5, 6],
      },
    }),
    ImageWithOverlay.configure({
      inline: true,
      allowBase64: true,
      HTMLAttributes: {
        class: 'novel-inline-image',
      },
    }),
    Placeholder.configure({
      placeholder,
    }),
    Table.configure({
      resizable: false,
    }),
    TableRow,
    TableCell,
    TableHeader,
  ];

  if (includeMarkdown) {
    extensions.push(
      Markdown.configure({
        markedOptions: { gfm: true },
      })
    );
  }

  return extensions;
}
