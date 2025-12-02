/**
 * RichTextEditor - TipTap-based Rich Text Editor
 *
 * Features:
 * - Rich text editing with basic formatting
 * - Inline image support
 * - Integration with AssetManagerModal
 * - Native markdown support via @tiptap/markdown
 */

import { useEffect, useCallback, useImperativeHandle, forwardRef, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import './RichTextEditor.css';

export interface RichTextEditorRef {
  getHTML: () => string;
  getText: () => string;
  insertImage: (src: string, alt?: string) => void;
  focus: () => void;
  getTextAroundCursor: () => { before: string; after: string };
}

interface RichTextEditorProps {
  initialContent: string;  // Only used on mount - use key prop to remount for external updates
  onChange: (markdown: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onImageButtonClick?: () => void;
}

const RichTextEditor = forwardRef<RichTextEditorRef, RichTextEditorProps>(({
  initialContent,
  onChange,
  placeholder = 'Start writing...',
  disabled = false,
  onImageButtonClick,
}, ref) => {
  // Use ref to hold onChange callback (prevents stale closure in onCreate)
  // See: https://tiptap.dev/docs/editor/api/events
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable heading as we want simple text for novels
        heading: false,
        // Keep paragraph, bold, italic, etc.
      }),
      Image.configure({
        inline: true,
        allowBase64: true,
        HTMLAttributes: {
          class: 'novel-inline-image',
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
      Markdown,
    ],
    content: initialContent, // Markdown content - parsed by Markdown extension
    contentType: 'markdown', // Tell TipTap to parse content as markdown
    editable: !disabled,
    // Bind onUpdate AFTER editor is initialized via onCreate
    // This prevents false "unsaved changes" on page load
    // See: https://github.com/ueberdosis/tiptap/issues/2583
    onCreate: ({ editor }) => {
      editor.on('update', ({ editor: updatedEditor }) => {
        // Use the official getMarkdown() method added by Markdown extension
        const markdown = updatedEditor.getMarkdown();
        onChangeRef.current(markdown);
      });
    },
    editorProps: {
      attributes: {
        class: 'tiptap-editor-content',
      },
    },
  });

  // Update editable state
  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled);
    }
  }, [disabled, editor]);

  // Insert image at cursor
  const insertImage = useCallback((src: string, alt?: string) => {
    if (editor) {
      editor.chain().focus().setImage({ src, alt: alt || '' }).run();
    }
  }, [editor]);

  // Get text before and after cursor position
  const getTextAroundCursor = useCallback(() => {
    if (!editor) return { before: '', after: '' };
    const { anchor } = editor.state.selection;
    const fullText = editor.getText();
    // Get text content up to cursor position
    const textBeforeCursor = editor.state.doc.textBetween(0, anchor, ' ');
    const textPos = textBeforeCursor.length;
    return {
      before: fullText.slice(0, textPos),
      after: fullText.slice(textPos),
    };
  }, [editor]);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    getHTML: () => editor?.getHTML() || '',
    getText: () => editor?.getText() || '',
    insertImage,
    focus: () => editor?.chain().focus().run(),
    getTextAroundCursor,
  }), [editor, insertImage, getTextAroundCursor]);

  if (!editor) {
    return <div className="rich-text-editor loading">Loading editor...</div>;
  }

  return (
    <div className={`rich-text-editor ${disabled ? 'disabled' : ''}`}>
      {/* Toolbar */}
      <div className="editor-format-toolbar">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`format-btn ${editor.isActive('bold') ? 'active' : ''}`}
          disabled={disabled}
          title="Bold (Ctrl+B)"
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`format-btn ${editor.isActive('italic') ? 'active' : ''}`}
          disabled={disabled}
          title="Italic (Ctrl+I)"
        >
          <em>I</em>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`format-btn ${editor.isActive('strike') ? 'active' : ''}`}
          disabled={disabled}
          title="Strikethrough"
        >
          <s>S</s>
        </button>

        <div className="toolbar-divider" />

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={`format-btn ${editor.isActive('blockquote') ? 'active' : ''}`}
          disabled={disabled}
          title="Quote"
        >
          "
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          className="format-btn"
          disabled={disabled}
          title="Horizontal rule"
        >
          —
        </button>

        <div className="toolbar-divider" />

        {onImageButtonClick && (
          <button
            type="button"
            onClick={onImageButtonClick}
            className="format-btn image-btn"
            disabled={disabled}
            title="Insert image"
          >
            🖼️
          </button>
        )}
      </div>

      {/* Editor Content */}
      <EditorContent editor={editor} className="editor-content-wrapper" />
    </div>
  );
});

RichTextEditor.displayName = 'RichTextEditor';

export default RichTextEditor;
