import React, { useState, useMemo } from 'react';
import { BaseModal } from '../BaseModal';
import { TextButton } from '../TextButton';
import { usePresetStore } from '../../store/presetStore';
import type { PresetExportData } from '../../types/presets';

interface PresetImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  importData: PresetExportData;
}

const PresetImportModal: React.FC<PresetImportModalProps> = ({
  isOpen,
  onClose,
  importData,
}) => {
  const { importPreset, setActivePreset, presets } = usePresetStore();
  const [name, setName] = useState(importData.preset.name || 'Imported Preset');
  const [description, setDescription] = useState(importData.preset.description || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Check for duplicate name
  const isDuplicateName = useMemo(() => {
    return presets.some(p => p.name.toLowerCase() === name.toLowerCase().trim());
  }, [name, presets]);

  // Count items
  const stats = useMemo(() => {
    let promptCount = 0;
    for (const categories of Object.values(importData.prompts || {})) {
      for (const value of Object.values(categories)) {
        if (typeof value === 'object' && value !== null && 'content' in value) {
          promptCount++;
        } else if (typeof value === 'object' && value !== null) {
          promptCount += Object.keys(value).length;
        }
      }
    }

    let fragmentCount = 0;
    for (const fragments of Object.values(importData.fragments || {})) {
      fragmentCount += Object.keys(fragments).length;
    }

    return {
      prompts: promptCount,
      fragments: fragmentCount,
      variables: importData.variables?.length || 0,
    };
  }, [importData]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Preset name is required');
      return;
    }

    if (isDuplicateName) {
      setError('A preset with this name already exists');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const imported = await importPreset({
        name: name.trim(),
        description: description.trim() || undefined,
        data: importData,
      });

      // Switch to new preset
      await setActivePreset(imported.id);
      onClose();
    } catch (err: any) {
      if (err.message?.includes('409') || err.message?.includes('already exists')) {
        setError('A preset with this name already exists');
      } else {
        setError(err.message || 'Failed to import preset');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Import Preset"
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
            disabled={isSubmitting || !name.trim() || isDuplicateName}
            loading={isSubmitting}
          >
            Import
          </TextButton>
        </>
      }
    >
      <div className="form-group">
        <label className="form-label" htmlFor="import-preset-name">Preset Name *</label>
        <input
          id="import-preset-name"
          className="form-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter preset name"
          autoFocus
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="import-preset-description">Description (optional)</label>
        <input
          id="import-preset-description"
          className="form-input"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description of this preset"
        />
      </div>

      <div className="form-group">
        <div className="preset-import-preview">
          Contents: {stats.prompts} prompts, {stats.fragments} fragments, {stats.variables} variables
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}
    </BaseModal>
  );
};

export default PresetImportModal;
