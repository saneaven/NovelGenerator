import React, { useState, useEffect, useCallback } from 'react';
import SyntaxHighlightedTextarea from './SyntaxHighlighter/SyntaxHighlightedTextarea';
import { promptService, type ValidationResult } from '../../api/promptService';
import { validateTemplate } from '../../templateEngine/engine';
import { mapFunctionTypeToSchemaType } from '../../templateEngine/validator';
import type { FunctionType, PromptCategory } from '../../types/prompts';
import { useSettingsStore } from '../../store/settingsStore';
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
        // Map functionType to schema type for variable validation
        const schemaType = mapFunctionTypeToSchemaType(functionType, name);

        // Perform validation (with variable checking if schema type is available)
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

            // Invalidate cache so it will reload from backend
            invalidatePromptCache(functionType, category, name);

            // Update original content to mark as saved
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
        // Reload from backend after version restore
        await loadPromptContent();
        setShowVersionHistory(false);
    }, [functionType, category, name]);

    const hasChanges = content !== originalContent;

    if (isLoading)
    {
        return (
            <div className="prompt-editor loading">
                <label>{label}</label>
                {description && <p className="prompt-description">{description}</p>}
                <div className="loading-indicator">Loading prompt...</div>
            </div>
        );
    }

    return (
        <div className="prompt-editor">
            {description && <p className="prompt-description">{description}</p>}
            {/* Syntax highlighted textarea */}
            <SyntaxHighlightedTextarea
                value={content}
                onChange={setContent}
                placeholder="Enter prompt template..."
                minHeight={200}
                maxHeight={600}
            />

            {/* Validation warnings/errors */}
            {validation && (
                <ValidationWarnings
                    errors={validation.errors}
                    warnings={validation.warnings}
                />
            )}

            {/* Action buttons */}
            <div className="editor-actions">
                <div className="editor-left-actions">
                    <button
                        onClick={() => setShowNoteInput(!showNoteInput)}
                        className="btn-secondary"
                        disabled={isSaving || !hasChanges}
                    >
                        {showNoteInput ? 'Hide Note' : 'Add Note'}
                    </button>
                    {showNoteInput && (
                        <input
                            type="text"
                            value={saveNote}
                            onChange={(e) => setSaveNote(e.target.value)}
                            placeholder="Version note (optional)..."
                            className="note-input"
                            maxLength={500}
                        />
                    )}
                </div>

                <div className="editor-right-actions">
                    <span className="char-count">
                        {content.length} characters
                        {hasChanges && <span className="unsaved-indicator"> • Unsaved changes</span>}
                    </span>
                    <button
                        onClick={() => setShowVersionHistory(true)}
                        className="btn-secondary"
                    >
                        Version History
                    </button>
                    <button
                        onClick={handleSave}
                        className="btn-primary"
                        disabled={isSaving || !validation?.valid || !hasChanges}
                    >
                        {isSaving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>

            {/* Version history modal */}
            {showVersionHistory && (
                <VersionHistoryModal
                    functionType={functionType}
                    category={category}
                    name={name}
                    onClose={() => setShowVersionHistory(false)}
                    onRestore={handleRestore}
                />
            )}
        </div>
    );
};

export default PromptEditor;
