// TipTap rich-text editor. Uncontrolled: loads initialContent on mount; reload via remount.

import { useEffect, useCallback, useImperativeHandle, forwardRef, useRef, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent } from '@tiptap/react';

import { NumberInput } from '../ui/NumberInput';
import { IMAGE_OVERLAY_STORAGE_KEY, type ImageOverlayCallbacks } from './extensions/ImageNodeView';
import {
  Image,
  ChevronDown,
  BulletList,
  OrderedList,
  Quote,
  CodeBlock,
  TableIcon,
} from '../icons';
import type { TipTapDoc } from '../../types/tiptap';
import { normalizeDoc, emptyDoc } from '../../editor/richtext/doc';
import { buildRichTextExtensions } from '../../editor/richtext/extensions';

import './RichTextEditor.css';

export interface RichTextEditorRef {
  getHTML: () => string;
  getText: () => string;
  getDoc: () => TipTapDoc;
  setDoc: (doc: TipTapDoc) => void;
  getScrollPosition: () => number;
  setScrollPosition: (scrollTop: number) => void;
  insertImage: (src: string, alt?: string, assetId?: string, title?: string) => void;
  updateImageSrc: (oldSrc: string, newSrc: string, newAlt?: string, newAssetId?: string, newTitle?: string) => boolean;
  focus: () => void;
  getTextAroundCursor: () => { before: string; after: string };
  hasChanges: () => boolean;
  resetBaseline: () => void;
}

interface RichTextEditorProps {
  initialContent: TipTapDoc;
  onChange?: (doc: TipTapDoc) => void;
  placeholder?: string;
  disabled?: boolean;
  onBrowseAssets?: () => void;
  toolbarActions?: React.ReactNode;
  onSwapImage?: (currentSrc: string, imageBounds: DOMRect | null) => void;
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
  const { t } = useTranslation();
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Track baseline doc for hasChanges()
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

  const showImageButton = !!onBrowseAssets;
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const imageOverlayCallbacks = useMemo<ImageOverlayCallbacks>(() => ({
    onSwapImage,
    onRegenerateImage,
  }), [onSwapImage, onRegenerateImage]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (headingDropdownOpen && headingMenuRef.current && !headingMenuRef.current.contains(target) &&
          headingTriggerRef.current && !headingTriggerRef.current.contains(target)) {
        setHeadingDropdownOpen(false);
      }
      if (tableDropdownOpen && tableMenuRef.current && !tableMenuRef.current.contains(target) &&
          tableTriggerRef.current && !tableTriggerRef.current.contains(target)) {
        setTableDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [headingDropdownOpen, tableDropdownOpen]);

  const editor = useEditor({
    extensions: buildRichTextExtensions({ placeholder }),
    content: '', // Set in onCreate to avoid false "unsaved changes"
    editable: !disabled,
    onCreate: ({ editor }) => {
      const doc = normalizeDoc(initialContent);
      editor.commands.setContent(doc, { emitUpdate: false });

      baselineRef.current = JSON.stringify(editor.getJSON());

      editor.on('update', ({ editor: updatedEditor }) => {
        const next = updatedEditor.getJSON() as TipTapDoc;
        onChangeRef.current?.(next);
      });

      editor.on('delete', () => {
        const next = editor.getJSON() as TipTapDoc;
        onChangeRef.current?.(next);
      });
    },
    editorProps: {
      attributes: {
        class: 'tiptap-editor-content',
      },
    },
  });

  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled);
    }
  }, [disabled, editor]);

  useEffect(() => {
    if (editor) {
      (editor.storage as unknown as Record<string, unknown>)[IMAGE_OVERLAY_STORAGE_KEY] = imageOverlayCallbacks;
    }
  }, [editor, imageOverlayCallbacks]);

  const insertImage = useCallback((src: string, alt?: string, assetId?: string, title?: string) => {
    if (!editor) return;
    const attrs: Record<string, any> = { src, alt: alt || '' };
    if (title) {
      attrs.title = title;
    }
    if (assetId) {
      attrs['data-asset-id'] = assetId;
    }
    editor.chain().focus().setImage(attrs as any).run();
  }, [editor]);

  const updateImageSrc = useCallback((oldSrc: string, newSrc: string, newAlt?: string, newAssetId?: string, newTitle?: string): boolean => {
    if (!editor) return false;

    let found = false;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && node.attrs.src === oldSrc) {
        const attrs: Record<string, any> = { src: newSrc };
        if (newAlt !== undefined) {
          attrs.alt = newAlt;
        }
        if (newTitle !== undefined) {
          attrs.title = newTitle;
        }
        if (newAssetId !== undefined) {
          attrs['data-asset-id'] = newAssetId;
        }
        editor.chain()
          .setNodeSelection(pos)
          .updateAttributes('image', attrs)
          .run();
        found = true;
        return false;
      }
      return true;
    });

    return found;
  }, [editor]);

  const getTextAroundCursor = useCallback(() => {
    if (!editor) return { before: '', after: '' };
    const { anchor } = editor.state.selection;
    const docSize = editor.state.doc.content.size;
    const textBeforeCursor = editor.state.doc.textBetween(0, anchor, '\n\n');
    const textAfterCursor = editor.state.doc.textBetween(anchor, docSize, '\n\n');
    return {
      before: textBeforeCursor,
      after: textAfterCursor,
    };
  }, [editor]);

  useImperativeHandle(ref, () => ({
    getHTML: () => editor?.getHTML() || '',
    getText: () => editor?.getText() || '',
    getDoc: () => (editor?.getJSON() as TipTapDoc) || emptyDoc(),
    setDoc: (nextDoc: TipTapDoc) => {
      if (!editor) return;
      editor.commands.setContent(normalizeDoc(nextDoc));
    },
    getScrollPosition: () => scrollContainerRef.current?.scrollTop ?? 0,
    setScrollPosition: (scrollTop: number) => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollTop;
      }
    },
    insertImage,
    updateImageSrc,
    focus: () => editor?.chain().focus().run(),
    getTextAroundCursor,
    hasChanges: () => {
      if (!editor || baselineRef.current === null) return false;
      const current = JSON.stringify(editor.getJSON());
      return current !== baselineRef.current;
    },
    resetBaseline: () => {
      if (!editor) return;
      baselineRef.current = JSON.stringify(editor.getJSON());
    },
  }), [editor, insertImage, updateImageSrc, getTextAroundCursor]);

  if (!editor) {
    return <div className="rich-text-editor loading">{t('richTextEditor.loading')}</div>;
  }

  // === Dropdown helpers (copied from RichTextEditor) ===

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

  return (
    <div className={`rich-text-editor ${disabled ? 'disabled' : ''}`}>
      <div className="editor-format-toolbar">
        <div className="toolbar-format-tools scrollbar-thin">
          <div className="heading-dropdown">
            <button
              ref={headingTriggerRef}
              type="button"
              onClick={() => headingDropdownOpen ? setHeadingDropdownOpen(false) : openHeadingDropdown()}
              className={`format-btn heading-dropdown-trigger ${editor.isActive('heading') ? 'active' : ''}`}
              disabled={disabled}
              title={t('richTextEditor.toolbar.heading')}
            >
              {editor.isActive('heading', { level: 1 }) ? 'H1' :
               editor.isActive('heading', { level: 2 }) ? 'H2' :
               editor.isActive('heading', { level: 3 }) ? 'H3' :
               editor.isActive('heading', { level: 4 }) ? 'H4' :
               editor.isActive('heading', { level: 5 }) ? 'H5' :
               editor.isActive('heading', { level: 6 }) ? 'H6' : '¶'}
              <ChevronDown size="xs" className="dropdown-arrow" />
            </button>
          </div>

          {headingDropdownOpen && createPortal(
            <div
              ref={headingMenuRef}
              className="heading-dropdown-menu"
              style={{ position: 'fixed', top: headingDropdownPos.top, left: headingDropdownPos.left }}
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
                <span>{t('richTextEditor.headingDropdown.paragraph')}</span>
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
                  <span>{t('richTextEditor.headingDropdown.heading', { level })}</span>
                </button>
              ))}
            </div>,
            document.body
          )}

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`format-btn ${editor.isActive('bold') ? 'active' : ''}`}
            disabled={disabled}
            title={t('richTextEditor.toolbar.bold')}
          >
            <strong>B</strong>
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`format-btn ${editor.isActive('italic') ? 'active' : ''}`}
            disabled={disabled}
            title={t('richTextEditor.toolbar.italic')}
          >
            <em>I</em>
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={`format-btn ${editor.isActive('strike') ? 'active' : ''}`}
            disabled={disabled}
            title={t('richTextEditor.toolbar.strikethrough')}
          >
            <s>S</s>
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`format-btn ${editor.isActive('bulletList') ? 'active' : ''}`}
            disabled={disabled}
            title={t('richTextEditor.toolbar.bulletList')}
          >
            <BulletList size="md" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`format-btn ${editor.isActive('orderedList') ? 'active' : ''}`}
            disabled={disabled}
            title={t('richTextEditor.toolbar.numberedList')}
          >
            <OrderedList size="md" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={`format-btn ${editor.isActive('blockquote') ? 'active' : ''}`}
            disabled={disabled}
            title={t('richTextEditor.toolbar.quote')}
          >
            <Quote size="md" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={`format-btn ${editor.isActive('codeBlock') ? 'active' : ''}`}
            disabled={disabled}
            title={t('richTextEditor.toolbar.codeBlock')}
          >
            <CodeBlock size="md" />
          </button>

          <div className="table-dropdown">
            <button
              ref={tableTriggerRef}
              type="button"
              onClick={() => tableDropdownOpen ? setTableDropdownOpen(false) : openTableDropdown()}
              className={`format-btn table-dropdown-trigger ${editor.isActive('table') ? 'active' : ''}`}
              disabled={disabled}
              title={t('richTextEditor.toolbar.table')}
            >
              <TableIcon size="md" />
              <ChevronDown size="xs" className="dropdown-arrow" />
            </button>
          </div>

          {tableDropdownOpen && createPortal(
            <div
              ref={tableMenuRef}
              className="table-dropdown-menu"
              style={{ position: 'fixed', top: tableDropdownPos.top, left: tableDropdownPos.left }}
            >
              <div className="table-dimensions">
                <label>{t('richTextEditor.tableDropdown.rows')}</label>
                <NumberInput
                  min={1}
                  max={20}
                  value={tableRows}
                  onValueChange={(v) => setTableRows(v!)}
                />
              </div>
              <div className="table-dimensions">
                <label>{t('richTextEditor.tableDropdown.cols')}</label>
                <NumberInput
                  min={1}
                  max={10}
                  value={tableCols}
                  onValueChange={(v) => setTableCols(v!)}
                />
              </div>
              <button
                type="button"
                className="table-action-btn"
                onClick={() => {
                  editor.chain().focus().insertTable({ rows: tableRows, cols: tableCols, withHeaderRow: true }).run();
                  setTableDropdownOpen(false);
                }}
              >
                {t('richTextEditor.tableDropdown.insertTable')}
              </button>
              {editor.isActive('table') && (
                <>
                  <button type="button" className="table-action-btn" onClick={() => editor.chain().focus().addRowAfter().run()}>
                    {t('richTextEditor.tableDropdown.addRow')}
                  </button>
                  <button type="button" className="table-action-btn" onClick={() => editor.chain().focus().addColumnAfter().run()}>
                    {t('richTextEditor.tableDropdown.addColumn')}
                  </button>
                  <button type="button" className="table-action-btn danger" onClick={() => editor.chain().focus().deleteTable().run()}>
                    {t('richTextEditor.tableDropdown.deleteTable')}
                  </button>
                </>
              )}
            </div>,
            document.body
          )}

          {showImageButton && (
            <button
              type="button"
              onClick={onBrowseAssets}
              className="format-btn"
              disabled={disabled}
              title={t('richTextEditor.toolbar.insertImage')}
            >
              <Image size="sm" />
            </button>
          )}
        </div>

        {toolbarActions && (
          <div className="toolbar-actions">
            {toolbarActions}
          </div>
        )}
      </div>

      <div ref={scrollContainerRef} className="editor-content-wrapper">
        <EditorContent editor={editor} className="editor-content-inner" />
      </div>
    </div>
  );
});

RichTextEditor.displayName = 'RichTextEditor';

export default RichTextEditor;
