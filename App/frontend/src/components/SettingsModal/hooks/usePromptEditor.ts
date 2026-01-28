import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { promptService, type ValidationResult } from '../../../api/promptService';
import { validateTemplate } from '../../../templateEngine/engine';
import { mapTaskTypeToSchemaType } from '../../../templateEngine/validator';
import type { TaskType, PromptCategory } from '../../../types/prompts';
import { useSettingsStore } from '../../../store/settingsStore';
import { usePresetStore } from '../../../store/presetStore';
import { useSettingsToast } from '../SettingsToastContext';

interface UsePromptEditorResult {
    content: string;
    setContent: (content: string) => void;
    validation: ValidationResult | null;
    isLoading: boolean;
    isSaving: boolean;
    hasChanges: boolean;
    onSave: () => Promise<void>;
    reload: () => Promise<void>;
    versionHistoryProps: {
        title: string;
        loadVersions: () => Promise<any[]>;
        restoreVersion: (versionNumber: number) => Promise<void>;
    };
}

export function usePromptEditor(
    taskType: TaskType,
    category: PromptCategory,
    name: string
): UsePromptEditorResult {
    const { t } = useTranslation();
    const toast = useSettingsToast();
    const [content, setContent] = useState('');
    const [originalContent, setOriginalContent] = useState('');
    const [validation, setValidation] = useState<ValidationResult | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const { loadPrompt, invalidatePromptCache } = useSettingsStore();
    const activePresetId = usePresetStore((state) => state.activePresetId);

    // Load prompt on mount or when props/preset change
    const loadPromptContent = useCallback(async () => {
        setIsLoading(true);
        try {
            const promptContent = await loadPrompt(taskType, category, name);
            setContent(promptContent);
            setOriginalContent(promptContent);
        } catch (error) {
            console.error('Failed to load prompt:', error);
        } finally {
            setIsLoading(false);
        }
    }, [taskType, category, name, loadPrompt, activePresetId]);

    useEffect(() => {
        loadPromptContent();
    }, [loadPromptContent]);

    // Debounced validation
    useEffect(() => {
        const timer = setTimeout(() => {
            validateContent(content);
        }, 500);
        return () => clearTimeout(timer);
    }, [content, taskType, category, name]);

    const validateContent = async (text: string) => {
        const schemaType = mapTaskTypeToSchemaType(taskType, name);
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

    const handleSave = async () => {
        if (!validation?.valid) {
            toast.error(t('settings.promptEditor.toast.templateSyntaxError'));
            return;
        }

        setIsSaving(true);
        try {
            await promptService.savePrompt(
                taskType,
                category,
                content,
                name
            );
            invalidatePromptCache(taskType, category, name);
            setOriginalContent(content);
            toast.success(t('settings.promptEditor.toast.promptSaved'));
        } catch (error) {
            console.error('Failed to save prompt:', error);
            toast.error(t('settings.promptEditor.toast.promptSaveFailed'));
        } finally {
            setIsSaving(false);
        }
    };

    const hasChanges = content !== originalContent;

    const versionHistoryProps = {
        title: "Prompt Version History",
        loadVersions: () => promptService.getVersionHistory(taskType, category, name),
        restoreVersion: async (vn: number) => {
            await promptService.restoreVersion(taskType, category, vn, name);
            await loadPromptContent();  // Reload to get the new version
        },
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
