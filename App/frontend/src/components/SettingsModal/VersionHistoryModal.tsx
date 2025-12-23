import React, { useState, useEffect } from 'react';
import { promptService, type VersionHistoryItem } from '../../api/promptService';
import type { FunctionType, PromptCategory } from '../../types/prompts';
import { useErrorStore } from '../../store/errorStore';
import { TextButton } from '../TextButton';
import './VersionHistoryModal.css';

interface VersionHistoryModalProps {
  functionType: FunctionType;
  category: PromptCategory;
  name?: string;
  onClose: () => void;
  onRestore: () => void;
}

const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  functionType,
  category,
  name,
  onClose,
  onRestore,
}) => {
  const { showError } = useErrorStore();
  const [versions, setVersions] = useState<VersionHistoryItem[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);

  useEffect(() => {
    loadVersionHistory();
  }, []);

  const loadVersionHistory = async () => {
    setIsLoading(true);
    try {
      const history = await promptService.getVersionHistory(functionType, category, name);
      setVersions(history);
      // Auto-select active version or first version
      const active = history.find(v => v.is_active);
      if (active) {
        setSelectedVersion(active.version_number);
      } else if (history.length > 0) {
        setSelectedVersion(history[0].version_number);
      }
    } catch (error) {
      console.error('Failed to load version history:', error);
      showError('Load Error', 'Failed to load version history');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestore = async (versionNumber: number) => {
    if (!confirm(`Are you sure you want to restore version ${versionNumber}? This will set it as the active version.`)) {
      return;
    }

    setIsRestoring(true);
    try {
      await promptService.restoreVersion(functionType, category, versionNumber, name);
      showError('Success', `Version ${versionNumber} restored successfully!`);
      onRestore();
    } catch (error) {
      console.error('Failed to restore version:', error);
      showError('Restore Error', 'Failed to restore version');
    } finally {
      setIsRestoring(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const selectedVersionData = versions.find(v => v.version_number === selectedVersion);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content history-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>Version History</h3>
        </header>

        <div className="modal-body history-modal__body">
          {isLoading ? (
            <div className="loading-indicator">Loading version history...</div>
          ) : versions.length === 0 ? (
            <div className="empty-state">No version history available</div>
          ) : (
            <div className="history-layout">
              {/* Version List Sidebar */}
              <aside className="history-list">
                <h4 className="history-list__title">Versions ({versions.length})</h4>
                <div className="history-list__items">
                  {versions.map((version) => (
                    <div
                      key={version.version_number}
                      className={`history-item ${version.is_active ? 'history-item--active' : ''} ${
                        selectedVersion === version.version_number ? 'history-item--selected' : ''
                      }`}
                      onClick={() => setSelectedVersion(version.version_number)}
                    >
                      <div className="history-item__header">
                        <span className="history-item__number">
                          v{version.version_number}
                        </span>
                        <div className="history-item__badges">
                          {version.is_active && <span className="badge badge--active">Active</span>}
                          {version.is_default && <span className="badge badge--default">Default</span>}
                        </div>
                      </div>
                      <div className="history-item__date">{formatDate(version.created_at)}</div>
                      {version.note && (
                        <div className="history-item__note" title={version.note}>"{version.note}"</div>
                      )}
                    </div>
                  ))}
                </div>
              </aside>

              {/* Version Preview Area */}
              <main className="history-preview">
                {selectedVersionData ? (
                  <>
                    <div className="history-preview__header">
                      <div className="history-preview__meta">
                        <h4>Version {selectedVersionData.version_number} Details</h4>
                        <span className="history-preview__date">{formatDate(selectedVersionData.created_at)}</span>
                      </div>
                      {!selectedVersionData.is_active && (
                        <TextButton
                          variant="primary"
                          size="sm"
                          onClick={() => handleRestore(selectedVersionData.version_number)}
                          disabled={isRestoring}
                          loading={isRestoring}
                        >
                          Restore This Version
                        </TextButton>
                      )}
                    </div>

                    {selectedVersionData.note && (
                      <div className="history-preview__note">
                        <strong>Note:</strong> {selectedVersionData.note}
                      </div>
                    )}

                    <div className="history-preview__content">
                      <pre>{selectedVersionData.preview}</pre>
                    </div>
                  </>
                ) : (
                  <div className="history-preview__empty">Select a version to view details</div>
                )}
              </main>
            </div>
          )}
        </div>

        <footer className="modal-footer">
          <TextButton variant="secondary" onClick={onClose}>
            Close
          </TextButton>
        </footer>
      </div>
    </div>
  );
};

export default VersionHistoryModal;