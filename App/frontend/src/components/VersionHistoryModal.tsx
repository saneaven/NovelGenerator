import React, { useState, useEffect } from 'react';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useErrorStore } from '../store/errorStore';
import type { ObjectType } from '../types/unifiedObject';
import './VersionHistoryModal.css';

interface VersionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  objectType: ObjectType;
  objectId: string;
  onRestoreVersion?: (versionId: string) => void;
}

const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  isOpen,
  onClose,
  objectType,
  objectId,
  onRestoreVersion,
}) => {
  const store = useUnifiedObjectStore();
  const { showError } = useErrorStore();
  const [versions, setVersions] = useState<any[]>([]);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadVersions = async () => {
      if (!isOpen || !objectId) return;

      setLoading(true);
      try {
        const versionHistory = await store.getVersions(objectType, objectId);
        setVersions(versionHistory.sort((a, b) => b.number - a.number));
      } catch (error) {
        console.error('Failed to load versions:', error);
        showError('Load Error', 'Failed to load version history. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    loadVersions();
  }, [isOpen, objectId, objectType]);

  const currentObject = store.objects[objectId];
  const currentLanguage = currentObject?.languages?.active || 'en';

  const getTypeDisplayName = (type: ObjectType): string => {
    const names: Record<ObjectType, string> = {
      basic_info: 'Basic Info',
      character: 'Character',
      organization: 'Organization',
      location: 'Location',
      lorebook: 'Lorebook',
      act: 'Act',
      chapter: 'Chapter',
      manuscript: 'Manuscript',
    };
    return names[type] || type;
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!confirm('Are you sure you want to restore this version? This will make it the active version.')) {
      return;
    }

    try {
      await store.activateVersion(objectType, objectId, versionId);

      // Reload versions to show updated active status
      const versionHistory = await store.getVersions(objectType, objectId);
      setVersions(versionHistory.sort((a, b) => b.number - a.number));

      // Notify parent that a new version was activated
      if (onRestoreVersion) {
        onRestoreVersion(versionId);
      }
    } catch (error) {
      console.error('Failed to restore version:', error);
      showError('Restore Error', 'Failed to restore version. Please try again.');
    }
  };

  const toggleExpandVersion = (versionId: string) => {
    const newExpanded = new Set(expandedVersions);
    if (newExpanded.has(versionId)) {
      newExpanded.delete(versionId);
    } else {
      newExpanded.add(versionId);
    }
    setExpandedVersions(newExpanded);
  };

  const renderVersionData = (data: any, type: ObjectType) => {
    if (!data || typeof data !== 'object') {
      return <div className="version-data-simple">{String(data)}</div>;
    }

    // For basic info
    if (type === 'basic_info') {
      return (
        <div className="version-data-formatted">
          <div className="data-field">
            <label>Title:</label>
            <span>{data.title || 'Not set'}</span>
          </div>
          <div className="data-field">
            <label>Logline:</label>
            <span>{data.logline || 'Not set'}</span>
          </div>
          <div className="data-field">
            <label>Genre:</label>
            <span>{data.genre || 'Not set'}</span>
          </div>
        </div>
      );
    }

    // For name-description objects (character, organization, location, lorebook, act, chapter)
    if (data.name !== undefined || data.description !== undefined) {
      return (
        <div className="version-data-formatted">
          <div className="data-field">
            <label>Name:</label>
            <span>{data.name || 'Not set'}</span>
          </div>
          <div className="data-field">
            <label>Description:</label>
            <span className="description-text">{data.description || 'Not set'}</span>
          </div>
        </div>
      );
    }

    // For manuscript content
    if (type === 'manuscript' && data.content !== undefined) {
      return (
        <div className="version-data-formatted">
          <div className="data-field">
            <label>Content:</label>
            <span className="content-preview">
              {data.content.substring(0, 200)}
              {data.content.length > 200 ? '...' : ''}
            </span>
          </div>
        </div>
      );
    }

    // Fallback to JSON for unknown structures
    return (
      <div className="version-data-json">
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content version-history-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{getTypeDisplayName(objectType)} Version History</h2>
          <button className="modal-close" onClick={onClose}>Close</button>
        </div>

        <div className="version-history-content">
          {loading ? (
            <div className="loading-state">Loading versions...</div>
          ) : versions.length === 0 ? (
            <div className="empty-state">
              <p>No saved versions.</p>
            </div>
          ) : (
            <div className="versions-list">
              {versions.map((version) => {
                const isCurrentVersion = currentObject?.version.id === version.id;
                const versionData = version.data[currentLanguage] || Object.values(version.data)[0] || {};

                return (
                  <div
                    key={version.id}
                    className={`version-item ${isCurrentVersion ? 'active' : ''}`}
                  >
                    <div className="version-header">
                      <div className="version-info">
                        <div className="version-title">
                          <span className="version-number">Version #{version.number}</span>
                          {isCurrentVersion && <span className="active-badge">Currently Active</span>}
                        </div>
                        <div className="version-metadata">
                          <span className="version-timestamp">
                            {new Date(version.created_at).toLocaleString()}
                          </span>
                          <span className="version-request">
                            Request: {version.user_request || 'No description'}
                          </span>
                        </div>
                      </div>

                      <div className="version-actions">
                        <button
                          onClick={() => toggleExpandVersion(version.id)}
                          className="expand-button"
                        >
                          {expandedVersions.has(version.id) ? 'Hide details' : 'Show details'}
                        </button>

                        {!isCurrentVersion && (
                          <button
                            onClick={() => handleRestoreVersion(version.id)}
                            className="restore-button"
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    </div>

                    {expandedVersions.has(version.id) && (
                      <div className="version-content">
                        <h4>Version Data (Language: {currentLanguage}):</h4>
                        <div className="version-data">
                          {renderVersionData(versionData, objectType)}
                        </div>
                        {Object.keys(version.data).length > 1 && (
                          <div className="version-languages">
                            <small>
                              Available in: {Object.keys(version.data).join(', ')}
                            </small>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="cancel-button">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default VersionHistoryModal;
