import React, { useState, useEffect } from 'react';
import { fragmentService, type FragmentVersionHistoryItem } from '../../api/fragmentService';
import { useErrorStore } from '../../store/errorStore';
import { TextButton } from '../TextButton';
import './PromptEditor.css';

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
  const { showError } = useErrorStore();
  const [versions, setVersions] = useState<FragmentVersionHistoryItem[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);

  const fullPath = folderPath ? `${folderPath}/${fragmentName}` : fragmentName;

  useEffect(() => {
    loadVersionHistory();
  }, []);

  const loadVersionHistory = async () => {
    setIsLoading(true);
    try {
      const history = await fragmentService.getVersionHistory(folderPath, fragmentName);
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
      await fragmentService.restoreVersion(folderPath, fragmentName, versionNumber);
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
          <h3>Version History: {fullPath}</h3>
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
                      {version.is_system_default && <span className="badge default">System Default</span>}
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
          <TextButton variant="secondary" onClick={onClose}>
            Close
          </TextButton>
        </div>
      </div>
    </div>
  );
};

export default FragmentVersionHistoryModal;
