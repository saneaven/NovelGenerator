import './dom-polyfill.js';
import express from 'express';
import { Editor } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { buildHeadlessExtensions } from './extensions.js';

const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(express.json({ limit: '10mb' }));

function normalizeDoc(input: unknown): JSONContent {
  if (!input || typeof input !== 'object') {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }
  const doc = input as JSONContent;
  if (doc.type !== 'doc') {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }
  if (!Array.isArray(doc.content)) {
    return { ...doc, content: [{ type: 'paragraph' }] };
  }
  return doc;
}

function withEditor<T>(content: JSONContent | string, fn: (editor: Editor) => T): T {
  const editor = new Editor({
    extensions: buildHeadlessExtensions({ includeMarkdown: true, placeholder: '' }),
    content,
  });
  try {
    return fn(editor);
  } finally {
    editor.destroy();
  }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/doc-to-markdown', (req, res) => {
  try {
    const markdown = withEditor(normalizeDoc(req.body?.doc), (editor) => editor.getMarkdown() || '');
    res.json({ markdown });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/markdown-to-doc', (req, res) => {
  try {
    const markdown = typeof req.body?.markdown === 'string' ? req.body.markdown : '';
    const doc = withEditor('', (editor) => {
      if (markdown) {
        editor.commands.setContent(markdown, { contentType: 'markdown' });
      } else {
        editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
      }
      return normalizeDoc(editor.getJSON());
    });
    res.json({ doc });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.listen(PORT, () => {
  console.log(`[sidecar] listening on ${PORT}`);
});
