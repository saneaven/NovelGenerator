import { useState, useEffect, useCallback } from 'react';
import { promptService, type ValidationResult } from '../../../api/promptService';
import { validateTemplate } from '../../../templateEngine/engine';
import { mapFunctionTypeToSchemaType } from '../../../templateEngine/validator';
import type { FunctionType, PromptCategory } from '../../../types/prompts';
import { useSettingsStore } from '../../../store/settingsStore';

interface UsePromptEditorResult {
    content: string;
    setContent: (content: string) => void;
    validation: ValidationResult | null;
    isLoading: boolean;
    isSaving: boolean;
    hasChanges: boolean;
    onSave: (note?: string) => Promise<void>;
    reload: () => Promise<void>;
    versionHistoryProps: {
        title: string;
        loadVersions: () => Promise<any[]>;
        restoreVersion: (versionNumber: number) => Promise<void>;
    };
}

export function usePromptEditor(
    functionType: FunctionType,
    category: PromptCategory,
    name?: string
): UsePromptEditorResult {
    const [content, setContent] = useState('');
    const [originalContent, setOriginalContent] = useState('');
    const [validation, setValidation] = useState<ValidationResult | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const { loadPrompt, invalidatePromptCache } = useSettingsStore();

    // Load prompt on mount or when props change
    const loadPromptContent = useCallback(async () => {
        setIsLoading(true);
        try {
            const promptContent = await loadPrompt(functionType, category, name);
            setContent(promptContent);
            setOriginalContent(promptContent);
        } catch (error) {
            console.error('Failed to load prompt:', error);
        } finally {
            setIsLoading(false);
        }
    }, [functionType, category, name, loadPrompt]);

    useEffect(() => {
        loadPromptContent();
    }, [loadPromptContent]);

    // Debounced validation
    useEffect(() => {
        const timer = setTimeout(() => {
            validateContent(content);
        }, 500);
        return () => clearTimeout(timer);
    }, [content, functionType, category, name]);

    const validateContent = async (text: string) => {
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

    const handleSave = async (note?: string) => {
        if (!validation?.valid) {
            throw new Error('Cannot save: template contains syntax errors');
        }

        setIsSaving(true);
        try {
            await promptService.savePrompt(
                functionType,
                category,
                content,
                note,
                name
            );
            invalidatePromptCache(functionType, category, name);
            setOriginalContent(content);
            alert('Prompt saved successfully!');
        } catch (error) {
            console.error('Failed to save prompt:', error);
            alert('Failed to save prompt. Please try again.');
            throw error;
        } finally {
            setIsSaving(false);
        }
    };

    const hasChanges = content !== originalContent;

    const versionHistoryProps = {
        title: "Prompt Version History",
        loadVersions: () => promptService.getVersionHistory(functionType, category, name),
        restoreVersion: (vn: number) => promptService.restoreVersion(functionType, category, vn, name),
    };

    return {
        content,
        setContent,
        validation,
        isLoading,
        isSaving,
        hasChanges,
        onSave: handleSave,
        reload: loadPromptContent,
        versionHistoryProps,
    };
}
