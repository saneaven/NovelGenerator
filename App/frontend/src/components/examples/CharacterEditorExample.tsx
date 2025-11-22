/**
 * Character Editor Example - New Unified System Pattern
 *
 * This component demonstrates the new simplified approach:
 * - Direct data access (no useLanguageAwareData hook)
 * - Simple store operations
 * - Clean language switching
 * - Automatic version management
 *
 * Use this as a reference when migrating other components!
 */

import React, { useEffect, useState } from 'react';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useErrorStore } from '../../store/errorStore';
import { LanguageSwitcher } from '../LanguageSwitcher';
import type { CharacterObject, CharacterData } from '../../types/unifiedObject';
import './CharacterEditorExample.css';

interface CharacterEditorExampleProps {
  projectId: string;
  characterId: string;
  onClose?: () => void;
}

export const CharacterEditorExample: React.FC<CharacterEditorExampleProps> = ({
  projectId,
  characterId,
  onClose,
}) => {
  // ===========================================================================
  // STATE
  // ===========================================================================

  const store = useUnifiedObjectStore();
  const { showError } = useErrorStore();
  const character = store.objects[characterId] as CharacterObject | undefined;
  const loading = store.loading[characterId] || false;
  const error = store.errors[characterId] || null;

  // Local editing state (before save)
  const [editedData, setEditedData] = useState<CharacterData>({
    name: '',
    description: '',
  });

  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // ===========================================================================
  // EFFECTS
  // ===========================================================================

  // Fetch character on mount
  useEffect(() => {
    if (characterId) {
      store.fetchObject('character', characterId);
    }
  }, [characterId]);

  // Sync character data to local state when it loads or language changes
  useEffect(() => {
    if (character?.data) {
      setEditedData(character.data);
      setHasChanges(false);
    }
  }, [character?.data]);

  // ===========================================================================
  // HANDLERS
  // ===========================================================================

  const handleFieldChange = (field: keyof CharacterData, value: string) => {
    setEditedData(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!character) return;

    setIsSaving(true);
    try {
      await store.updateObject('character', characterId, {
        data: editedData,
        language: character.languages.active,
        user_request: 'User Edit',
        create_new_version: true, // Creates new version
      });

      setHasChanges(false);
    } catch (err) {
      console.error('Failed to save character:', err);
      showError('Save Error', 'Failed to save character. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLanguageChange = async (newLanguage: string) => {
    if (!character) return;

    try {
      // This switches language WITHOUT creating a new version!
      await store.switchLanguage('character', characterId, newLanguage);
    } catch (err) {
      console.error('Failed to switch language:', err);
      showError('Language Switch Error', 'Failed to switch language. Please try again.');
    }
  };

  const handleAddTranslation = async () => {
    if (!character) return;

    const targetLanguage = prompt('Enter language code (e.g., Korean, Japanese):');
    if (!targetLanguage) return;

    // Check if language already exists
    if (character.languages.available.includes(targetLanguage)) {
      showError('Warning', 'This language already exists. Use language switcher to view it.');
      return;
    }

    try {
      // Add new translation (you would typically use AI here)
      await store.addTranslation('character', characterId, {
        language: targetLanguage,
        data: {
          name: `[${targetLanguage}] ${character.data.name}`,
          description: `[${targetLanguage}] ${character.data.description}`,
        },
        user_request: 'Manual Translation',
      });

      showError('Success', `Translation added for ${targetLanguage}`);
    } catch (err) {
      console.error('Failed to add translation:', err);
      showError('Translation Error', 'Failed to add translation. Please try again.');
    }
  };

  const handleCancel = () => {
    if (hasChanges) {
      const confirm = window.confirm('You have unsaved changes. Discard them?');
      if (!confirm) return;
    }

    if (character?.data) {
      setEditedData(character.data);
      setHasChanges(false);
    }
  };

  // ===========================================================================
  // RENDER
  // ===========================================================================

  if (loading && !character) {
    return (
      <div className="character-editor-example loading">
        <div className="spinner" />
        <p>Loading character...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="character-editor-example error">
        <h3>Error</h3>
        <p>{error}</p>
        <button onClick={() => store.fetchObject('character', characterId)}>
          Retry
        </button>
      </div>
    );
  }

  if (!character) {
    return (
      <div className="character-editor-example error">
        <p>Character not found</p>
      </div>
    );
  }

  return (
    <div className="character-editor-example">
      {/* Header with Language Switcher */}
      <div className="editor-header">
        <h2>Character Editor</h2>
        <div className="header-actions">
          <LanguageSwitcher
            object={character}
            onLanguageChange={handleLanguageChange}
            disabled={isSaving}
          />
          <button
            className="btn-secondary"
            onClick={handleAddTranslation}
            disabled={isSaving}
          >
            + Add Translation
          </button>
        </div>
      </div>

      {/* Version Info */}
      <div className="version-info">
        <span>Version {character.version.number}</span>
        <span>•</span>
        <span>{new Date(character.version.created_at).toLocaleString()}</span>
      </div>

      {/* Form Fields - DIRECT ACCESS to character.data.* */}
      <div className="editor-form">
        <div className="form-group">
          <label htmlFor="char-name">
            Name
            {hasChanges && <span className="unsaved-indicator">*</span>}
          </label>
          <input
            id="char-name"
            type="text"
            value={editedData.name}
            onChange={(e) => handleFieldChange('name', e.target.value)}
            disabled={isSaving}
            placeholder="Character name"
          />
        </div>

        <div className="form-group">
          <label htmlFor="char-description">
            Description
            {hasChanges && <span className="unsaved-indicator">*</span>}
          </label>
          <textarea
            id="char-description"
            value={editedData.description}
            onChange={(e) => handleFieldChange('description', e.target.value)}
            disabled={isSaving}
            placeholder="Character description"
            rows={10}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="editor-actions">
        <button
          className="btn-secondary"
          onClick={handleCancel}
          disabled={isSaving || !hasChanges}
        >
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={isSaving || !hasChanges}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* Debug Info (remove in production) */}
      {process.env.NODE_ENV === 'development' && (
        <details className="debug-info">
          <summary>Debug Info</summary>
          <pre>{JSON.stringify(character, null, 2)}</pre>
        </details>
      )}
    </div>
  );
};

export default CharacterEditorExample;
