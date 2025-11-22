import React, { useState, useEffect } from 'react';
import { promptService, type VersionHistoryItem } from '../../api/promptService';
import type { FunctionType, PromptCategory } from '../../types/prompts';
import { useErrorStore } from '../../store/errorStore';

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
      <div className="modal-content version-history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Version History</h3>
          <button className="close-button" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          {isLoading ? (
            <div className="loading-indicator">Loading version history...</div>
          ) : versions.length === 0 ? (
            <div className="empty-state">No version history available</div>
          ) : (
            <div className="version-history-content">
              {/* Version list */}
              <div className="version-list">
                <h4>Versions ({versions.length})</h4>
                {versions.map((version) => (
                  <div
                    key={version.version_number}
                    className={`version-item ${version.is_active ? 'active' : ''} ${
                      selectedVersion === version.version_number ? 'selected' : ''
                    }`}
                    onClick={() => setSelectedVersion(version.version_number)}
                  >
                    <div className="version-header">
                      <span className="version-number">
                        Version {version.version_number}
                      </span>
                      {version.is_active && <span className="badge active">Active</span>}
                      {version.is_default && <span className="badge default">Default</span>}
                    </div>
                    <div className="version-meta">
                      <span className="version-date">{formatDate(version.created_at)}</span>
                    </div>
                    {version.note && (
                      <div className="version-note">"{version.note}"</div>
                    )}
                    <div className="version-preview">{version.preview}</div>
                  </div>
                ))}
              </div>

              {/* Preview panel */}
              {selectedVersionData && (
                <div className="version-details">
                  <div className="details-header">
                    <h4>Version {selectedVersionData.version_number} Details</h4>
                    {!selectedVersionData.is_active && (
                      <button
                        onClick={() => handleRestore(selectedVersionData.version_number)}
                        className="btn-primary"
                        disabled={isRestoring}
                      >
                        {isRestoring ? 'Restoring...' : 'Restore This Version'}
                      </button>
                    )}
                  </div>
                  <div className="details-meta">
                    <p><strong>Created:</strong> {formatDate(selectedVersionData.created_at)}</p>
                    {selectedVersionData.note && (
                      <p><strong>Note:</strong> {selectedVersionData.note}</p>
                    )}
                    <p><strong>Status:</strong> {selectedVersionData.is_active ? 'Active' : 'Inactive'}</p>
                  </div>
                  <div className="details-preview">
                    <h5>Preview (first 200 characters)</h5>
                    <pre className="preview-content">{selectedVersionData.preview}</pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default VersionHistoryModal;
