import { StreamLanguage } from '@codemirror/language';
import type { StreamParser } from '@codemirror/language';

/**
 * CodeMirror StreamLanguage for LiquidJS template syntax highlighting
 * Supports: {{ variable }}, {% tag %}, XML tags, and Markdown
 */

interface TemplateState {
  inCodeBlock: boolean;
}

const templateParser: StreamParser<TemplateState> = {
  name: 'liquid',

  startState: (): TemplateState => ({
    inCodeBlock: false,
  }),

  token(stream, state) {
    // Check for code block markers at start of line
    if (stream.sol()) {
      if (stream.match(/^```/)) {
        state.inCodeBlock = !state.inCodeBlock;
        stream.skipToEnd();
        return 'monospace';
      }
    }

    // Inside code block - consume entire line
    if (state.inCodeBlock) {
      stream.skipToEnd();
      return 'monospace';
    }

    // Check for markdown header at line start
    if (stream.sol() && stream.match(/^#{1,6}\s+/)) {
      stream.skipToEnd();
      return 'heading';
    }

    // Check for markdown list at line start
    if (stream.sol() && stream.match(/^(\s*)([-*+]|\d+\.)\s+/)) {
      return 'list';
    }

    // Try to match LiquidJS tag {% ... %}
    if (stream.match(/^\{%/)) {
      while (!stream.eol()) {
        if (stream.match(/^%\}/)) {
          return 'keyword';
        }
        stream.next();
      }
      return 'keyword'; // Unclosed tag is still highlighted as keyword
    }

    // Try to match LiquidJS output {{ ... }}
    if (stream.match(/^\{\{/)) {
      while (!stream.eol()) {
        if (stream.match(/^\}\}/)) {
          return 'variableName';
        }
        stream.next();
      }
      return 'variableName'; // Unclosed variable is still highlighted
    }

    // Try to match XML tags <...>
    if (stream.match(/^<\/?[a-zA-Z]/)) {
      stream.backUp(1);
      stream.next();

      let foundClose = false;
      stream.match(/^\//);
      stream.match(/^[a-zA-Z][\w-]*/);

      while (!stream.eol()) {
        if (stream.match(/^>/) || stream.match(/^\/>/)) {
          foundClose = true;
          break;
        }
        stream.next();
      }

      if (!foundClose) {
        return 'invalid';
      }

      return 'tagName';
    }

    // Try to match inline code `...`
    if (stream.match(/^`[^`]+`/)) {
      return 'monospace';
    }

    // Try to match bold **...**
    if (stream.match(/^\*\*[^*]+\*\*/)) {
      return 'strong';
    }

    // Try to match italic *...*
    if (stream.match(/^\*[^*]+\*/)) {
      return 'emphasis';
    }

    // No match - consume plain text until next special character
    if (stream.match(/^[^{<`*]+/)) {
      return null;
    }

    // Single character fallback
    stream.next();
    return null;
  },

  blankLine() {
    return null;
  },

  copyState(state) {
    return {
      inCodeBlock: state.inCodeBlock,
    };
  },
};

export const templateLanguage = StreamLanguage.define(templateParser);
