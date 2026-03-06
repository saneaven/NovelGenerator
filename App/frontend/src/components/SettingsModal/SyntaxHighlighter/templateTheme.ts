import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * CodeMirror theme for template syntax highlighting
 * Uses CSS variables from theme.css for automatic Light/Dark mode support
 */

/**
 * Base editor theme - styling for the editor container and gutters
 */
export const templateEditorTheme = EditorView.theme({
  // Container must be position:relative with explicit height for absolute scroller
  '&': {
    fontSize: 'var(--font-size-sm)',
    fontFamily: 'var(--font-family-mono)',
    backgroundColor: 'var(--color-surface-base)',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border-default)',
    borderRadius: 'var(--border-radius-xl)',
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
    height: '100%',
    boxShadow: 'var(--shadow-inner-lg)',
  },

  '&.cm-focused': {
    outline: 'none',
    borderColor: 'var(--color-border-focus)',
    boxShadow: 'var(--shadow-focus)',
  },

  // Absolute positioning is required to constrain height in flex containers
  '.cm-scroller': {
    backgroundColor: 'var(--color-surface-base)',
    position: 'absolute !important',
    top: '0',
    right: '0',
    bottom: '0',
    left: '0',
    overflow: 'auto',
  },

  '.cm-content': {
    padding: 'var(--spacing-md)',
    caretColor: 'var(--color-text-primary)',
    fontFamily: 'var(--font-family-mono)',
    lineHeight: 'var(--line-height-relaxed)',
    backgroundColor: 'transparent',
  },

  '.cm-line': {
    padding: '0',
  },

  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--color-text-primary)',
    borderLeftWidth: '2px',
  },

  '&.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--color-brand-primary-soft)',
  },

  '.cm-selectionBackground': {
    backgroundColor: 'var(--color-surface-subtle)',
  },

  '.cm-gutters': {
    backgroundColor: 'var(--color-surface-subtle)',
    borderRight: '1px solid var(--color-border-default)',
    color: 'var(--color-text-muted)',
    fontFamily: 'var(--font-family-mono)',
  },

  '.cm-activeLineGutter': {
    backgroundColor: 'var(--color-surface-muted)',
    color: 'var(--color-text-primary)',
  },

  '.cm-activeLine': {
    backgroundColor: 'none',
    outline: '1px solid var(--color-border-subtle)',
  },


  // Placeholder styling
  '.cm-placeholder': {
    color: 'var(--color-text-muted)',
    fontStyle: 'italic',
  },
});

/**
 * Syntax highlighting theme - token colors
 * Maps template token types to CSS variables
 */
export const templateHighlightStyle = HighlightStyle.define([
  // Plain text - default color
  { tag: tags.content, color: 'var(--prompt-color-text)' },

  // Template syntax
  {
    tag: tags.variableName,
    color: 'var(--prompt-color-variable)',
    fontWeight: 'var(--font-weight-medium)',
  },

  {
    tag: tags.special(tags.variableName),
    color: 'var(--prompt-color-context)',
    fontWeight: 'var(--font-weight-medium)',
  },

  // Include block highlighting
  {
    tag: tags.atom,
    color: 'var(--prompt-color-include-block)',
    fontWeight: 'var(--font-weight-medium)',
  },

  // Jinja2 comments {# ... #}
  {
    tag: tags.comment,
    color: 'var(--prompt-color-comment)',
    fontStyle: 'italic',
  },

  {
    tag: tags.keyword,
    color: 'var(--prompt-color-keyword)',
    fontWeight: 'var(--font-weight-semibold)',
  },

  // XML tags
  {
    tag: tags.tagName,
    color: 'var(--prompt-color-tag)',
    fontWeight: 'var(--font-weight-medium)',
  },

  {
    tag: tags.angleBracket,
    color: 'var(--prompt-color-tag)',
  },

  // Markdown
  {
    tag: tags.heading,
    color: 'var(--prompt-color-heading)',
    fontWeight: 'var(--font-weight-bold)',
  },

  {
    tag: tags.monospace,
    backgroundColor: 'var(--prompt-color-code-bg)',
    color: 'var(--prompt-color-code)',
    fontFamily: 'var(--font-family-mono)',
    padding: '2px 4px',
    borderRadius: 'var(--border-radius-sm)',
  },

  {
    tag: tags.strong,
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--prompt-color-text)',
  },

  {
    tag: tags.emphasis,
    fontStyle: 'italic',
    color: 'var(--prompt-color-code)',
  },

  {
    tag: tags.list,
    color: 'var(--prompt-color-heading)',
    fontWeight: 'var(--font-weight-medium)',
  },

  // Errors
  {
    tag: tags.invalid,
    color: 'var(--prompt-color-error)',
    backgroundColor: 'var(--prompt-color-error-bg)',
    textDecoration: 'underline wavy var(--prompt-color-error-underline)',
  },
]);

/**
 * Combined theme extension for CodeMirror
 */
export const templateTheme: Extension = [
  templateEditorTheme,
  syntaxHighlighting(templateHighlightStyle),
];
