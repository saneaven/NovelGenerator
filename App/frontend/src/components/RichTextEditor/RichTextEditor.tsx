/**
 * RichTextEditor - TipTap-based Rich Text Editor
 *
 * Features:
 * - Rich text editing with basic formatting
 * - Inline image support
 * - Image button opens unified image modal (via onBrowseAssets callback)
 * - Native markdown support via @tiptap/markdown
 */

import { useEffect, useCallback, useImperativeHandle, forwardRef, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
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
import { Image } from '../icons';
import './RichTextEditor.css';

export interface RichTextEditorRef {
  getHTML: () => string;
  getText: () => string;
  insertImage: (src: string, alt?: string) => void;
  updateImageSrc: (oldSrc: string, newSrc: string, newAlt?: string) => boolean;
  focus: () => void;
  getTextAroundCursor: () => { before: string; after: string };
  hasChanges: () => boolean;
  resetBaseline: () => void;
}

interface RichTextEditorProps {
  initialContent: string;  // Only used on mount - use key prop to remount for external updates
  onChange: (markdown: string) => void;
  placeholder?: string;
  disabled?: boolean;
  // Image insert callback - opens the unified image modal
  onBrowseAssets?: () => void;
  // Toolbar action props (optional - for integration with NovelEditorPanel)
  toolbarActions?: React.ReactNode;
  // Image overlay callbacks (for swap actions)
  // Change image - opens the asset library modal (user manually selects replacement)
  onSwapImage?: (currentSrc: string, imageBounds: DOMRect | null) => void;
  // Regenerate image - opens the asset library + generation panel with original settings prefilled
  onRegenerateImage?: (currentSrc: string, imageBounds: DOMRect | null) => void;
}

const RichTextEditor = forwardRef<RichTextEditorRef, RichTextEditorProps>(({
  initialContent,
  onChange,
  placeholder = 'Start writing...',
  disabled = false,
  onBrowseAssets,
  toolbarActions,
  onSwapImage,
  onRegenerateImage,
}, ref) => {
  // Use ref to hold onChange callback (prevents stale closure in onCreate)
  // See: https://tiptap.dev/docs/editor/api/events
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Track normalized baseline content for hasChanges() comparison
  // This is set after TipTap normalizes the initial content (in onCreate)
  const baselineRef = useRef<string | null>(null);

  // Heading dropdown state
  const [headingDropdownOpen, setHeadingDropdownOpen] = useState(false);
  const [headingDropdownPos, setHeadingDropdownPos] = useState({ top: 0, left: 0 });
  const headingTriggerRef = useRef<HTMLButtonElement>(null);
  const headingMenuRef = useRef<HTMLDivElement>(null);

  // Table dropdown state
  const [tableDropdownOpen, setTableDropdownOpen] = useState(false);
  const [tableDropdownPos, setTableDropdownPos] = useState({ top: 0, left: 0 });
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const tableTriggerRef = useRef<HTMLButtonElement>(null);
  const tableMenuRef = useRef<HTMLDivElement>(null);

  // Check if image button should be shown (browse callback provided)
  const showImageButton = !!onBrowseAssets;

  // Memoize image overlay callbacks to prevent unnecessary re-renders
  const imageOverlayCallbacks = useMemo<ImageOverlayCallbacks>(() => ({
    onSwapImage,
    onRegenerateImage,
  }), [onSwapImage, onRegenerateImage]);

  // Open heading dropdown with position calculation
  const openHeadingDropdown = () => {
    if (headingTriggerRef.current) {
      const rect = headingTriggerRef.current.getBoundingClientRect();
      setHeadingDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
    setHeadingDropdownOpen(true);
  };

  // Open table dropdown with position calculation
  const openTableDropdown = () => {
    if (tableTriggerRef.current) {
      const rect = tableTriggerRef.current.getBoundingClientRect();
      setTableDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
    setTableDropdownOpen(true);
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // Check heading dropdown
      if (headingDropdownOpen) {
        const clickedTrigger = headingTriggerRef.current?.contains(target);
        const clickedMenu = headingMenuRef.current?.contains(target);
        if (!clickedTrigger && !clickedMenu) {
          setHeadingDropdownOpen(false);
        }
      }
      // Check table dropdown
      if (tableDropdownOpen) {
        const clickedTrigger = tableTriggerRef.current?.contains(target);
        const clickedMenu = tableMenuRef.current?.contains(target);
        if (!clickedTrigger && !clickedMenu) {
          setTableDropdownOpen(false);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [headingDropdownOpen, tableDropdownOpen]);

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

      // Capture normalized baseline AFTER TipTap processes the content
      // This ensures hasChanges() compares normalized vs normalized (not raw input)
      baselineRef.current = editor.isEmpty ? '' : editor.getMarkdown();

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
    hasChanges: () => {
      if (!editor || baselineRef.current === null) return false;
      const currentContent = editor.isEmpty ? '' : editor.getMarkdown();
      return currentContent !== baselineRef.current;
    },
    resetBaseline: () => {
      if (editor) {
        baselineRef.current = editor.isEmpty ? '' : editor.getMarkdown();
      }
    },
  }), [editor, insertImage, updateImageSrc, getTextAroundCursor]);

  if (!editor) {
    return <div className="rich-text-editor loading">Loading editor...</div>;
  }

  return (
    <div className={`rich-text-editor ${disabled ? 'disabled' : ''}`}>
      {/* Toolbar */}
      <div className="editor-format-toolbar">
        {/* Scrollable format tools container */}
        <div className="toolbar-format-tools scrollbar-thin">
        {/* Heading Dropdown */}
        <div className="heading-dropdown">
          <button
            ref={headingTriggerRef}
            type="button"
            onClick={() => headingDropdownOpen ? setHeadingDropdownOpen(false) : openHeadingDropdown()}
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
        </div>
        {headingDropdownOpen && createPortal(
          <div
            ref={headingMenuRef}
            className="heading-dropdown-menu"
            style={{
              position: 'fixed',
              top: headingDropdownPos.top,
              left: headingDropdownPos.left,
            }}
          >
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
          </div>,
          document.body
        )}

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
        <div className="table-dropdown">
          <button
            ref={tableTriggerRef}
            type="button"
            onClick={() => tableDropdownOpen ? setTableDropdownOpen(false) : openTableDropdown()}
            className={`format-btn ${editor.isActive('table') ? 'active' : ''}`}
            disabled={disabled}
            title="Insert table"
          >
            ⊞
          </button>
        </div>
        {tableDropdownOpen && createPortal(
          <div
            ref={tableMenuRef}
            className="table-dropdown-menu"
            style={{
              position: 'fixed',
              top: tableDropdownPos.top,
              left: tableDropdownPos.left,
            }}
          >
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
          </div>,
          document.body
        )}

        <div className="toolbar-divider" />

        {/* Image button - opens image selection modal directly */}
        {showImageButton && (
          <button
            type="button"
            onClick={onBrowseAssets}
            className="format-btn image-btn"
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

      {/* Editor Content */}
      <EditorContent editor={editor} className="editor-content-wrapper" />
    </div>
  );
});

RichTextEditor.displayName = 'RichTextEditor';

export default RichTextEditor;
