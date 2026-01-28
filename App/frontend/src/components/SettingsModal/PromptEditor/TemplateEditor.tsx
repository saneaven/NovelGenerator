import React from 'react';
import { useTranslation } from 'react-i18next';
import SyntaxHighlightedTextarea from '../SyntaxHighlighter/SyntaxHighlightedTextarea';
import ValidationWarnings from './ValidationWarnings';
import { Save } from '../../icons';
import { Loading } from '../../common/Loading';
import { useSettingsToast } from '../SettingsToastContext';
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
    const { t } = useTranslation();
    const toast = useSettingsToast();

    const handleSave = async () => {
        if (!validation?.valid) {
            toast.error(t('settings.promptEditor.toast.templateSyntaxError'));
            return;
        }
        await onSave();
    };

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

                {/* Save FAB - hidden when syntax errors */}
                {validation?.valid && (
                    <button
                        className={`template-editor__save-fab ${hasChanges ? 'template-editor__save-fab--active' : ''}`}
                        onClick={handleSave}
                        disabled={isSaving || !hasChanges}
                        title="Save"
                    >
                        {isSaving ? (
                            <Loading size="xs" />
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
