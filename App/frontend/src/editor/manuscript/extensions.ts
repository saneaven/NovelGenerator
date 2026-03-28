import type { AnyExtension } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';

import ImageWithOverlay from '../../components/RichTextEditor/extensions/ImageWithOverlay';

export type ManuscriptExtensionsOptions = {
  placeholder?: string;
};

export function buildManuscriptExtensions(
  options: ManuscriptExtensionsOptions = {}
) {
  const { placeholder = 'Start writing...' } = options;

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
    Link.configure({
      openOnClick: false,
      autolink: true,
      defaultProtocol: 'https',
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

  return extensions;
}
