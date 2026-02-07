import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePresetStore } from '../../store/presetStore';
import { CustomSelect } from '../ui/CustomSelect';
import type { SelectOption, RenderOptionProps } from '../ui/CustomSelect';
import { Plus, Copy, Edit, Trash, Check, Download, Upload } from '../icons';
import PresetImportModal from './PresetImportModal';
import type { PresetExportData } from '../../types/presets';
import { useSettingsToast } from './SettingsToastContext';
import './PresetSelector.css';

interface PresetSelectorProps {
  onCreatePreset: () => void;
  onDuplicatePreset: (presetId: string) => void;
  onEditPreset: (presetId: string) => void;
  beforeSelectPreset?: (presetId: string) => Promise<boolean> | boolean;
}

const PresetSelector: React.FC<PresetSelectorProps> = ({
  onCreatePreset,
  onDuplicatePreset,
  onEditPreset,
  beforeSelectPreset,
}) => {
  const { t } = useTranslation();
  const toast = useSettingsToast();
  const { presets, activePresetId, isLoading, setActivePreset, deletePreset, loadPresets, isInitialized, exportPreset } = usePresetStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importData, setImportData] = useState<PresetExportData | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);

  // Load presets on mount
  useEffect(() => {
    if (!isInitialized) {
      loadPresets();
    }
  }, [isInitialized, loadPresets]);

  const handleSelectPreset = async (presetId: string) => {
    if (presetId !== activePresetId) {
      if (beforeSelectPreset) {
        const ok = await beforeSelectPreset(presetId);
        if (!ok) return;
      }
      await setActivePreset(presetId);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, presetId: string) => {
    e.stopPropagation();
    const preset = presets.find(p => p.id === presetId);
    if (confirm(t('settings.presetSelector.deleteConfirm', { name: preset?.name || t('settings.presetSelector.thisPreset') }))) {
      deletePreset(presetId);
    }
  };

  const handleDuplicateClick = (e: React.MouseEvent, presetId: string) => {
    e.stopPropagation();
    onDuplicatePreset(presetId);
  };

  const handleEditClick = (e: React.MouseEvent, presetId: string) => {
    e.stopPropagation();
    onEditPreset(presetId);
  };

  const handleExportClick = async (e: React.MouseEvent, presetId: string) => {
    e.stopPropagation();
    try {
      const data = await exportPreset(presetId);
      const preset = presets.find(p => p.id === presetId);
      const filename = `${preset?.name.replace(/[^a-z0-9]/gi, '_') || 'preset'}.nbprompt`;

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text) as PresetExportData;

      // Basic validation
      if (data.format_version !== 1 || !data.preset || !data.prompts || !Array.isArray((data as any).sub_agents)) {
        throw new Error('Invalid preset file format');
      }

      setImportData(data);
      setShowImportModal(true);
    } catch (err) {
      const message =
        err instanceof Error && err.message === 'Invalid preset file format'
          ? t('settings.presetSelector.invalidFileFormat')
          : err instanceof Error
            ? err.message
            : t('settings.presetSelector.failedToReadFile');
      toast.error(message);
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const options: SelectOption[] = presets.map(p => ({
    value: p.id,
    label: p.name,
    description: p.description || undefined,
  }));

  const renderPresetOption = ({ option, isSelected, onSelect }: RenderOptionProps) => {
    const preset = presets.find(p => p.id === option.value);
    if (!preset) return null;

    return (
      <div
        className={`preset-selector__item ${isSelected ? 'preset-selector__item--active' : ''}`}
        onClick={onSelect}
      >
        <div className="preset-selector__item-content">
          <span className="preset-selector__item-name">{preset.name}</span>
          {preset.description && (
            <span className="preset-selector__item-desc">{preset.description}</span>
          )}
        </div>
        <div className="preset-selector__item-actions">
          {isSelected && (
            <Check size="xs" className="preset-selector__check" />
          )}
          <button
            className="preset-selector__action"
            onClick={(e) => handleEditClick(e, preset.id)}
            title={t('settings.presetSelector.editPreset')}
          >
            <Edit size="xs" />
          </button>
          <button
            className="preset-selector__action"
            onClick={(e) => handleDuplicateClick(e, preset.id)}
            title={t('settings.presetSelector.duplicatePreset')}
          >
            <Copy size="xs" />
          </button>
          <button
            className="preset-selector__action"
            onClick={(e) => handleExportClick(e, preset.id)}
            title={t('settings.presetSelector.exportPreset')}
          >
            <Download size="xs" />
          </button>
          {!isSelected && (
            <button
              className="preset-selector__action preset-selector__action--delete"
              onClick={(e) => handleDeleteClick(e, preset.id)}
              title={t('settings.presetSelector.deletePreset')}
            >
              <Trash size="xs" />
            </button>
          )}
        </div>
      </div>
    );
  };

  const footerContent = (
    <div className="preset-selector__footer">
      <button
        className="preset-selector__create"
        onClick={onCreatePreset}
      >
        <Plus size="sm" />
        <span>{t('settings.presetSelector.createNew')}</span>
      </button>
      <button
        className="preset-selector__import"
        onClick={handleImportClick}
        title={t('settings.presetSelector.importFromFile')}
      >
        <Upload size="sm" />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".nbprompt,.json"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />
    </div>
  );

  return (
    <div className="preset-selector">
      <CustomSelect
        value={activePresetId || ''}
        onChange={handleSelectPreset}
        options={options}
        placeholder={t('settings.presetSelector.selectPlaceholder')}
        disabled={isLoading}
        triggerLabel={t('settings.presetSelector.presetLabel')}
        minWidth={280}
        renderOption={renderPresetOption}
        footer={footerContent}
        align="right"
      />
      {showImportModal && importData && (
        <PresetImportModal
          isOpen={showImportModal}
          onClose={() => {
            setShowImportModal(false);
            setImportData(null);
          }}
          importData={importData}
          beforeSwitchPreset={beforeSelectPreset}
        />
      )}
    </div>
  );
};

export default PresetSelector;
