import { Editor } from '@tiptap/core';
import type { TipTapDoc } from '../../types/tiptap';
import { buildManuscriptExtensions } from './extensions';
import { emptyDoc, normalizeDoc } from './doc';

export function markdownToDoc(markdown: string): TipTapDoc {
  const editor = new Editor({
    extensions: buildManuscriptExtensions({ includeMarkdown: true, placeholder: '' }),
    content: '',
  });

  if (markdown) {
    editor.commands.setContent(markdown, { contentType: 'markdown' });
  } else {
    editor.commands.setContent(emptyDoc());
  }

  const doc = normalizeDoc(editor.getJSON() as TipTapDoc);
  editor.destroy();
  return doc;
}

export function docToMarkdown(docInput: unknown): string {
  const doc = normalizeDoc(docInput);

  const editor = new Editor({
    extensions: buildManuscriptExtensions({ includeMarkdown: true, placeholder: '' }),
    content: doc,
  });

  const markdown = editor.getMarkdown() || '';
  editor.destroy();
  return markdown;
}

