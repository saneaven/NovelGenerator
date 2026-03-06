import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { PromptNode } from './promptTree';
import { UNIFIED_SCHEMA, PROMPT_TYPE_VARIABLES, type PromptType } from '../../../templateEngine/schema';
import { IconButton } from '../../IconButton';
import { Info, Close } from '../../icons';
import './TemplateSyntaxHint.css';

interface TemplateSyntaxHintProps {
    selectedNode: PromptNode | null;
}

// Variable groups and their labels
const GROUP_LABELS: Record<string, string> = {
    config: 'Config (Settings)',
    project: 'Project Data',
    input: 'Input',
    agent: 'Agent Mode',
    memory: 'Runtime Memory',
    memorySummary: 'Memory Summary',
    editAssistant: 'Edit Assistant',
    translation: 'Translation',
    imagePrompt: 'Image Prompt',
};

// Jinja2 syntax documentation
const JINJA_SYNTAX = {
    'Fragment Inclusion': [
        { name: 'include', syntax: '{% include "fragment:folder/name" %}', desc: 'Include a fragment by canonical fragment address' },
        { name: 'with + include', syntax: '{% with ids = value %}{% include "fragment:folder/name" %}{% endwith %}', desc: 'Bind local variables before including a fragment' },
    ],
    'Filters': [
        { name: 'filter_by_type', syntax: '{% for item in arr|filter_by_type("type") %}', desc: 'Filter objects by type field' },
        { name: 'filter_by_ids', syntax: '{% for item in arr|filter_by_ids(ids) %}', desc: 'Filter array by ID list' },
        { name: 'get_by_id', syntax: '{% set item = arr|get_by_id(id) %}', desc: 'Get single object by ID' },
        { name: 'get_manuscript', syntax: '{% set ms = manuscripts|get_manuscript(chapterId) %}', desc: 'Get manuscript by chapter ID' },
        { name: 'length', syntax: '{{ arr|length }}', desc: 'Count array items' },
        { name: 'tojson', syntax: '{{ obj|tojson }}', desc: 'Output as JSON string' },
    ],
    'Global Functions': [
        { name: 'get_objects_of_language', syntax: '{% for obj in get_objects_of_language(project, lang) %}', desc: 'Get objects for a specific language' },
        { name: 'get_manuscripts_of_language', syntax: '{% for ms in get_manuscripts_of_language(project, lang) %}', desc: 'Get manuscripts for a specific language' },
    ],
    'Control Flow': [
        { name: 'if / endif', syntax: '{% if condition %}...{% endif %}', desc: 'Conditional block' },
        { name: 'for / endfor', syntax: '{% for item in items %}...{% endfor %}', desc: 'Loop over items' },
        { name: 'with / endwith', syntax: '{% with value = data %}...{% endwith %}', desc: 'Bind local variables in a scoped block' },
        { name: 'set', syntax: '{% set var = value %}', desc: 'Set a local variable' },
        { name: 'comment', syntax: '{# This is a comment #}', desc: 'Template comment (not rendered)' },
    ],
    'Operators': [
        { name: '==', syntax: '{% if a == b %}', desc: 'Equal comparison' },
        { name: '!=', syntax: '{% if a != b %}', desc: 'Not equal comparison' },
        { name: 'and', syntax: '{% if a and b %}', desc: 'Logical AND' },
        { name: 'or', syntax: '{% if a or b %}', desc: 'Logical OR' },
        { name: 'not', syntax: '{% if not a %}', desc: 'Logical NOT' },
    ],
};

function buildTokenPreview(group: string, name: string): string {
    return `{{ ${group}.${name} }}`;
}

function buildTooltip(desc: string, example: any): string {
    const exampleStr = typeof example === 'object' ? JSON.stringify(example, null, 2) : String(example);
    return `${desc}\nExample: ${exampleStr}`;
}

function getSchemaKey(taskType: string, taskSubtype?: string): PromptType | null {
    switch (taskType) {
        case 'agent': return 'agent';
        case 'memory': return 'memory';
        case 'translation': return 'translation';
        case 'editAssistant': return 'editAssistant';
        case 'imagePrompt':
            if (taskSubtype === 'object') return 'objectImagePrompt';
            if (taskSubtype === 'scene') return 'sceneImagePrompt';
            return null;
        default: return null;
    }
}

const TemplateSyntaxHint: React.FC<TemplateSyntaxHintProps> = ({ selectedNode }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'variables' | 'helpers'>('variables');
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

    const availableGroups = useMemo(() => {
        if (!selectedNode || (selectedNode.type !== 'prompt' && selectedNode.type !== 'promptView')) {
            return [];
        }
        const key = getSchemaKey(selectedNode.taskType || '', selectedNode.taskSubtype);
        return key ? PROMPT_TYPE_VARIABLES[key] : [];
    }, [selectedNode]);

    const hasPromptSelection = Boolean(selectedNode && (selectedNode.type === 'prompt' || selectedNode.type === 'promptView'));

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

    const renderVariableGroup = (group: string) => {
        const groupSchema = UNIFIED_SCHEMA[group as keyof typeof UNIFIED_SCHEMA];
        if (!groupSchema) return null;

        const keys = Object.keys(groupSchema);
        if (keys.length === 0) return null;

        return (
            <section key={group} className="syntax-section">
                <header className="syntax-section-header">
                    <span className="syntax-section-title">{GROUP_LABELS[group] || group}</span>
                </header>
                <div className="syntax-token-grid">
                    {keys.map((key) => {
                        const entry = (groupSchema as Record<string, { desc: string; example: any }>)[key];
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

    const renderHelpersSection = () => {
        return (
            <>
                {Object.entries(JINJA_SYNTAX).map(([category, helpers]) => (
                    <section key={category} className="syntax-section">
                        <header className="syntax-section-header">
                            <span className="syntax-section-title">{category}</span>
                        </header>
                        <div className="syntax-token-grid">
                            {helpers.map((helper) => (
                                <button
                                    key={helper.name}
                                    type="button"
                                    className="syntax-token-chip helper"
                                    onClick={() => handleCopy(helper.syntax)}
                                    title={`${helper.desc}\nSyntax: ${helper.syntax}`}
                                >
                                    <span className="syntax-token-text">{helper.name}</span>
                                </button>
                            ))}
                        </div>
                    </section>
                ))}
            </>
        );
    };

    let variablesContent: React.ReactNode = null;

    if (availableGroups.length === 0) {
        variablesContent = <div className="syntax-empty">No variables available for this prompt type.</div>;
    } else {
        const groups = availableGroups
            .map((group) => renderVariableGroup(group))
            .filter(Boolean);

        variablesContent = groups.length > 0 ? (
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
                <div className="syntax-popover" role="dialog" aria-label="Jinja2 syntax tokens">
                    <header className="syntax-popover-header">
                        <h4>Template Syntax</h4>
                        <IconButton
                            icon={<Close size="sm" />}
                            onClick={() => setIsOpen(false)}
                            title="Close syntax panel"
                            size="xs"
                            variant="ghost"
                        />
                    </header>
                    <div className="syntax-tabs">
                        <button
                            type="button"
                            className={`syntax-tab ${activeTab === 'variables' ? 'active' : ''}`}
                            onClick={() => setActiveTab('variables')}
                        >
                            Variables
                        </button>
                        <button
                            type="button"
                            className={`syntax-tab ${activeTab === 'helpers' ? 'active' : ''}`}
                            onClick={() => setActiveTab('helpers')}
                        >
                            Syntax Guide
                        </button>
                    </div>
                    <div className="syntax-popover-content">
                        {activeTab === 'variables' ? variablesContent : renderHelpersSection()}
                    </div>
                    {copyFeedback && <div className="syntax-copy-feedback">{copyFeedback}</div>}
                </div>
            )}
        </div>
    );
};

export default TemplateSyntaxHint;
