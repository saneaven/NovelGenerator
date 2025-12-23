import React, { useState, useEffect, useCallback } from 'react';
import SyntaxHighlightedTextarea from './SyntaxHighlighter/SyntaxHighlightedTextarea';
import { promptService, type ValidationResult } from '../../api/promptService';
import { validateTemplate } from '../../templateEngine/engine';
import { mapFunctionTypeToSchemaType } from '../../templateEngine/validator';
import type { FunctionType, PromptCategory } from '../../types/prompts';
import { useSettingsStore } from '../../store/settingsStore';
import { TextButton } from '../TextButton';
import ValidationWarnings from './ValidationWarnings';
import VersionHistoryModal from './VersionHistoryModal';
import './PromptEditor.css';

interface PromptEditorProps
{
    functionType: FunctionType;
    category: PromptCategory;
    name?: string;
    label: string;
    description?: string;
}

const PromptEditor: React.FC<PromptEditorProps> = ({
    functionType,
    category,
    name,
    label,
    description,
}) =>
{
    const [content, setContent] = useState('');
    const [originalContent, setOriginalContent] = useState('');
    const [validation, setValidation] = useState<ValidationResult | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [showVersionHistory, setShowVersionHistory] = useState(false);
    const [saveNote, setSaveNote] = useState('');
    const [showNoteInput, setShowNoteInput] = useState(false);

    const { loadPrompt, invalidatePromptCache } = useSettingsStore();

    // Load prompt on mount
    useEffect(() =>
    {
        loadPromptContent();
    }, [functionType, category, name]);

    const loadPromptContent = async () =>
    {
        setIsLoading(true);
        try
        {
            const promptContent = await loadPrompt(functionType, category, name);
            setContent(promptContent);
            setOriginalContent(promptContent);
        } catch (error)
        {
            console.error('Failed to load prompt:', error);
        } finally
        {
            setIsLoading(false);
        }
    };

    // Debounced validation
    useEffect(() =>
    {
        const timer = setTimeout(() =>
        {
            validateContent(content);
        }, 500);

        return () => clearTimeout(timer);
    }, [content, functionType, category, name]);

    const validateContent = async (text: string) =>
    {
        const schemaType = mapFunctionTypeToSchemaType(functionType, name);
        const result = await validateTemplate(text, schemaType || undefined);

        if (result.isValid) {
            setValidation({
                valid: true,
                errors: [],
                warnings: result.warnings?.map(w => ({
                    message: w.message,
                    line: w.line,
                    column: w.column,
                    severity: w.severity
                })) || []
            });
        } else {
            setValidation({
                valid: false,
                errors: [{
                    message: result.error || 'Unknown syntax error',
                    severity: 'error'
                }],
                warnings: result.warnings?.map(w => ({
                    message: w.message,
                    line: w.line,
                    column: w.column,
                    severity: w.severity
                })) || []
            });
        }
    };

    const handleSave = async () =>
    {
        if (!validation?.valid)
        {
            alert('Cannot save: template contains syntax errors');
            return;
        }

        setIsSaving(true);
        try
        {
            await promptService.savePrompt(
                functionType,
                category,
                content,
                saveNote || undefined,
                name
            );

            invalidatePromptCache(functionType, category, name);
            setOriginalContent(content);
            setSaveNote('');
            setShowNoteInput(false);
            alert('Prompt saved successfully!');
        } catch (error)
        {
            console.error('Failed to save prompt:', error);
            alert('Failed to save prompt. Please try again.');
        } finally
        {
            setIsSaving(false);
        }
    };

    const handleRestore = useCallback(async () =>
    {
        await loadPromptContent();
        setShowVersionHistory(false);
    }, [functionType, category, name]);

    const hasChanges = content !== originalContent;

    if (isLoading)
    {
        return (
            <div className="prompt-editor prompt-editor--loading">
                 <div className="loading-indicator">Loading prompt...</div>
            </div>
        );
    }

    return (
        <section className="prompt-editor">
            <div className="prompt-editor__content">
                <SyntaxHighlightedTextarea
                    value={content}
                    onChange={setContent}
                    placeholder="Enter prompt template..."
                />
            </div>

            {validation && (
                <div className="prompt-editor__validation">
                    <ValidationWarnings
                        errors={validation.errors}
                        warnings={validation.warnings}
                    />
                </div>
            )}

            <footer className="prompt-editor__footer">
                <div className="prompt-editor__actions-left">
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
                            className="prompt-editor__note-input"
                            maxLength={500}
                        />
                    )}
                </div>

                <div className="prompt-editor__actions-right">
                    <span className="prompt-editor__meta">
                        {content.length} chars
                        {hasChanges && <span className="prompt-editor__unsaved-indicator"> • Unsaved changes</span>}
                    </span>
                    <TextButton
                        variant="secondary"
                        size="sm"
                        onClick={() => setShowVersionHistory(true)}
                    >
                        Version History
                    </TextButton>
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

            {showVersionHistory && (
                <VersionHistoryModal
                    functionType={functionType}
                    category={category}
                    name={name}
                    onClose={() => setShowVersionHistory(false)}
                    onRestore={handleRestore}
                />
            )}
        </section>
    );
};

export default PromptEditor;