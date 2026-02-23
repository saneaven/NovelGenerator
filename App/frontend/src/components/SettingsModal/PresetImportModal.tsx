import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseModal } from '../BaseModal';
import { TextButton } from '../TextButton';
import { usePresetStore } from '../../store/presetStore';
import type { PresetExportData } from '../../types/presets';

interface PresetImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  importData: PresetExportData;
  beforeSwitchPreset?: (presetId: string) => Promise<boolean> | boolean;
}

const PresetImportModal: React.FC<PresetImportModalProps> = ({
  isOpen,
  onClose,
  importData,
  beforeSwitchPreset,
}) => {
  const { t } = useTranslation();
  const { importPreset, setActivePreset, presets } = usePresetStore();
  const [name, setName] = useState(importData.preset.name || '');
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
    for (const subtypes of Object.values(importData.prompts || {})) {
      if (typeof subtypes !== 'object' || subtypes === null) continue;
      promptCount += Object.keys(subtypes).length;
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
      setError(t('settings.presetImport.nameRequired'));
      return;
    }

    if (isDuplicateName) {
      setError(t('settings.presetImport.duplicateName'));
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
      if (beforeSwitchPreset) {
        const ok = await beforeSwitchPreset(imported.id);
        if (!ok) {
          onClose();
          return;
        }
      }
      await setActivePreset(imported.id);
      onClose();
    } catch (err: any) {
      if (err.message?.includes('409') || err.message?.includes('already exists')) {
        setError(t('settings.presetImport.duplicateName'));
      } else {
        setError(err.message || t('settings.presetImport.importFailed'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={t('settings.presetImport.title')}
      size="small"
      zIndexLayer={1}
      footer={
        <>
          <TextButton variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </TextButton>
          <TextButton
            variant="primary"
            onClick={handleSubmit}
            disabled={isSubmitting || !name.trim() || isDuplicateName}
            loading={isSubmitting}
          >
            {t('common.import')}
          </TextButton>
        </>
      }
    >
      <div className="form-group">
        <label className="form-label" htmlFor="import-preset-name">{t('settings.presetImport.presetName')} *</label>
        <input
          id="import-preset-name"
          className="form-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.presetImport.presetNamePlaceholder')}
          autoFocus
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="import-preset-description">{t('settings.presetImport.description')}</label>
        <input
          id="import-preset-description"
          className="form-input"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('settings.presetImport.descriptionPlaceholder')}
        />
      </div>

      <div className="form-group">
        <div className="preset-import-preview">
          {t('settings.presetImport.contents', { prompts: stats.prompts, fragments: stats.fragments, variables: stats.variables })}
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}
    </BaseModal>
  );
};

export default PresetImportModal;
