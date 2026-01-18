import { useState, useEffect, useCallback } from 'react';
import { fragmentService } from '../../../api/fragmentService';
import { validateTemplate, validateFragmentReferences } from '../../../templateEngine/engine';
import { usePresetStore } from '../../../store/presetStore';

interface ValidationResult {
    valid: boolean;
    errors: Array<{ message: string; line?: number; column?: number; severity: string }>;
    warnings: Array<{ message: string; line?: number; column?: number; severity: string }>;
}

interface UseFragmentEditorResult {
    content: string;
    setContent: (content: string) => void;
    description: string;
    setDescription: (description: string) => void;
    validation: ValidationResult | null;
    isLoading: boolean;
    isSaving: boolean;
    isDeleting: boolean;
    hasChanges: boolean;
    isSystemDefault: boolean;
    fullPath: string;
    onSave: () => Promise<void>;
    onDelete: () => Promise<void>;
    reload: () => Promise<void>;
    versionHistoryProps: {
        title: string;
        loadVersions: () => Promise<any[]>;
        restoreVersion: (versionNumber: number) => Promise<void>;
    };
}

export function useFragmentEditor(
    folderPath: string | null,
    fragmentName: string,
    callbacks?: {
        onDeleted?: () => void;
        onSaved?: () => void;
    }
): UseFragmentEditorResult {
    const [content, setContent] = useState('');
    const [originalContent, setOriginalContent] = useState('');
    const [description, setDescription] = useState('');
    const [originalDescription, setOriginalDescription] = useState('');
    const [validation, setValidation] = useState<ValidationResult | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isSystemDefault, setIsSystemDefault] = useState(false);

    const fullPath = folderPath ? `${folderPath}/${fragmentName}` : fragmentName;
    const activePresetId = usePresetStore((state) => state.activePresetId);

    // Load fragment on mount or when props/preset change
    const loadFragmentContent = useCallback(async () => {
        setIsLoading(true);
        try {
            const fragment = await fragmentService.getFragment(folderPath, fragmentName);
            setContent(fragment.content);
            setOriginalContent(fragment.content);
            setDescription(fragment.description || '');
            setOriginalDescription(fragment.description || '');
            setIsSystemDefault(fragment.is_system_default);
        } catch (error) {
            console.error('Failed to load fragment:', error);
        } finally {
            setIsLoading(false);
        }
    }, [folderPath, fragmentName, activePresetId]);

    useEffect(() => {
        loadFragmentContent();
    }, [loadFragmentContent]);

    // Debounced validation
    useEffect(() => {
        const timer = setTimeout(() => {
            validateContent(content);
        }, 500);
        return () => clearTimeout(timer);
    }, [content, fullPath]);

    const validateContent = async (text: string) => {
        const syntaxResult = await validateTemplate(text);
        const refResult = validateFragmentReferences(text, fullPath);

        const warnings: ValidationResult['warnings'] = [];

        if (syntaxResult.warnings) {
            warnings.push(...syntaxResult.warnings.map(w => ({
                message: w.message,
                line: w.line,
                column: w.column,
                severity: w.severity
            })));
        }

        if (refResult.warnings) {
            refResult.warnings.forEach(warning => {
                warnings.push({
                    message: warning,
                    severity: 'warning'
                });
            });
        }

        const errors: ValidationResult['errors'] = [];
        if (refResult.errors) {
            refResult.errors.forEach(error => {
                errors.push({
                    message: error,
                    severity: 'error'
                });
            });
        }

        if (syntaxResult.isValid && refResult.isValid) {
            setValidation({
                valid: true,
                errors: [],
                warnings
            });
        } else {
            const allErrors = [...errors];
            if (!syntaxResult.isValid) {
                allErrors.push({
                    message: syntaxResult.error || 'Unknown syntax error',
                    severity: 'error'
                });
            }
            setValidation({
                valid: false,
                errors: allErrors,
                warnings
            });
        }
    };

    const handleSave = async () => {
        if (!validation?.valid) {
            throw new Error('Cannot save: template contains syntax errors');
        }

        setIsSaving(true);
        try {
            await fragmentService.saveFragment(
                folderPath,
                fragmentName,
                content,
                description || undefined,
                undefined
            );
            setOriginalContent(content);
            setOriginalDescription(description);
            callbacks?.onSaved?.();
            alert('Fragment saved successfully!');
        } catch (error) {
            console.error('Failed to save fragment:', error);
            alert('Failed to save fragment. Please try again.');
            throw error;
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm(`Are you sure you want to delete "${fullPath}"? This will delete all versions.`)) {
            return;
        }
        setIsDeleting(true);
        try {
            await fragmentService.deleteFragment(folderPath, fragmentName);
            callbacks?.onDeleted?.();
        } catch (error) {
            console.error('Failed to delete fragment:', error);
            alert('Failed to delete fragment. Please try again.');
            throw error;
        } finally {
            setIsDeleting(false);
        }
    };

    const hasChanges = content !== originalContent || description !== originalDescription;

    const versionHistoryProps = {
        title: "Fragment Version History",
        loadVersions: () => fragmentService.getVersionHistory(folderPath, fragmentName),
        restoreVersion: async (vn: number) => {
            await fragmentService.restoreVersion(folderPath, fragmentName, vn);
            await loadFragmentContent();  // Reload to get the new version
        },
    };

    return {
        content,
        setContent,
        description,
        setDescription,
        validation,
        isLoading,
        isSaving,
        isDeleting,
        hasChanges,
        isSystemDefault,
        fullPath,
        onSave: handleSave,
        onDelete: handleDelete,
        reload: loadFragmentContent,
        versionHistoryProps,
    };
}
