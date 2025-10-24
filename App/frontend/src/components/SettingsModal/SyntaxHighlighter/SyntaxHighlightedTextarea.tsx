import React, { useRef, useEffect, useState, useCallback } from 'react';
import SyntaxHighlighter from './SyntaxHighlighter';
import './SyntaxHighlightedTextarea.css';

interface SyntaxHighlightedTextareaProps
{
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    minHeight?: number;
    maxHeight?: number;
}

/**
 * Textarea with syntax highlighting overlay
 */
const SyntaxHighlightedTextarea: React.FC<SyntaxHighlightedTextareaProps> = ({
    value,
    onChange,
    placeholder = '',
    minHeight = 200,
    maxHeight = 600
}) =>
{
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const highlighterRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Sync scroll between textarea and highlighter
    const handleScroll = useCallback(() =>
    {
        if (textareaRef.current && highlighterRef.current)
        {
            highlighterRef.current.scrollTop = textareaRef.current.scrollTop;
            highlighterRef.current.scrollLeft = textareaRef.current.scrollLeft;
        }
    }, []);

    // Handle textarea change
    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) =>
    {
        onChange(e.target.value);
    }, [onChange]);

    // Handle Tab key for indentation
    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) =>
    {
        if (e.key === 'Tab')
        {
            e.preventDefault();
            const textarea = textareaRef.current;
            if (!textarea) return;

            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;

            // Insert tab character
            const newValue = value.substring(0, start) + '  ' + value.substring(end);
            onChange(newValue);

            // Restore cursor position
            setTimeout(() =>
            {
                textarea.selectionStart = textarea.selectionEnd = start + 2;
            }, 0);
        }
    }, [value, onChange]);

    // Auto-resize textarea based on content
    useEffect(() =>
    {
        const textarea = textareaRef.current;
        if (!textarea) return;

        // Reset height to recalculate
        textarea.style.height = 'auto';

        // Set new height based on content
        const scrollHeight = textarea.scrollHeight;
        const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
        textarea.style.height = `${newHeight}px`;
    }, [value, minHeight, maxHeight]);

    return (
        <div className="syntax-highlighted-textarea-container" ref={containerRef}>
            {/* Syntax highlighter overlay */}
            <div
                className="syntax-highlighter-wrapper"
                ref={highlighterRef}
            >
                <SyntaxHighlighter code={value} />
            </div>

            {/* Textarea */}
            <textarea
                ref={textareaRef}
                className="syntax-textarea"
                value={value}
                onChange={handleChange}
                onScroll={handleScroll}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
            />
        </div>
    );
};

export default SyntaxHighlightedTextarea;
