import React, { useState, useEffect } from 'react';
import { fragmentService } from '../../api/fragmentService';
import type { FragmentVersionHistoryItem } from '../../types/fragments';
import { TextButton } from '../TextButton';
import './FragmentVersionHistoryModal.css';

interface FragmentVersionHistoryModalProps {
  folderPath: string | null;
  fragmentName: string;
  onClose: () => void;
  onRestore: () => void;
}

const FragmentVersionHistoryModal: React.FC<FragmentVersionHistoryModalProps> = ({
  folderPath,
  fragmentName,
  onClose,
  onRestore,
}) => {
  const [versions, setVersions] = useState<FragmentVersionHistoryItem[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadVersionHistory();
  }, [folderPath, fragmentName]);

  const loadVersionHistory = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const history = await fragmentService.getVersionHistory(folderPath, fragmentName);
      setVersions(history);
      // Auto-select active version
      const active = history.find(v => v.is_active);
      if (active) {
        setSelectedVersion(active.version_number);
      } else if (history.length > 0) {
        setSelectedVersion(history[0].version_number);
      }
    } catch (error) {
      console.error('Failed to load version history:', error);
      setError('Failed to load version history');
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
      await fragmentService.restoreVersion(folderPath, fragmentName, versionNumber);
      alert(`Version ${versionNumber} restored successfully!`);
      onRestore();
    } catch (error) {
      console.error('Failed to restore version:', error);
      alert('Failed to restore version');
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
          ) : error ? (
            <div className="error-message">{error}</div>
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
                          {version.is_system_default && <span className="badge badge--default">Default</span>}
                        </div>
                      </div>
                      <div className="history-item__date">{formatDate(version.created_at)}</div>
                      {version.note && (
                        <div className="history-item__note" title={version.note}>{version.note}</div>
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
                        <h4>Version {selectedVersionData.version_number}</h4>
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

export default FragmentVersionHistoryModal;