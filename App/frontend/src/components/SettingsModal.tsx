import React, { useState, useEffect } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import type { Settings } from '../store/settingsStore';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const settingsStore = useSettingsStore();
  const [localSettings, setLocalSettings] = useState<Settings>(settingsStore.settings);

  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settingsStore.settings);
    }
  }, [isOpen, settingsStore.settings]);

  const handleSave = () => {
    settingsStore.updateSettings(localSettings);
    onClose();
  };

  const handleReset = () => {
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
      settingsStore.resetToDefaults();
      setLocalSettings(settingsStore.settings);
    }
  };

  const handleCancel = () => {
    setLocalSettings(settingsStore.settings);
    onClose();
  };

  const handleInputChange = (field: keyof Settings, value: string) => {
    setLocalSettings(prev => ({
      ...prev,
      [field]: value
    }));
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>⚙️ Settings</h2>
          <button className="modal-close" onClick={handleCancel}>×</button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="settings-form">
          <div className="form-group">
            <label htmlFor="ai-model">AI Model</label>
            <input
              id="ai-model"
              type="text"
              value={localSettings.aiModel}
              onChange={(e) => handleInputChange('aiModel', e.target.value)}
              placeholder="e.g., gpt-3.5-turbo, gpt-4, claude-3-sonnet"
              required
            />
            <p className="form-help">
              Specify the AI model to use for generation. You can enter any model name supported by your backend.
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="output-language">Output Language</label>
            <input
              id="output-language"
              type="text"
              value={localSettings.outputLanguage}
              onChange={(e) => handleInputChange('outputLanguage', e.target.value)}
              placeholder="e.g., English, Korean, Japanese, Spanish"
              required
            />
            <p className="form-help">
              The AI will generate responses in this language. Enter the language name in English.
            </p>
          </div>

          <div className="form-actions">
            <button 
              type="button" 
              onClick={handleReset} 
              className="reset-button"
            >
              Reset to Defaults
            </button>
            <div className="action-buttons">
              <button 
                type="button" 
                onClick={handleCancel} 
                className="cancel-button"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="save-button"
              >
                Save Settings
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SettingsModal;