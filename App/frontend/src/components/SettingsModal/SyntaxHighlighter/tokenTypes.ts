export const TokenType = {
    TEXT: 'text',

    // Template syntax
    VARIABLE: 'variable',              // {{var::name}}
    CONTEXT: 'context',                // {{context::name}}
    IF_OPEN: 'if-open',                // {{#if::condition}}
    IF_CLOSE: 'if-close',              // {{/if}}
    TEMPLATE_ERROR: 'template-error',  // Unclosed {{

    // XML tags
    XML_TAG_OPEN: 'xml-tag-open',      // <thinking>
    XML_TAG_CLOSE: 'xml-tag-close',    // </thinking>
    XML_TAG_SELF: 'xml-tag-self',      // <br/>
    XML_ERROR: 'xml-error',            // Unclosed <

    // Markdown
    MARKDOWN_HEADER: 'md-header',      // # Header
    MARKDOWN_CODE_BLOCK: 'md-code',    // ```code```
    MARKDOWN_INLINE_CODE: 'md-inline-code', // `code`
    MARKDOWN_BOLD: 'md-bold',          // **bold**
    MARKDOWN_ITALIC: 'md-italic',      // *italic*
    MARKDOWN_LIST: 'md-list',          // - item or 1. item
} as const;

export type TokenType = typeof TokenType[keyof typeof TokenType];

export interface Token
{
    type: TokenType;
    value: string;
    start: number;
    end: number;
}

export interface Line
{
    tokens: Token[];
    text: string;
}
