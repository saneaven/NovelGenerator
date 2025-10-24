# Custom Syntax Highlighted Textarea

A fully custom syntax highlighting editor built specifically for template prompt editing with support for double bracket syntax, XML tags, and Markdown.

## Architecture

```
┌─────────────────────────────────────┐
│  SyntaxHighlightedTextarea          │
│  ┌───────────────────────────────┐  │
│  │  Overlay (Syntax Highlighter) │  │
│  │  - Renders colored tokens     │  │
│  │  - Syncs scroll position      │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │  Textarea (Transparent)       │  │
│  │  - User input handling        │  │
│  │  - Native browser features    │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

## Components

### SyntaxHighlightedTextarea
Main component that combines textarea with syntax highlighting overlay.

**Props:**
- `value: string` - Current content
- `onChange: (value: string) => void` - Change handler
- `placeholder?: string` - Placeholder text
- `minHeight?: number` - Minimum height in pixels (default: 200)
- `maxHeight?: number` - Maximum height in pixels (default: 600)

**Features:**
- Auto-resize based on content
- Tab key indentation (2 spaces)
- Synchronized scrolling
- Native copy/paste/undo/redo

### TemplateTokenizer
Parses template syntax into tokens for highlighting.

**Methods:**
- `tokenize(text: string): Line[]` - Tokenize entire text
- `validate(text: string): { valid: boolean; errors: string[] }` - Validate syntax

### SyntaxHighlighter
Renders highlighted tokens as overlay.

## Supported Syntax

### Template Syntax
| Pattern | Example | Color |
|---------|---------|-------|
| Variable | `{{var::name}}` | Blue |
| Context | `{{context::data}}` | Purple |
| If Open | `{{#if::condition}}` | Red |
| If Close | `{{/if}}` | Red |

### XML Tags
| Pattern | Example | Color |
|---------|---------|-------|
| Opening | `<thinking>` | Green |
| Closing | `</thinking>` | Green |
| Self-closing | `<br/>` | Green |

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
- `{{unclosed` → Red background
- `<unclosed` → Red background

## Token Types

```typescript
enum TokenType {
  TEXT,                 // Plain text
  VARIABLE,            // {{var::name}}
  CONTEXT,             // {{context::name}}
  IF_OPEN,             // {{#if::condition}}
  IF_CLOSE,            // {{/if}}
  TEMPLATE_ERROR,      // Unclosed {{
  XML_TAG_OPEN,        // <thinking>
  XML_TAG_CLOSE,       // </thinking>
  XML_TAG_SELF,        // <br/>
  XML_ERROR,           // Unclosed <
  MARKDOWN_HEADER,     // # Header
  MARKDOWN_CODE_BLOCK, // ```code```
  MARKDOWN_INLINE_CODE,// `code`
  MARKDOWN_BOLD,       // **bold**
  MARKDOWN_ITALIC,     // *italic*
  MARKDOWN_LIST,       // - item
}
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

- **Memoized tokenization**: Only re-tokenizes when content changes
- **Efficient rendering**: React reconciliation handles minimal DOM updates
- **Scroll sync**: Uses RAF for smooth synchronization
- **Auto-resize**: Dynamically adjusts height based on content

## Advantages Over Third-Party Libraries

✅ Full control over syntax rules
✅ Custom template syntax support
✅ Zero external dependencies (removed `@uiw/react-textarea-code-editor`)
✅ Native textarea behavior
✅ Better accessibility
✅ Easy to extend
✅ Lightweight (~300 lines total)
✅ Dark mode ready

## Future Enhancements

- [ ] Line numbers
- [ ] Virtual scrolling for huge files (>10,000 lines)
- [ ] Bracket/tag auto-closing
- [ ] Autocomplete for `{{var::` and `{{context::`
- [ ] Minimap overview
- [ ] Find/replace
- [ ] Web Worker tokenization for massive files
