import React, { useMemo } from 'react';
import { TemplateTokenizer } from './TemplateTokenizer';
import type { Line } from './tokenTypes';
import './SyntaxHighlighter.css';

interface SyntaxHighlighterProps
{
    code: string;
    className?: string;
}

/**
 * Renders syntax-highlighted code overlay
 */
const SyntaxHighlighter: React.FC<SyntaxHighlighterProps> = ({ code, className }) =>
{
    const lines = useMemo(() =>
    {
        const tokenizer = new TemplateTokenizer();
        const result = tokenizer.tokenize(code);
        console.log('[SyntaxHighlighter] Tokenized lines:', result.length);
        if (result.length > 0 && result.length < 5)
        {
            console.log('[SyntaxHighlighter] Sample tokens:', result);
        }
        return result;
    }, [code]);

    return (
        <div className={`syntax-highlighter ${className || ''}`} aria-hidden="true">
            {lines.map((line, lineIndex) => (
                <div key={lineIndex} className="syntax-line">
                    {line.tokens.map((token, tokenIndex) => (
                        <span
                            key={tokenIndex}
                            className={`token token-${token.type}`}
                        >
                            {token.value}
                        </span>
                    ))}
                    {line.text === '' && <br />}
                </div>
            ))}
        </div>
    );
};

export default SyntaxHighlighter;
