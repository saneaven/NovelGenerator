import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { TemplatePlaceholderInfo, TemplateSyntaxInfo } from '../../api/promptService';
import type { PromptNode } from './promptTree';
import { usePromptSyntaxMetadata } from './usePromptSyntaxMetadata';

import './TemplateSyntaxHint.css';

interface TemplateSyntaxHintProps {
    selectedNode: PromptNode | null;
}

type PlaceholderGroupKey = 'variables' | 'contexts' | 'conditionals';

const GROUP_LABELS: Record<PlaceholderGroupKey, string> = {
    variables: 'Variables',
    contexts: 'Contexts',
    conditionals: 'Conditionals',
};

function buildTokenPreview(group: PlaceholderGroupKey, name: string): string {
    if (group === 'variables') return `{{var::${name}}}`;
    if (group === 'contexts') return `{{context::${name}}}`;
    return `{{#if::${name}}}`;
}

function buildCopyValue(group: PlaceholderGroupKey, name: string): string {
    if (group === 'conditionals') {
        return `{{#if::${name}}}`;
    }
    return buildTokenPreview(group, name);
}

function buildTooltip(entry: TemplatePlaceholderInfo): string | undefined {
    const parts: string[] = [];
    if (entry.description) {
        parts.push(entry.description.trim());
    }
    if (entry.source) {
        parts.push(`Source: ${entry.source}`);
    }
    if (parts.length === 0) {
        return undefined;
    }
    return parts.join('\n');
}

function findMatchingTemplate(
    metadata: TemplateSyntaxInfo[] | undefined,
    node: PromptNode | null
): TemplateSyntaxInfo | null {
    if (!metadata || !node || node.type !== 'prompt') {
        return null;
    }

    return (
        metadata.find((entry) => {
            if (entry.function_type !== node.functionType) return false;
            if (entry.category !== node.category) return false;

            const variant = entry.variant ?? null;
            const nodeName = node.name ?? null;
            return variant === nodeName;
        }) ??
        metadata.find((entry) => entry.function_type === node.functionType && entry.category === node.category) ??
        null
    );
}

const TemplateSyntaxHint: React.FC<TemplateSyntaxHintProps> = ({ selectedNode }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { data, loading, error, refresh } = usePromptSyntaxMetadata();

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

    const templateInfo = useMemo(
        () => findMatchingTemplate(data?.templates, selectedNode),
        [data, selectedNode]
    );

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
        const entries = templateInfo?.placeholders[group] ?? [];
        if (entries.length === 0) {
            return null;
        }

        const requiredCount = entries.filter((entry) => entry.required).length;
        const optionalCount = entries.length - requiredCount;

        return (
            <section key={group} className="syntax-section">
                <header className="syntax-section-header">
                    <span className="syntax-section-title">{GROUP_LABELS[group]}</span>
                    <span className="syntax-section-meta">
                        {requiredCount} required / {optionalCount} optional
                    </span>
                </header>
                <div className="syntax-token-grid">
                    {entries.map((entry) => {
                        const preview = buildTokenPreview(group, entry.name);
                        const copyValue = buildCopyValue(group, entry.name);
                        const tooltip = buildTooltip(entry);
                        const badge = entry.required ? 'Required' : 'Optional';

                        return (
                            <button
                                key={entry.name}
                                type="button"
                                className={`syntax-token-chip ${entry.required ? 'required' : 'optional'}`}
                                onClick={() => handleCopy(copyValue)}
                                title={tooltip}
                            >
                                <span className="syntax-token-text">{preview}</span>
                                <span className="syntax-token-badge">{badge}</span>
                                {entry.supports_negation ? (
                                    <span className="syntax-token-negation">! allowed</span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
            </section>
        );
    };

    let content: React.ReactNode = null;

    if (loading && !data) {
        content = <div className="syntax-empty">Loading double bracket syntax...</div>;
    } else if (error) {
        content = (
            <div className="syntax-empty syntax-error">
                <p>Failed to load syntax metadata.</p>
                <button type="button" onClick={() => void refresh()} className="syntax-retry-button">
                    Retry
                </button>
            </div>
        );
    } else if (!templateInfo) {
        content = <div className="syntax-empty">This prompt does not use template tokens.</div>;
    } else {
        const groups = (['variables', 'contexts', 'conditionals'] as PlaceholderGroupKey[])
            .map((group) => renderGroup(group))
            .filter(Boolean);

        content = groups.length > 0 ? (
            groups
        ) : (
            <div className="syntax-empty">This prompt does not use template tokens.</div>
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
                <div className="syntax-popover" role="dialog" aria-label="Double bracket syntax tokens">
                    <header className="syntax-popover-header">
                        <h4>Double Bracket Syntax</h4>
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
