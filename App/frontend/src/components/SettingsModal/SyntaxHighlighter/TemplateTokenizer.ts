import { TokenType } from './tokenTypes';
import type { Token, Line } from './tokenTypes';

/**
 * Template tokenizer for prompt syntax highlighting
 * Supports: {{template}} syntax, XML tags, and Markdown
 */
export class TemplateTokenizer
{
    /**
     * Tokenize entire text content
     */
    public tokenize(text: string): Line[]
    {
        const lines = text.split('\n');
        const result: Line[] = [];
        let inCodeBlock = false;

        for (let i = 0; i < lines.length; i++)
        {
            const lineText = lines[i];

            // Check for code block markers
            if (lineText.trim().startsWith('```'))
            {
                inCodeBlock = !inCodeBlock;
                result.push({
                    text: lineText,
                    tokens: [{
                        type: TokenType.MARKDOWN_CODE_BLOCK,
                        value: lineText,
                        start: 0,
                        end: lineText.length
                    }]
                });
                continue;
            }

            // Inside code block - treat as code
            if (inCodeBlock)
            {
                result.push({
                    text: lineText,
                    tokens: [{
                        type: TokenType.MARKDOWN_CODE_BLOCK,
                        value: lineText,
                        start: 0,
                        end: lineText.length
                    }]
                });
                continue;
            }

            // Normal line tokenization
            const tokens = this.tokenizeLine(lineText);
            result.push({
                text: lineText,
                tokens
            });
        }

        return result;
    }

    /**
     * Tokenize a single line
     */
    private tokenizeLine(line: string): Token[]
    {
        const tokens: Token[] = [];
        let position = 0;

        // Check for markdown header at line start
        const headerMatch = line.match(/^(#{1,6})\s+/);
        if (headerMatch)
        {
            tokens.push({
                type: TokenType.MARKDOWN_HEADER,
                value: line,
                start: 0,
                end: line.length
            });
            return tokens;
        }

        // Check for markdown list at line start
        const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+/);
        if (listMatch)
        {
            const marker = listMatch[0];
            tokens.push({
                type: TokenType.MARKDOWN_LIST,
                value: marker,
                start: 0,
                end: marker.length
            });
            position = marker.length;
        }

        // Parse rest of line for inline syntax
        while (position < line.length)
        {
            const remaining = line.substring(position);

            // Try to match template syntax {{...}}
            const templateMatch = this.matchTemplate(remaining);
            if (templateMatch)
            {
                tokens.push({
                    type: templateMatch.type,
                    value: templateMatch.value,
                    start: position,
                    end: position + templateMatch.value.length
                });
                position += templateMatch.value.length;
                continue;
            }

            // Try to match XML tags
            const xmlMatch = this.matchXmlTag(remaining);
            if (xmlMatch)
            {
                tokens.push({
                    type: xmlMatch.type,
                    value: xmlMatch.value,
                    start: position,
                    end: position + xmlMatch.value.length
                });
                position += xmlMatch.value.length;
                continue;
            }

            // Try to match inline code `...`
            const inlineCodeMatch = remaining.match(/^`([^`]+)`/);
            if (inlineCodeMatch)
            {
                tokens.push({
                    type: TokenType.MARKDOWN_INLINE_CODE,
                    value: inlineCodeMatch[0],
                    start: position,
                    end: position + inlineCodeMatch[0].length
                });
                position += inlineCodeMatch[0].length;
                continue;
            }

            // Try to match bold **...**
            const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
            if (boldMatch)
            {
                tokens.push({
                    type: TokenType.MARKDOWN_BOLD,
                    value: boldMatch[0],
                    start: position,
                    end: position + boldMatch[0].length
                });
                position += boldMatch[0].length;
                continue;
            }

            // Try to match italic *...*
            const italicMatch = remaining.match(/^\*([^*]+)\*/);
            if (italicMatch)
            {
                tokens.push({
                    type: TokenType.MARKDOWN_ITALIC,
                    value: italicMatch[0],
                    start: position,
                    end: position + italicMatch[0].length
                });
                position += italicMatch[0].length;
                continue;
            }

            // No match - collect plain text until next special character
            const textMatch = remaining.match(/^[^{<`*]+/);
            if (textMatch)
            {
                tokens.push({
                    type: TokenType.TEXT,
                    value: textMatch[0],
                    start: position,
                    end: position + textMatch[0].length
                });
                position += textMatch[0].length;
                continue;
            }

            // Single character fallback
            tokens.push({
                type: TokenType.TEXT,
                value: remaining[0],
                start: position,
                end: position + 1
            });
            position++;
        }

        return tokens;
    }

    /**
     * Match template syntax {{...}}
     */
    private matchTemplate(text: string): { type: TokenType; value: string } | null
    {
        if (!text.startsWith('{{'))
        {
            return null;
        }

        // Find closing }}
        const closeIndex = text.indexOf('}}', 2);
        if (closeIndex === -1)
        {
            // Unclosed template - mark as error
            return {
                type: TokenType.TEMPLATE_ERROR,
                value: text.substring(0, Math.min(text.length, 20)) + '...'
            };
        }

        const content = text.substring(2, closeIndex);
        const fullMatch = text.substring(0, closeIndex + 2);

        // Determine type based on content
        if (content.startsWith('var::'))
        {
            return { type: TokenType.VARIABLE, value: fullMatch };
        }
        else if (content.startsWith('context::'))
        {
            return { type: TokenType.CONTEXT, value: fullMatch };
        }
        else if (content.startsWith('#if::'))
        {
            return { type: TokenType.IF_OPEN, value: fullMatch };
        }
        else if (content === '/if')
        {
            return { type: TokenType.IF_CLOSE, value: fullMatch };
        }
        else
        {
            // Unknown template type - treat as variable
            return { type: TokenType.VARIABLE, value: fullMatch };
        }
    }

    /**
     * Match XML tags <...>
     */
    private matchXmlTag(text: string): { type: TokenType; value: string } | null
    {
        if (!text.startsWith('<'))
        {
            return null;
        }

        // Find closing >
        const closeIndex = text.indexOf('>', 1);
        if (closeIndex === -1)
        {
            // Unclosed tag - mark as error
            return {
                type: TokenType.XML_ERROR,
                value: text.substring(0, Math.min(text.length, 20)) + '...'
            };
        }

        const fullMatch = text.substring(0, closeIndex + 1);

        // Self-closing tag
        if (fullMatch.endsWith('/>'))
        {
            return { type: TokenType.XML_TAG_SELF, value: fullMatch };
        }

        // Closing tag
        if (fullMatch.startsWith('</'))
        {
            return { type: TokenType.XML_TAG_CLOSE, value: fullMatch };
        }

        // Opening tag
        return { type: TokenType.XML_TAG_OPEN, value: fullMatch };
    }

    /**
     * Validate template syntax (check for unclosed brackets/tags)
     */
    public validate(text: string): { valid: boolean; errors: string[] }
    {
        const errors: string[] = [];
        const templateStack: number[] = [];
        const xmlStack: { tag: string; line: number }[] = [];

        const lines = text.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++)
        {
            const line = lines[lineNum];

            // Check for unclosed {{
            let pos = 0;
            while (pos < line.length)
            {
                if (line.substring(pos).startsWith('{{'))
                {
                    const closeIndex = line.indexOf('}}', pos + 2);
                    if (closeIndex === -1)
                    {
                        errors.push(`Line ${lineNum + 1}: Unclosed template bracket {{`);
                    }
                    else
                    {
                        pos = closeIndex + 2;
                        continue;
                    }
                }

                // Check for XML tags
                if (line[pos] === '<' && pos + 1 < line.length && line[pos + 1] !== ' ')
                {
                    const closeIndex = line.indexOf('>', pos + 1);
                    if (closeIndex === -1)
                    {
                        errors.push(`Line ${lineNum + 1}: Unclosed XML tag <`);
                    }
                    else
                    {
                        const tag = line.substring(pos, closeIndex + 1);

                        // Self-closing
                        if (tag.endsWith('/>'))
                        {
                            // OK
                        }
                        // Closing tag
                        else if (tag.startsWith('</'))
                        {
                            const tagName = tag.substring(2, tag.length - 1);
                            const lastOpen = xmlStack.pop();
                            if (!lastOpen || lastOpen.tag !== tagName)
                            {
                                errors.push(`Line ${lineNum + 1}: Unexpected closing tag </${tagName}>`);
                            }
                        }
                        // Opening tag
                        else
                        {
                            const tagName = tag.substring(1, tag.length - 1).split(' ')[0];
                            xmlStack.push({ tag: tagName, line: lineNum + 1 });
                        }

                        pos = closeIndex + 1;
                        continue;
                    }
                }

                pos++;
            }
        }

        // Check for unclosed XML tags
        for (const unclosed of xmlStack)
        {
            errors.push(`Line ${unclosed.line}: Unclosed XML tag <${unclosed.tag}>`);
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}
