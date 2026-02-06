import React from 'react';
import SyntaxHighlightedTextarea from '../SyntaxHighlighter/SyntaxHighlightedTextarea';
import ValidationWarnings from './ValidationWarnings';
import { Loading } from '../../common/Loading';
import './TemplateEditor.css';

interface ValidationResult {
    valid: boolean;
    errors: Array<{ message: string; line?: number; column?: number; severity: string }>;
    warnings: Array<{ message: string; line?: number; column?: number; severity: string }>;
}

export interface TemplateEditorProps {
    content: string;
    onContentChange: (content: string) => void;
    validation: ValidationResult | null;
    isLoading: boolean;
    placeholder?: string;
}

const TemplateEditor: React.FC<TemplateEditorProps> = ({
    content,
    onContentChange,
    validation,
    isLoading,
    placeholder = 'Enter template...',
}) => {
    if (isLoading) {
        return (
            <div className="template-editor template-editor--loading">
                <Loading size="md" text="Loading..." />
            </div>
        );
    }

    const hasValidationErrors = validation && !validation.valid;

    return (
        <section className="template-editor">
            <div className={`template-editor__content ${hasValidationErrors ? 'template-editor__content--has-validation' : ''}`}>
                {/* Validation overlay - only when errors */}
                {hasValidationErrors && (
                    <div className="template-editor__validation-overlay">
                        <ValidationWarnings
                            errors={validation.errors as any}
                            warnings={[]}
                        />
                    </div>
                )}

                {/* Editor */}
                <SyntaxHighlightedTextarea
                    value={content}
                    onChange={onContentChange}
                    placeholder={placeholder}
                />
            </div>
        </section>
    );
};

export default TemplateEditor;
