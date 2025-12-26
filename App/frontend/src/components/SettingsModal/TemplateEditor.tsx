import React, { useState } from 'react';
import SyntaxHighlightedTextarea from './SyntaxHighlighter/SyntaxHighlightedTextarea';
import { TextButton } from '../TextButton';
import ValidationWarnings from './ValidationWarnings';
import VersionHistoryModal from '../VersionHistoryModal';
import { Trash, Clock, Save } from '../icons';
import { IconButton } from '../IconButton';
import './TemplateEditor.css';

interface ValidationResult {
    valid: boolean;
    errors: Array<{ message: string; line?: number; column?: number; severity: string }>;
    warnings: Array<{ message: string; line?: number; column?: number; severity: string }>;
}

interface VersionHistoryProps {
    title: string;
    loadVersions: () => Promise<any[]>;
    restoreVersion: (versionNumber: number) => Promise<void>;
}

export interface TemplateEditorProps {
    mode: 'prompt' | 'fragment';

    // Common props
    content: string;
    onContentChange: (content: string) => void;
    validation: ValidationResult | null;
    isLoading: boolean;
    isSaving: boolean;
    hasChanges: boolean;
    onSave: (note?: string) => Promise<void>;

    // Version history
    versionHistoryProps: VersionHistoryProps;
    onRestoreVersion: () => void;

    // Fragment-specific (optional)
    fragmentDescription?: string;
    onDescriptionChange?: (desc: string) => void;
    onDelete?: () => void;
    isDeleting?: boolean;
}

const TemplateEditor: React.FC<TemplateEditorProps> = ({
    mode,
    content,
    onContentChange,
    validation,
    isLoading,
    isSaving,
    hasChanges,
    onSave,
    versionHistoryProps,
    onRestoreVersion,
    fragmentDescription,
    onDescriptionChange,
    onDelete,
    isDeleting = false,
}) => {
    const [showVersionHistory, setShowVersionHistory] = useState(false);
    const [saveNote, setSaveNote] = useState('');
    const [showNoteInput, setShowNoteInput] = useState(false);

    const handleSave = async () => {
        if (!validation?.valid) {
            alert('Cannot save: template contains syntax errors');
            return;
        }
        await onSave(saveNote || undefined);
        setSaveNote('');
        setShowNoteInput(false);
    };

    const handleRestoreComplete = () => {
        onRestoreVersion();
        setShowVersionHistory(false);
    };

    if (isLoading) {
        return (
            <div className="template-editor template-editor--loading">
                <div className="loading-indicator">
                    Loading {mode === 'prompt' ? 'prompt' : 'fragment'}...
                </div>
            </div>
        );
    }

    return (
        <section className="template-editor">
            {/* Description Field (Fragment only) */}
            {mode === 'fragment' && onDescriptionChange && (
                <div className="template-editor__field-group">
                    <label className="template-editor__label" htmlFor="template-description">
                        Description
                    </label>
                    <input
                        id="template-description"
                        className="template-editor__input"
                        type="text"
                        value={fragmentDescription || ''}
                        onChange={(e) => onDescriptionChange(e.target.value)}
                        placeholder="Optional description..."
                        maxLength={500}
                    />
                </div>
            )}

            {/* Content Area */}
            <div className="template-editor__content">
                <SyntaxHighlightedTextarea
                    value={content}
                    onChange={onContentChange}
                    placeholder={`Enter ${mode} template...`}
                />
            </div>

            {/* Validation */}
            {validation && (
                <div className="template-editor__validation">
                    <ValidationWarnings
                        errors={validation.errors}
                        warnings={validation.warnings}
                    />
                </div>
            )}

            {/* Actions Footer */}
            <footer className="template-editor__footer">
                <div className="template-editor__actions-left">
                    <TextButton
                        variant="secondary"
                        size="sm"
                        onClick={() => setShowNoteInput(!showNoteInput)}
                        disabled={isSaving || !hasChanges}
                    >
                        {showNoteInput ? 'Hide Note' : 'Add Note'}
                    </TextButton>
                    {showNoteInput && (
                        <input
                            type="text"
                            value={saveNote}
                            onChange={(e) => setSaveNote(e.target.value)}
                            placeholder="Version note (optional)..."
                            className="template-editor__note-input"
                            maxLength={500}
                        />
                    )}
                </div>

                <div className="template-editor__actions-right">
                    <span className="template-editor__meta">
                        {content.length} chars
                        {hasChanges && (
                            <span className="template-editor__unsaved-indicator">
                                {' '}• Unsaved changes
                            </span>
                        )}
                    </span>

                    <TextButton
                        variant="secondary"
                        size="sm"
                        onClick={() => setShowVersionHistory(true)}
                        disabled={isSaving || isDeleting}
                        iconLeft={<Clock size="sm" />}
                    >
                        History
                    </TextButton>

                    {/* Delete button (Fragment only) */}
                    {mode === 'fragment' && onDelete && (
                        <TextButton
                            variant="danger"
                            size="sm"
                            onClick={onDelete}
                            disabled={isDeleting || isSaving}
                            loading={isDeleting}
                            iconLeft={<Trash size="sm" />}
                        >
                            Delete
                        </TextButton>
                    )}

                    <TextButton
                        variant="primary"
                        size="sm"
                        onClick={handleSave}
                        disabled={isSaving || !validation?.valid || !hasChanges}
                        loading={isSaving}
                    >
                        Save
                    </TextButton>
                </div>
            </footer>

            {/* Floating Save Button (Mobile only) */}
            <IconButton
                icon={isSaving ? <span className="template-editor__fab-spinner" /> : <Save size="md" />}
                onClick={handleSave}
                disabled={isSaving || !validation?.valid || !hasChanges}
                className={`template-editor__fab ${hasChanges ? 'template-editor__fab--active' : ''}`}
                title="Save"
                size="md"
            />

            {showVersionHistory && (
                <VersionHistoryModal
                    isOpen={showVersionHistory}
                    onClose={() => setShowVersionHistory(false)}
                    onRestoreVersion={handleRestoreComplete}
                    textVersionProps={versionHistoryProps}
                />
            )}
        </section>
    );
};

export default TemplateEditor;
