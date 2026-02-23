import React, { useState } from 'react';
import { Warning, ChevronUp } from '../../icons';

export interface ValidationError {
    message: string;
    line?: number;
    column?: number;
    severity?: string;
}

interface ValidationWarningsProps {
    errors: ValidationError[];
    warnings: ValidationError[];
}

interface CollapsibleSectionProps {
    type: 'error' | 'warning';
    title: string;
    items: ValidationError[];
    defaultOpen?: boolean;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
    type,
    title,
    items,
    defaultOpen = true
}) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    if (items.length === 0) return null;

    return (
        <div className={`validation-${type}s`}>
            <button
                type="button"
                className={`validation-header ${type}`}
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
            >
                <span className="icon"><Warning size="sm" /></span>
                <strong>{title} ({items.length})</strong>
                <ChevronUp
                    size="sm"
                    className={`chevron ${isOpen ? 'open' : ''}`}
                />
            </button>
            <div className={`validation-list-wrapper ${isOpen ? 'open' : ''}`}>
                <ul className="validation-list">
                    {items.map((item, idx) => (
                        <li key={idx} className={`validation-item ${type}`}>
                            {item.line && item.column && (
                                <span className="location">
                                    Line {item.line}, Col {item.column}:
                                </span>
                            )}
                            <span className="message">{item.message}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

const ValidationWarnings: React.FC<ValidationWarningsProps> = ({ errors, warnings }) => {
    if (errors.length === 0 && warnings.length === 0) {
        return null;
    }

    return (
        <div className="validation-messages">
            <CollapsibleSection
                type="error"
                title="Syntax Errors"
                items={errors}
                defaultOpen={false}
            />
            <CollapsibleSection
                type="warning"
                title="Warnings"
                items={warnings}
                defaultOpen={false}
            />
        </div>
    );
};

export default ValidationWarnings;
