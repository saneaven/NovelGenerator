import React, { useState, useEffect, useCallback } from 'react';
import SyntaxHighlightedTextarea from './SyntaxHighlighter/SyntaxHighlightedTextarea';
import { fragmentService } from '../../api/fragmentService';
import { validateTemplate, validateFragmentReferences } from '../../templateEngine/engine';
import { TextButton } from '../TextButton';
import ValidationWarnings from './ValidationWarnings';
import FragmentVersionHistoryModal from './FragmentVersionHistoryModal';
import { Copy, Trash, Clock } from '../icons';
import './FragmentEditor.css';

interface FragmentEditorProps {
  folderPath: string | null;
  fragmentName: string;
  onDelete?: () => void;
  onSave?: () => void;
}

interface ValidationResult {
  valid: boolean;
  errors: Array<{ message: string; line?: number; column?: number; severity: string }>;
  warnings: Array<{ message: string; line?: number; column?: number; severity: string }>;
}

const FragmentEditor: React.FC<FragmentEditorProps> = ({
  folderPath,
  fragmentName,
  onDelete,
  onSave,
}) => {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [description, setDescription] = useState('');
  const [originalDescription, setOriginalDescription] = useState('');
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [saveNote, setSaveNote] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [isSystemDefault, setIsSystemDefault] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  const fullPath = folderPath ? `${folderPath}/${fragmentName}` : fragmentName;

  // Load fragment on mount or when path changes
  useEffect(() => {
    loadFragmentContent();
  }, [folderPath, fragmentName]);

  const loadFragmentContent = async () => {
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
  };

  // Debounced validation
  useEffect(() => {
    const timer = setTimeout(() => {
      validateContent(content);
    }, 500);

    return () => clearTimeout(timer);
  }, [content]);

  const validateContent = async (text: string) => {
    // Validate Handlebars syntax
    const syntaxResult = await validateTemplate(text);

    // Validate fragment references (pass currentPath for self-reference detection)
    const refResult = validateFragmentReferences(text, fullPath);

    const warnings: ValidationResult['warnings'] = [];

    // Add syntax warnings
    if (syntaxResult.warnings) {
      warnings.push(...syntaxResult.warnings.map(w => ({
        message: w.message,
        line: w.line,
        column: w.column,
        severity: w.severity
      })));
    }

    // Add fragment reference warnings from refResult
    if (refResult.warnings) {
      refResult.warnings.forEach(warning => {
        warnings.push({
          message: warning,
          severity: 'warning'
        });
      });
    }

    // Add fragment reference errors
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
      alert('Cannot save: template contains syntax errors');
      return;
    }

    setIsSaving(true);
    try {
      await fragmentService.saveFragment(
        folderPath,
        fragmentName,
        content,
        description || undefined,
        saveNote || undefined
      );

      setOriginalContent(content);
      setOriginalDescription(description);
      setSaveNote('');
      setShowNoteInput(false);

      onSave?.();
      alert('Fragment saved successfully!');
    } catch (error) {
      console.error('Failed to save fragment:', error);
      alert('Failed to save fragment. Please try again.');
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
      onDelete?.();
    } catch (error) {
      console.error('Failed to delete fragment:', error);
      alert('Failed to delete fragment. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCopyPath = useCallback(() => {
    const pathToCopy = `{{prompt "${fullPath}"}}`;
    navigator.clipboard.writeText(pathToCopy);
  }, [fullPath]);

  const handleRestore = useCallback(async () => {
    await loadFragmentContent();
    setShowVersionHistory(false);
  }, [folderPath, fragmentName]);

  const hasChanges = content !== originalContent || description !== originalDescription;

  if (isLoading) {
    return (
      <div className="fragment-editor loading">
        <div className="loading-indicator">Loading fragment...</div>
      </div>
    );
  }

  return (
    <div className="fragment-editor">
      {/* Header */}
      <div className="fragment-editor-header">
        <div className="fragment-path-container">
          <code className="fragment-path">{fullPath}</code>
          <button
            className="copy-path-btn"
            onClick={handleCopyPath}
            title="Copy path for use in templates"
          >
            <Copy size="sm" />
          </button>
        </div>
        {isSystemDefault && (
          <span className="badge default">System Default</span>
        )}
      </div>

      {/* Description field */}
      <div className="fragment-description-field">
        <label htmlFor="fragment-description">Description</label>
        <input
          id="fragment-description"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description..."
          maxLength={500}
        />
      </div>

      {/* Syntax highlighted textarea */}
      <SyntaxHighlightedTextarea
        value={content}
        onChange={setContent}
        placeholder="Enter fragment template..."
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
              className="note-input"
              maxLength={500}
            />
          )}
        </div>

        <div className="editor-right-actions">
          <span className="char-count">
            {content.length} characters
            {hasChanges && <span className="unsaved-indicator"> - Unsaved changes</span>}
          </span>
          <TextButton
            variant="secondary"
            size="sm"
            onClick={() => setShowVersionHistory(true)}
            disabled={isSaving || isDeleting}
          >
            <Clock size="sm" /> History
          </TextButton>
          <TextButton
            variant="danger"
            size="sm"
            onClick={handleDelete}
            disabled={isDeleting || isSaving}
            loading={isDeleting}
          >
            <Trash size="sm" /> Delete
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
      </div>

      {/* Version History Modal */}
      {showVersionHistory && (
        <FragmentVersionHistoryModal
          folderPath={folderPath}
          fragmentName={fragmentName}
          onClose={() => setShowVersionHistory(false)}
          onRestore={handleRestore}
        />
      )}
    </div>
  );
};

export default FragmentEditor;
