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
    borderRadius: 'var(--border-radius-md)',
    position: 'relative',
    width: '100%',
    height: '100%',
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
  { tag: tags.content, color: 'var(--color-text-primary)' },

  // Template syntax
  {
    tag: tags.variableName,
    color: 'var(--color-info)',
    fontWeight: 'var(--font-weight-medium)',
  },

  {
    tag: tags.special(tags.variableName),
    color: 'var(--color-brand-secondary)',
    fontWeight: 'var(--font-weight-medium)',
  },

  // Prompt fragment inclusion {{prompt "..."}}
  {
    tag: tags.atom,
    color: 'var(--color-success)',
    fontWeight: 'var(--font-weight-medium)',
    fontStyle: 'italic',
  },

  {
    tag: tags.keyword,
    color: 'var(--color-feedback-error-base)',
    fontWeight: 'var(--font-weight-semibold)',
  },

  // XML tags
  {
    tag: tags.tagName,
    color: 'var(--color-brand-accent)',
    fontWeight: 'var(--font-weight-medium)',
  },

  {
    tag: tags.angleBracket,
    color: 'var(--color-brand-accent)',
  },

  // Markdown
  {
    tag: tags.heading,
    color: 'var(--color-text-brand)',
    fontWeight: 'var(--font-weight-bold)',
  },

  {
    tag: tags.monospace,
    backgroundColor: 'var(--color-surface-muted)',
    color: 'var(--color-text-secondary)',
    fontFamily: 'var(--font-family-mono)',
    padding: '2px 4px',
    borderRadius: 'var(--border-radius-sm)',
  },

  {
    tag: tags.strong,
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-text-primary)',
  },

  {
    tag: tags.emphasis,
    fontStyle: 'italic',
    color: 'var(--color-text-secondary)',
  },

  {
    tag: tags.list,
    color: 'var(--color-text-brand)',
    fontWeight: 'var(--font-weight-medium)',
  },

  // Errors
  {
    tag: tags.invalid,
    color: 'var(--color-feedback-error-strong)',
    backgroundColor: 'var(--color-feedback-error-soft)',
    textDecoration: 'underline wavy var(--color-feedback-error-base)',
  },
]);

/**
 * Custom tag definitions for our template language
 * We need to extend the standard tags to match our token types
 */
const customTags = {
  variable: tags.variableName,
  context: tags.special(tags.variableName),
  ifOpen: tags.keyword,
  ifClose: tags.keyword,
  templateError: tags.invalid,

  xmlTagOpen: tags.tagName,
  xmlTagClose: tags.tagName,
  xmlTagSelf: tags.tagName,
  xmlError: tags.invalid,

  markdownHeader: tags.heading,
  markdownCodeBlock: tags.monospace,
  markdownInlineCode: tags.monospace,
  markdownBold: tags.strong,
  markdownItalic: tags.emphasis,
  markdownList: tags.list,

  text: tags.content,
};

/**
 * Combined theme extension for CodeMirror
 */
export const templateTheme: Extension = [
  templateEditorTheme,
  syntaxHighlighting(templateHighlightStyle),
];

/**
 * Export custom tags for use in language definition
 */
export { customTags };
