import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { PromptNode } from './promptTree';
import { PROMPT_SCHEMAS } from '../../templateEngine/schema';
import type { PromptType } from '../../templateEngine/schema';
import { IconButton } from '../IconButton';
import { Info, Close } from '../icons';
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

function getSchemaKey(functionType: string, name?: string): PromptType | null {
    switch (functionType) {
        case 'chat': return 'chat';
        case 'translation': return 'translation';
        case 'storyEdit': return 'storyObjectEdit';
        case 'chapterGen': return 'chapterEdit';
        case 'imagePrompt':
            if (name === 'object') return 'objectImagePrompt';
            if (name === 'scene') return 'sceneImagePrompt';
            return null;
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
        const key = getSchemaKey(selectedNode.functionType || '', selectedNode.name);
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
            <IconButton
                icon={<Info size="lg" />}
                onClick={toggleOpen}
                title="View template syntax tokens"
                size="sm"
            />

            {isOpen && (
                <div className="syntax-popover" role="dialog" aria-label="LiquidJS syntax tokens">
                    <header className="syntax-popover-header">
                        <h4>LiquidJS Syntax</h4>
                        <IconButton
                            icon={<Close size="sm" />}
                            onClick={() => setIsOpen(false)}
                            title="Close syntax panel"
                            size="xs"
                        />
                    </header>
                    <div className="syntax-popover-content">{content}</div>
                    {copyFeedback && <div className="syntax-copy-feedback">{copyFeedback}</div>}
                </div>
            )}
        </div>
    );
};

export default TemplateSyntaxHint;
