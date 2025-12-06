import React, { useState, useEffect, useMemo } from 'react';
import './RetranslateModal.css';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import type { ObjectType } from '../types/unifiedObject';

interface RetranslateModalProps {
  isOpen: boolean;
  onClose: () => void;
  objectType: ObjectType;           // NEW: needed for version history API
  objectId: string;                 // NEW: needed for version history API
  defaultSourceLanguage: string;    // Initial value (typically mainLanguage)
  defaultTargetLanguage: string;    // Initial value (typically globalDisplayLanguage)
  availableLanguages: string[];     // [mainLanguage, ...subLanguages] - for target options
  manuscriptLanguages?: string[];   // Languages that exist in the current version - for source options
  translationTimestamp: string | null;
  onRetranslate: (sourceLanguage: string, targetLanguage: string, includePrevious: boolean, userInput: string) => void;
  isTranslating: boolean;
}

const RetranslateModal: React.FC<RetranslateModalProps> = ({
  isOpen,
  onClose,
  objectType,
  objectId,
  defaultSourceLanguage,
  defaultTargetLanguage,
  availableLanguages,
  manuscriptLanguages,
  translationTimestamp,
  onRetranslate,
  isTranslating,
}) => {
  const getVersions = useUnifiedObjectStore(state => state.getVersions);

  const [sourceLanguage, setSourceLanguage] = useState(defaultSourceLanguage);
  const [targetLanguage, setTargetLanguage] = useState(defaultTargetLanguage);
  const [includePrevious, setIncludePrevious] = useState(true);
  const [userInput, setUserInput] = useState('');

  // Version history languages (for checking if any version has target language)
  const [versionLanguages, setVersionLanguages] = useState<string[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);

  // Fetch version history when modal opens to check for historical translations
  useEffect(() => {
    if (isOpen && objectId) {
      setLoadingVersions(true);
      getVersions(objectType, objectId)
        .then(versions => {
          // Collect all languages from all versions
          const allLanguages = new Set<string>();
          versions.forEach(v => {
            Object.keys(v.data).forEach(lang => allLanguages.add(lang));
          });
          setVersionLanguages(Array.from(allLanguages));
        })
        .catch(console.error)
        .finally(() => setLoadingVersions(false));
    }
  }, [isOpen, objectType, objectId, getVersions]);

  // Reset to defaults when modal opens
  useEffect(() => {
    if (isOpen) {
      let source = defaultSourceLanguage;
      let target = defaultTargetLanguage;

      // If source and target are the same, pick a different target
      if (source === target && availableLanguages.length > 1) {
        target = availableLanguages.find(l => l !== source) || target;
      }

      setSourceLanguage(source);
      setTargetLanguage(target);
      setIncludePrevious(true);
      setUserInput('');
    }
  }, [isOpen, defaultSourceLanguage, defaultTargetLanguage, availableLanguages]);

  // Current version has target language → Retranslation mode
  const isRetranslationMode = useMemo(() => {
    return (manuscriptLanguages || []).includes(targetLanguage);
  }, [manuscriptLanguages, targetLanguage]);

  // Any version (current or previous) has target language → Show include previous option
  const hasPreviousTranslation = useMemo(() => {
    return versionLanguages.includes(targetLanguage);
  }, [versionLanguages, targetLanguage]);

  // Filter available languages for dropdowns
  // Source: use manuscriptLanguages (what exists) if provided, otherwise all available
  const sourceOptions = useMemo(() => {
    const sourceLangs = manuscriptLanguages || availableLanguages;
    return sourceLangs.filter(lang => lang !== targetLanguage);
  }, [manuscriptLanguages, availableLanguages, targetLanguage]);

  const targetOptions = useMemo(() =>
    availableLanguages.filter(lang => lang !== sourceLanguage),
    [availableLanguages, sourceLanguage]
  );

  const handleSwapLanguages = () => {
    setSourceLanguage(targetLanguage);
    setTargetLanguage(sourceLanguage);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onRetranslate(sourceLanguage, targetLanguage, includePrevious, userInput.trim());
  };

  const handleCancel = () => {
    if (!isTranslating) {
      setUserInput('');
      setIncludePrevious(true);
      onClose();
    }
  };

  const formatTimestamp = (timestamp: string | null): string => {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!isOpen) return null;

  return (
    <div className="retranslate-modal-overlay" onClick={handleCancel}>
      <div className="retranslate-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isRetranslationMode ? '🔄 Retranslate Content' : '🌐 Translate Content'}</h2>
          <button className="modal-close" onClick={handleCancel} disabled={isTranslating}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="retranslate-form">
          <div className="language-selection-section">
            <h3>🌐 Language Selection</h3>
            <div className="language-selector-row">
              <div className="language-field">
                <label>Source Language</label>
                <select
                  value={sourceLanguage}
                  onChange={(e) => setSourceLanguage(e.target.value)}
                  disabled={isTranslating}
                  className="language-select"
                >
                  {sourceOptions.map(lang => (
                    <option key={lang} value={lang}>{lang}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={handleSwapLanguages}
                disabled={isTranslating}
                className="swap-languages-btn"
                title="Swap languages"
              >
                ⇄
              </button>
              <div className="language-field">
                <label>Target Language</label>
                <select
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  disabled={isTranslating}
                  className="language-select"
                >
                  {targetOptions.map(lang => (
                    <option key={lang} value={lang}>{lang}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {translationTimestamp && (
            <div className="info-section">
              <div className="info-row">
                <span className="info-label">Previous translation:</span>
                <span className="info-value">{formatTimestamp(translationTimestamp)}</span>
              </div>
            </div>
          )}

          {/* Only show options section if there's a previous translation to reference */}
          {hasPreviousTranslation && (
            <div className="form-group">
              <h3>{isRetranslationMode ? '⚙️ Retranslation Options' : '⚙️ Translation Options'}</h3>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={includePrevious}
                  onChange={(e) => setIncludePrevious(e.target.checked)}
                  disabled={isTranslating || loadingVersions}
                />
                <span className="checkbox-text">
                  Include previous translation as reference
                </span>
              </label>
              <p className="field-hint">
                💡 Shows the AI your previous translation to maintain consistency in style, tone, and terminology
              </p>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="user-instructions">✏️ Additional Instructions (Optional)</label>
            <textarea
              id="user-instructions"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="e.g., Make it more formal, Fix grammar issues, Use simpler vocabulary, Improve readability"
              rows={4}
              disabled={isTranslating}
              className="instructions-textarea"
            />
          </div>

          {isTranslating && (
            <div className="processing-message">
              <span>{isRetranslationMode ? 'Retranslating...' : 'Translating...'}</span>
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isTranslating}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isTranslating || loadingVersions}
              className="btn-primary"
            >
              {isTranslating
                ? (isRetranslationMode ? 'Retranslating...' : 'Translating...')
                : (isRetranslationMode ? 'Retranslate' : 'Translate')
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RetranslateModal;
