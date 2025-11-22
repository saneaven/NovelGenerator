import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { PromptNode } from './promptTree';
import { PROMPT_SCHEMAS } from '../../templateEngine/schema';
import type { PromptType } from '../../templateEngine/schema';

import './TemplateSyntaxHint.css';

interface TemplateSyntaxHintProps {
    selectedNode: PromptNode | null;
}

type PlaceholderGroupKey = 'variable' | 'context' | 'state';

const GROUP_LABELS: Record<PlaceholderGroupKey, string> = {
    variable: 'Variables (Settings)',
    context: 'Context Data',
    state: 'State (Logic)',
};

function buildTokenPreview(group: PlaceholderGroupKey, name: string): string {
    return `{{ ${group}.${name} }}`;
}

function buildTooltip(desc: string, example: any): string {
    return `${desc}\nExample: ${JSON.stringify(example)}`;
}

function getSchemaKey(functionType: string): PromptType | null {
    switch (functionType) {
        case 'chat': return 'chat';
        case 'translation': return 'translation';
        case 'storyEdit': return 'storyObjectEdit';
        case 'chapterGen': return 'chapterEdit';
        default: return null;
    }
}

const TemplateSyntaxHint: React.FC<TemplateSyntaxHintProps> = ({ selectedNode }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setIsOpen(false);
    }, [selectedNode?.id]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const handleClick = (event: MouseEvent) => {
            if (!containerRef.current) return;
            if (!containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    useEffect(() => {
        if (!copyFeedback) return;
        const timeout = window.setTimeout(() => setCopyFeedback(null), 2000);
        return () => window.clearTimeout(timeout);
    }, [copyFeedback]);

    const schema = useMemo(() => {
        if (!selectedNode || selectedNode.type !== 'prompt') return null;
        const key = getSchemaKey(selectedNode.functionType || '');
        return key ? PROMPT_SCHEMAS[key] : null;
    }, [selectedNode]);

    const hasPromptSelection = Boolean(selectedNode && selectedNode.type === 'prompt');

    if (!hasPromptSelection) {
        return null;
    }

    const toggleOpen = () => {
        setIsOpen((prev) => !prev);
    };

    const handleCopy = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopyFeedback(`Copied ${value}`);
        } catch (err) {
            console.error('Failed to copy template token', err);
            setCopyFeedback('Copy failed');
        }
    };

    const renderGroup = (group: PlaceholderGroupKey) => {
        if (!schema) return null;
        const entries = (schema as any)[group];
        
        if (!entries) return null;

        const keys = Object.keys(entries);
        
        if (keys.length === 0) {
            return null;
        }

        return (
            <section key={group} className="syntax-section">
                <header className="syntax-section-header">
                    <span className="syntax-section-title">{GROUP_LABELS[group]}</span>
                </header>
                <div className="syntax-token-grid">
                    {keys.map((key) => {
                        const entry = entries[key];
                        const preview = buildTokenPreview(group, key);
                        const tooltip = buildTooltip(entry.desc, entry.example);

                        return (
                            <button
                                key={key}
                                type="button"
                                className="syntax-token-chip optional"
                                onClick={() => handleCopy(preview)}
                                title={tooltip}
                            >
                                <span className="syntax-token-text">{preview}</span>
                            </button>
                        );
                    })}
                </div>
            </section>
        );
    };

    let content: React.ReactNode = null;

    if (!schema) {
        content = <div className="syntax-empty">No variables available for this prompt type.</div>;
    } else {
        const groups = (['variable', 'context', 'state'] as PlaceholderGroupKey[])
            .map((group) => renderGroup(group))
            .filter(Boolean);

        content = groups.length > 0 ? (
            groups
        ) : (
            <div className="syntax-empty">No variables available.</div>
        );
    }

    return (
        <div className="template-syntax-hint" ref={containerRef}>
            <button
                type="button"
                className="syntax-trigger-btn"
                aria-label="View template syntax tokens"
                onClick={toggleOpen}
            >
                <span className="syntax-trigger-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                        <path
                            fill="currentColor"
                            d="M9.25 6.5c0-.69-.56-1.25-1.25-1.25H5.5C4.12 5.25 3 6.37 3 7.75v8.5C3 17.63 4.12 18.75 5.5 18.75h2.5c.69 0 1.25-.56 1.25-1.25s-.56-1.25-1.25-1.25H5.75a.5.5 0 0 1-.5-.5v-8.5a.5.5 0 0 1 .5-.5H8c.69 0 1.25-.56 1.25-1.25Zm11 0c0-1.38-1.12-2.5-2.5-2.5h-2.5c-.69 0-1.25.56-1.25 1.25S14.56 6.5 15.25 6.5h2.25a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-.5.5H15c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25h2.5c1.38 0 2.5-1.12 2.5-2.5v-8.5Z"
                        />
                        <path
                            fill="currentColor"
                            d="M14.5 8.25c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25h2.5c.69 0 1.25-.56 1.25-1.25Zm0 7.5c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25h2.5c.69 0 1.25-.56 1.25-1.25Z"
                        />
                    </svg>
                </span>
            </button>

            {isOpen && (
                <div className="syntax-popover" role="dialog" aria-label="LiquidJS syntax tokens">
                    <header className="syntax-popover-header">
                        <h4>LiquidJS Syntax</h4>
                        <button
                            type="button"
                            className="syntax-popover-close"
                            aria-label="Close syntax panel"
                            onClick={() => setIsOpen(false)}
                        >
                            X
                        </button>
                    </header>
                    <div className="syntax-popover-content">{content}</div>
                    {copyFeedback && <div className="syntax-copy-feedback">{copyFeedback}</div>}
                </div>
            )}
        </div>
    );
};

export default TemplateSyntaxHint;
