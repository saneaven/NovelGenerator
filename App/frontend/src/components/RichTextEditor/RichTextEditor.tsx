/**
 * RichTextEditor - TipTap-based Rich Text Editor
 *
 * Features:
 * - Rich text editing with basic formatting
 * - Inline image support
 * - Image insert menu with drag-drop, browse, and generate options
 * - Native markdown support via @tiptap/markdown
 */

import { useEffect, useCallback, useImperativeHandle, forwardRef, useRef, useState, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Markdown } from '@tiptap/markdown';
import ImageWithOverlay from './extensions/ImageWithOverlay';
import { IMAGE_OVERLAY_STORAGE_KEY, type ImageOverlayCallbacks } from './extensions/ImageNodeView';
import ImageInsertMenu from './ImageInsertMenu';
import type { Asset } from '../../api/assetService';
import { Image } from '../icons';
import './RichTextEditor.css';

export interface RichTextEditorRef {
  getHTML: () => string;
  getText: () => string;
  insertImage: (src: string, alt?: string) => void;
  updateImageSrc: (oldSrc: string, newSrc: string, newAlt?: string) => boolean;
  focus: () => void;
  getTextAroundCursor: () => { before: string; after: string };
}

interface RichTextEditorProps {
  initialContent: string;  // Only used on mount - use key prop to remount for external updates
  onChange: (markdown: string) => void;
  placeholder?: string;
  disabled?: boolean;
  // Image insert menu callbacks
  onFileUpload?: (file: File) => void;
  onBrowseAssets?: () => void;
  onGenerateImage?: () => void;
  onManageSceneAssets?: () => void;
  // Toolbar action props (optional - for integration with NovelEditorPanel)
  toolbarActions?: React.ReactNode;
  // Image overlay callbacks (for replace, regenerate actions)
  projectId?: string;
  onReplaceImage?: (currentSrc: string) => void;
  onRegenerateImage?: (asset: Asset, imageBounds: DOMRect) => void;
  getAssetByUrl?: (src: string) => Promise<Asset | null>;
}

const RichTextEditor = forwardRef<RichTextEditorRef, RichTextEditorProps>(({
  initialContent,
  onChange,
  placeholder = 'Start writing...',
  disabled = false,
  onFileUpload,
  onBrowseAssets,
  onGenerateImage,
  onManageSceneAssets,
  toolbarActions,
  projectId,
  onReplaceImage,
  onRegenerateImage,
  getAssetByUrl,
}, ref) => {
  // Use ref to hold onChange callback (prevents stale closure in onCreate)
  // See: https://tiptap.dev/docs/editor/api/events
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Heading dropdown state
  const [headingDropdownOpen, setHeadingDropdownOpen] = useState(false);
  const headingDropdownRef = useRef<HTMLDivElement>(null);

  // Table dropdown state
  const [tableDropdownOpen, setTableDropdownOpen] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const tableDropdownRef = useRef<HTMLDivElement>(null);

  // Image insert menu state
  const [imageMenuOpen, setImageMenuOpen] = useState(false);
  const imageButtonRef = useRef<HTMLButtonElement>(null);

  // Check if new image menu should be used (all callbacks provided)
  const useImageMenu = !!(onFileUpload && onBrowseAssets && onGenerateImage);

  // Memoize image overlay callbacks to prevent unnecessary re-renders
  const imageOverlayCallbacks = useMemo<ImageOverlayCallbacks>(() => ({
    projectId,
    onReplace: onReplaceImage,
    onRegenerate: onRegenerateImage,
    getAssetByUrl,
  }), [projectId, onReplaceImage, onRegenerateImage, getAssetByUrl]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (headingDropdownRef.current && !headingDropdownRef.current.contains(e.target as Node)) {
        setHeadingDropdownOpen(false);
      }
      if (tableDropdownRef.current && !tableDropdownRef.current.contains(e.target as Node)) {
        setTableDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const editor = useEditor({
    extensions: [
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
      Markdown.configure({
        markedOptions: { gfm: true },
      }),
    ],
    content: '', // Start empty - markdown content set in onCreate
    editable: !disabled,
    // Bind onUpdate AFTER editor is initialized via onCreate
    // This prevents false "unsaved changes" on page load
    // See: https://github.com/ueberdosis/tiptap/issues/2583
    onCreate: ({ editor }) => {
      // Set markdown content AFTER editor is created
      // The contentType option in useEditor doesn't work properly with @tiptap/markdown
      if (initialContent) {
        editor.commands.setContent(initialContent, { contentType: 'markdown' });
      }

      // Handle general content changes
      editor.on('update', ({ editor: updatedEditor }) => {
        // Use TipTap's built-in isEmpty check - more reliable than string matching
        // Fixes issue where empty editor returns <p></p> instead of empty string
        if (updatedEditor.isEmpty) {
          onChangeRef.current('');
          return;
        }
        const markdown = updatedEditor.getMarkdown();
        onChangeRef.current(markdown);
      });

      // Handle node/mark deletions (including images)
      // The 'delete' event fires specifically when content is deleted
      // This ensures image deletions trigger onChange even if 'update' doesn't fire
      editor.on('delete', () => {
        if (editor.isEmpty) {
          onChangeRef.current('');
          return;
        }
        const markdown = editor.getMarkdown();
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

  // Update image overlay callbacks in editor storage when they change
  useEffect(() => {
    if (editor) {
      // Use type assertion - TipTap storage is dynamically typed per extension
      // Store directly at the key that ImageNodeView expects
      (editor.storage as unknown as Record<string, unknown>)[IMAGE_OVERLAY_STORAGE_KEY] = imageOverlayCallbacks;
    }
  }, [editor, imageOverlayCallbacks]);

  // Insert image at cursor
  const insertImage = useCallback((src: string, alt?: string) => {
    if (editor) {
      editor.chain().focus().setImage({ src, alt: alt || '' }).run();
    }
  }, [editor]);

  // Update an existing image's src by finding it in the document
  const updateImageSrc = useCallback((oldSrc: string, newSrc: string, newAlt?: string): boolean => {
    if (!editor) return false;

    let found = false;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && node.attrs.src === oldSrc) {
        const attrs: Record<string, string> = { src: newSrc };
        if (newAlt !== undefined) {
          attrs.alt = newAlt;
        }
        editor.chain()
          .setNodeSelection(pos)
          .updateAttributes('image', attrs)
          .run();
        found = true;
        return false; // Stop iteration
      }
      return true; // Continue iteration
    });

    return found;
  }, [editor]);

  // Get text before and after cursor position
  const getTextAroundCursor = useCallback(() => {
    if (!editor) return { before: '', after: '' };
    const { anchor } = editor.state.selection;
    const docSize = editor.state.doc.content.size;
    // Use consistent separator (double newline between blocks, matching getText() behavior)
    const textBeforeCursor = editor.state.doc.textBetween(0, anchor, '\n\n');
    const textAfterCursor = editor.state.doc.textBetween(anchor, docSize, '\n\n');
    return {
      before: textBeforeCursor,
      after: textAfterCursor,
    };
  }, [editor]);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    getHTML: () => editor?.getHTML() || '',
    getText: () => editor?.getText() || '',
    insertImage,
    updateImageSrc,
    focus: () => editor?.chain().focus().run(),
    getTextAroundCursor,
  }), [editor, insertImage, updateImageSrc, getTextAroundCursor]);

  if (!editor) {
    return <div className="rich-text-editor loading">Loading editor...</div>;
  }

  return (
    <div className={`rich-text-editor ${disabled ? 'disabled' : ''}`}>
      {/* Toolbar */}
      <div className="editor-format-toolbar">
        {/* Scrollable format tools container */}
        <div className="toolbar-format-tools">
        {/* Heading Dropdown */}
        <div className="heading-dropdown" ref={headingDropdownRef}>
          <button
            type="button"
            onClick={() => setHeadingDropdownOpen(!headingDropdownOpen)}
            className={`format-btn heading-dropdown-trigger ${
              editor.isActive('heading') ? 'active' : ''
            }`}
            disabled={disabled}
            title="Heading"
          >
            {editor.isActive('heading', { level: 1 }) ? 'H1' :
             editor.isActive('heading', { level: 2 }) ? 'H2' :
             editor.isActive('heading', { level: 3 }) ? 'H3' :
             editor.isActive('heading', { level: 4 }) ? 'H4' :
             editor.isActive('heading', { level: 5 }) ? 'H5' :
             editor.isActive('heading', { level: 6 }) ? 'H6' : '¶'}
            <span className="dropdown-arrow">▾</span>
          </button>
          {headingDropdownOpen && (
            <div className="heading-dropdown-menu">
              <button
                type="button"
                className={`heading-dropdown-item ${!editor.isActive('heading') ? 'active' : ''}`}
                onClick={() => {
                  editor.chain().focus().setParagraph().run();
                  setHeadingDropdownOpen(false);
                }}
              >
                <span className="heading-label">¶</span>
                <span>Paragraph</span>
              </button>
              {([1, 2, 3, 4, 5, 6] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`heading-dropdown-item ${editor.isActive('heading', { level }) ? 'active' : ''}`}
                  onClick={() => {
                    editor.chain().focus().toggleHeading({ level }).run();
                    setHeadingDropdownOpen(false);
                  }}
                >
                  <span className="heading-label">H{level}</span>
                  <span>Heading {level}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="toolbar-divider" />

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
        {/* Table Dropdown */}
        <div className="table-dropdown" ref={tableDropdownRef}>
          <button
            type="button"
            onClick={() => setTableDropdownOpen(!tableDropdownOpen)}
            className={`format-btn ${editor.isActive('table') ? 'active' : ''}`}
            disabled={disabled}
            title="Insert table"
          >
            ⊞
          </button>
          {tableDropdownOpen && (
            <div className="table-dropdown-menu">
              <div className="table-size-inputs">
                <label>
                  <span>Rows</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={tableRows}
                    onChange={(e) => setTableRows(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                  />
                </label>
                <label>
                  <span>Cols</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={tableCols}
                    onChange={(e) => setTableCols(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                  />
                </label>
              </div>
              <button
                type="button"
                className="table-insert-btn"
                onClick={() => {
                  editor.chain().focus().insertTable({ rows: tableRows, cols: tableCols, withHeaderRow: true }).run();
                  setTableDropdownOpen(false);
                }}
              >
                Insert Table
              </button>
            </div>
          )}
        </div>

        <div className="toolbar-divider" />

        {/* Image button with menu */}
        {useImageMenu && (
          <button
            ref={imageButtonRef}
            type="button"
            onClick={() => setImageMenuOpen(!imageMenuOpen)}
            className={`format-btn image-btn ${imageMenuOpen ? 'active' : ''}`}
            disabled={disabled}
            title="Insert image"
          >
            <Image size="md" />
          </button>
        )}
        </div>

        {/* Toolbar Actions - right side (passed from parent) */}
        {toolbarActions && (
          <>
            <div className="toolbar-spacer" />
            <div className="toolbar-actions">
              {toolbarActions}
            </div>
          </>
        )}
      </div>

      {/* Image Insert Menu */}
      {useImageMenu && (
        <ImageInsertMenu
          isOpen={imageMenuOpen}
          onClose={() => setImageMenuOpen(false)}
          onUpload={onFileUpload}
          onBrowseFiles={onBrowseAssets}
          onGenerateImage={onGenerateImage}
          onManageSceneAssets={onManageSceneAssets}
          anchorRef={imageButtonRef}
        />
      )}

      {/* Editor Content */}
      <EditorContent editor={editor} className="editor-content-wrapper" />
    </div>
  );
});

RichTextEditor.displayName = 'RichTextEditor';

export default RichTextEditor;
