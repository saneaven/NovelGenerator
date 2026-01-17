import React from 'react';
import SyntaxHighlightedTextarea from './SyntaxHighlighter/SyntaxHighlightedTextarea';
import ValidationWarnings from './ValidationWarnings';
import { Save } from '../icons';
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
    isSaving: boolean;
    hasChanges: boolean;
    onSave: () => Promise<void>;
    placeholder?: string;
}

const TemplateEditor: React.FC<TemplateEditorProps> = ({
    content,
    onContentChange,
    validation,
    isLoading,
    isSaving,
    hasChanges,
    onSave,
    placeholder = 'Enter template...',
}) => {
    const handleSave = async () => {
        if (!validation?.valid) {
            alert('Cannot save: template contains syntax errors');
            return;
        }
        await onSave();
    };

    if (isLoading) {
        return (
            <div className="template-editor template-editor--loading">
                <div className="loading-indicator">Loading...</div>
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

                {/* Save FAB - hidden when syntax errors */}
                {validation?.valid && (
                    <button
                        className={`template-editor__save-fab ${hasChanges ? 'template-editor__save-fab--active' : ''}`}
                        onClick={handleSave}
                        disabled={isSaving || !hasChanges}
                        title="Save"
                    >
                        {isSaving ? (
                            <span className="template-editor__fab-spinner" />
                        ) : (
                            <Save size="md" />
                        )}
                    </button>
                )}
            </div>
        </section>
    );
};

export default TemplateEditor;
