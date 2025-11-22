# CodeMirror 6 Syntax Highlighted Textarea

A professional-grade syntax highlighting editor built on CodeMirror 6, specifically designed for template prompt editing with support for double bracket syntax, XML tags, and Markdown.

## Architecture

```
┌─────────────────────────────────────┐
│  SyntaxHighlightedTextarea          │
│  (CodeMirror 6 Wrapper)             │
│                                     │
│  ┌───────────────────────────────┐  │
│  │  CodeMirror Editor            │  │
│  │  - Native text rendering      │  │
│  │  - Syntax highlighting        │  │
│  │  - Perfect alignment          │  │
│  │  - Smooth scrolling           │  │
│  │  - Selection handling         │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

## Components

### SyntaxHighlightedTextarea
CodeMirror-based component for template editing.

**Props:**
- `value: string` - Current content
- `onChange: (value: string) => void` - Change handler
- `placeholder?: string` - Placeholder text
- `minHeight?: number` - Minimum height in pixels (default: 200)
- `maxHeight?: number` - Maximum height in pixels (default: 600)

**Features:**
- Auto-resize based on content
- Tab key indentation (2 spaces)
- Perfect text/highlight alignment
- Native copy/paste/undo/redo
- Line wrapping
- Bracket matching
- Active line highlighting

### templateLanguage.ts
CodeMirror StreamLanguage parser for template syntax.

**Features:**
- Line-by-line tokenization
- Multi-line code block support
- Template syntax recognition
- XML tag parsing
- Markdown formatting

### templateTheme.ts
Dynamic theme system using CSS variables.

**Features:**
- Automatic Light/Dark mode support
- Uses theme.css CSS variables
- No hardcoded colors
- Seamless theme switching

## Supported Syntax

### Template Syntax
| Pattern | Example | Color |
|---------|---------|-------|
| Variable | `{{var::name}}` | Blue (--color-info) |
| Context | `{{context::data}}` | Purple (--color-brand-secondary) |
| If Open | `{{#if::condition}}` | Red (--color-feedback-error-base) |
| If Close | `{{/if}}` | Red (--color-feedback-error-base) |

### XML Tags
| Pattern | Example | Color |
|---------|---------|-------|
| Opening | `<thinking>` | Green (--color-brand-accent) |
| Closing | `</thinking>` | Green (--color-brand-accent) |
| Self-closing | `<br/>` | Green (--color-brand-accent) |

### Markdown
| Pattern | Example | Style |
|---------|---------|-------|
| Headers | `# Title` | Blue, Bold |
| Lists | `- item` or `1. item` | Blue bullet |
| Bold | `**text**` | Bold |
| Italic | `*text*` | Italic |
| Inline Code | `` `code` `` | Gray background |
| Code Block | ` ```code``` ` | Gray background |

## Error Highlighting

Unclosed brackets and tags are highlighted in red:
- `{{unclosed` → Red background with wavy underline
- `<unclosed` → Red background with wavy underline

## Token Types

```typescript
const TokenType = {
  TEXT: 'text',                // Plain text
  VARIABLE: 'variable',        // {{var::name}}
  CONTEXT: 'context',          // {{context::name}}
  IF_OPEN: 'if-open',          // {{#if::condition}}
  IF_CLOSE: 'if-close',        // {{/if}}
  TEMPLATE_ERROR: 'template-error',  // Unclosed {{
  XML_TAG_OPEN: 'xml-tag-open',      // <thinking>
  XML_TAG_CLOSE: 'xml-tag-close',    // </thinking>
  XML_TAG_SELF: 'xml-tag-self',      // <br/>
  XML_ERROR: 'xml-error',            // Unclosed <
  MARKDOWN_HEADER: 'md-header',      // # Header
  MARKDOWN_CODE_BLOCK: 'md-code',    // ```code```
  MARKDOWN_INLINE_CODE: 'md-inline-code', // `code`
  MARKDOWN_BOLD: 'md-bold',          // **bold**
  MARKDOWN_ITALIC: 'md-italic',      // *italic*
  MARKDOWN_LIST: 'md-list',          // - item
} as const;
```

## Usage Example

```tsx
import { SyntaxHighlightedTextarea } from './SyntaxHighlighter';

function MyEditor() {
  const [content, setContent] = useState('');

  return (
    <SyntaxHighlightedTextarea
      value={content}
      onChange={setContent}
      placeholder="Enter template..."
      minHeight={300}
      maxHeight={800}
    />
  );
}
```

## Performance

- **Efficient tokenization**: CodeMirror's optimized parser
- **Virtual scrolling**: Handles large documents smoothly
- **Minimal re-renders**: Only updates changed portions
- **Auto-resize**: Dynamically adjusts height based on content
- **Hardware acceleration**: Smooth scrolling and selection

## Advantages of CodeMirror 6

✅ Perfect text/highlight alignment
✅ No scroll synchronization bugs
✅ Smooth selection and cursor movement
✅ Professional-grade editor features
✅ Excellent performance with large files
✅ Accessibility built-in
✅ Extensible plugin system
✅ Active line highlighting
✅ Bracket matching
✅ Native undo/redo stack
✅ Multi-cursor support
✅ Battle-tested and maintained

## Migration from Overlay Approach

The previous implementation used a custom overlay approach with manual scroll synchronization. This caused several issues:

**Old Problems (Fixed):**
- ❌ Text/highlight misalignment due to scrollbar width
- ❌ Selection highlighting wrong areas
- ❌ Visual jitter during scrolling
- ❌ Font rendering discrepancies
- ❌ Hardcoded colors (no theme support)

**New Solution:**
- ✅ Single CodeMirror instance handles everything
- ✅ Perfect alignment guaranteed
- ✅ Smooth, native scrolling
- ✅ Dynamic CSS variable theming
- ✅ Professional editor experience

## Theme System

The editor theme uses CSS variables from `theme.css`:

```typescript
// Colors automatically adapt to light/dark mode
{
  backgroundColor: 'var(--color-surface-base)',
  color: 'var(--color-text-primary)',
  borderColor: 'var(--color-border-default)',
  // ... and many more
}
```

All colors are semantic and switch automatically when the theme changes.

## File Structure

```
SyntaxHighlighter/
├── SyntaxHighlightedTextarea.tsx  # Main component (CodeMirror wrapper)
├── templateLanguage.ts            # Custom language definition
├── templateTheme.ts               # Dynamic theme system
├── tokenTypes.ts                  # Token type definitions
├── index.ts                       # Public exports
├── README.md                      # This file
└── EXAMPLE.md                     # Usage examples
```

## Dependencies

- `@uiw/react-codemirror` - React wrapper for CodeMirror 6
- `@codemirror/language` - Language support
- `@codemirror/view` - Editor view
- `@codemirror/state` - Editor state management
- `@lezer/highlight` - Syntax highlighting

All dependencies are already installed in the project.
