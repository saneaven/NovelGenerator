import React, { useState, useEffect } from 'react';
import { BaseModal } from '../BaseModal';
import { TextButton } from '../TextButton';
import { usePresetStore } from '../../store/presetStore';
import type { PresetListItem } from '../../types/presets';

type ModalMode = 'create' | 'duplicate' | 'edit';

interface PresetModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: ModalMode;
  sourcePreset?: PresetListItem | null; // For duplicate/edit modes
  beforeSwitchPreset?: (presetId: string) => Promise<boolean> | boolean;
}

const PresetModal: React.FC<PresetModalProps> = ({
  isOpen,
  onClose,
  mode,
  sourcePreset,
  beforeSwitchPreset,
}) => {
  const { createPreset, duplicatePreset, updatePreset, setActivePreset } = usePresetStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [initializeWithDefaults, setInitializeWithDefaults] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      if (mode === 'edit' && sourcePreset) {
        setName(sourcePreset.name);
        setDescription(sourcePreset.description || '');
      } else if (mode === 'duplicate' && sourcePreset) {
        setName(`${sourcePreset.name} (Copy)`);
        setDescription(sourcePreset.description || '');
      } else {
        setName('');
        setDescription('');
      }
      setInitializeWithDefaults(true);
      setError('');
    }
  }, [isOpen, mode, sourcePreset]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Preset name is required');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      if (mode === 'create') {
        const newPreset = await createPreset({
          name: name.trim(),
          description: description.trim() || undefined,
          initialize_with_defaults: initializeWithDefaults,
        });
        // Switch to the new preset
        if (!beforeSwitchPreset || (await beforeSwitchPreset(newPreset.id))) {
          await setActivePreset(newPreset.id);
        }
      } else if (mode === 'duplicate' && sourcePreset) {
        const duplicatedPreset = await duplicatePreset(sourcePreset.id, {
          new_name: name.trim(),
          new_description: description.trim() || undefined,
        });
        // Switch to the duplicated preset
        if (!beforeSwitchPreset || (await beforeSwitchPreset(duplicatedPreset.id))) {
          await setActivePreset(duplicatedPreset.id);
        }
      } else if (mode === 'edit' && sourcePreset) {
        await updatePreset(sourcePreset.id, {
          name: name.trim(),
          description: description.trim() || undefined,
        });
      }
      onClose();
    } catch (err: any) {
      if (err.message?.includes('409') || err.message?.includes('already exists')) {
        setError('A preset with this name already exists');
      } else {
        setError(err.message || 'Failed to save preset');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const getTitle = () => {
    switch (mode) {
      case 'create':
        return 'Create New Preset';
      case 'duplicate':
        return 'Duplicate Preset';
      case 'edit':
        return 'Edit Preset';
    }
  };

  const getSubmitLabel = () => {
    switch (mode) {
      case 'create':
        return 'Create Preset';
      case 'duplicate':
        return 'Duplicate';
      case 'edit':
        return 'Save Changes';
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={getTitle()}
      size="small"
      zIndexLayer={1}
      footer={
        <>
          <TextButton variant="secondary" onClick={onClose}>
            Cancel
          </TextButton>
          <TextButton
            variant="primary"
            onClick={handleSubmit}
            disabled={isSubmitting || !name.trim()}
            loading={isSubmitting}
          >
            {getSubmitLabel()}
          </TextButton>
        </>
      }
    >
      <div className="form-group">
        <label className="form-label" htmlFor="preset-name">Preset Name *</label>
        <input
          id="preset-name"
          className="form-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., My Writing Style"
          autoFocus
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="preset-description">Description (optional)</label>
        <input
          id="preset-description"
          className="form-input"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description of this preset"
        />
      </div>

      {mode === 'create' && (
        <div className="form-group">
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={initializeWithDefaults}
              onChange={(e) => setInitializeWithDefaults(e.target.checked)}
            />
            <span>Initialize with default prompts and fragments</span>
          </label>
          <small className="form-hint">
            When enabled, the new preset will include all default prompts and fragments.
            When disabled, the preset will be empty.
          </small>
        </div>
      )}

      {mode === 'duplicate' && sourcePreset && (
        <div className="form-group">
          <div className="form-hint">
            This will create a copy of "{sourcePreset.name}" with all its prompts, fragments, and variables.
          </div>
        </div>
      )}

      {error && <div className="form-error">{error}</div>}
    </BaseModal>
  );
};

export default PresetModal;
