import React, { useState, useEffect } from 'react';
import { useStoryObjectStore } from '../store/storyObjectStore';
import type { ObjectVersion, StoryObjectCategory } from '../types/storyObject';

interface VersionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  category: StoryObjectCategory;
  targetId: string;
  onRestoreVersion: (versionData: any) => void;
}

const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  isOpen,
  onClose,
  projectId,
  category,
  targetId,
  onRestoreVersion,
}) => {
  const storyObjectStore = useStoryObjectStore();
  const [versions, setVersions] = useState<ObjectVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen && targetId) {
      const itemVersions = storyObjectStore.getVersions(projectId, category, targetId);
      setVersions(itemVersions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
      
      // Set active version as selected by default
      const activeVersion = itemVersions.find(v => v.isActive);
      if (activeVersion) {
        setSelectedVersionId(activeVersion.versionId);
      }
    }
  }, [isOpen, projectId, category, targetId, storyObjectStore]);

  const getCategoryDisplayName = (cat: StoryObjectCategory): string => {
    const names = {
      basicInfo: 'Basic Info',
      character: 'Character',
      organization: 'Organization',
      location: 'Location',
      lorebook: 'Lorebook',
      outline: 'Outline',
      act: 'Act',
      chapter: 'Chapter',
    };
    return names[cat] || cat;
  };

  const handleSetActiveVersion = (versionId: string) => {
    storyObjectStore.setActiveVersion(projectId, category, targetId, versionId);
    const version = versions.find(v => v.versionId === versionId);
    if (version) {
      onRestoreVersion(version.data);
    }
    onClose();
  };

  const handleDeleteVersion = (versionId: string) => {
    if (confirm('Are you sure you want to delete this version?')) {
      storyObjectStore.deleteVersion(projectId, category, targetId, versionId);
      const updatedVersions = storyObjectStore.getVersions(projectId, category, targetId);
      setVersions(updatedVersions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
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

  const renderVersionData = (data: any, category: StoryObjectCategory) => {
    if (!data || typeof data !== 'object') {
      return <div className="version-data-simple">{String(data)}</div>;
    }

    // For basic info
    if (category === 'basicInfo') {
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

    // For outline
    if (category === 'outline') {
      return (
        <div className="version-data-formatted">
          {data.acts && data.acts.length > 0 ? (
            <div className="outline-structure">
              <h4>Acts ({data.acts.length}):</h4>
              {data.acts.map((act: any, actIndex: number) => (
                <div key={actIndex} className="act-item">
                  <div className="act-header">
                    <strong>Act {actIndex + 1}: {act.name || 'Unnamed Act'}</strong>
                  </div>
                  {act.description && (
                    <div className="act-description">{act.description}</div>
                  )}
                  {act.chapters && act.chapters.length > 0 && (
                    <div className="chapters-list">
                      <strong>Chapters ({act.chapters.length}):</strong>
                      {act.chapters.map((chapter: any, chapterIndex: number) => (
                        <div key={chapterIndex} className="chapter-item">
                          <div className="chapter-name">Chapter {chapterIndex + 1}: {chapter.name || 'Unnamed Chapter'}</div>
                          {chapter.description && (
                            <div className="chapter-description">{chapter.description}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-outline">No acts defined</div>
          )}
        </div>
      );
    }

    // For name-description objects (character, organization, location, lorebook)
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
          <h2>📚 {getCategoryDisplayName(category)} Version History</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="version-history-content">
          {versions.length === 0 ? (
            <div className="empty-state">
              <p>No saved versions.</p>
            </div>
          ) : (
            <div className="versions-list">
              {versions.map((version, index) => (
                <div 
                  key={version.versionId} 
                  className={`version-item ${version.isActive ? 'active' : ''} ${
                    selectedVersionId === version.versionId ? 'selected' : ''
                  }`}
                >
                  <div className="version-header">
                    <div className="version-info">
                      <div className="version-title">
                        <span className="version-number">Version #{versions.length - index}</span>
                        {version.isActive && <span className="active-badge">Currently Active</span>}
                      </div>
                      <div className="version-metadata">
                        <span className="version-timestamp">
                          {version.timestamp.toLocaleString()}
                        </span>
                        <span className="version-request">
                          Request: {version.userRequest}
                        </span>
                      </div>
                    </div>

                    <div className="version-actions">
                      <button
                        onClick={() => toggleExpandVersion(version.versionId)}
                        className="expand-button"
                      >
                        {expandedVersions.has(version.versionId) ? '▼' : '▶'}
                      </button>
                      
                      {!version.isActive && (
                        <button
                          onClick={() => handleSetActiveVersion(version.versionId)}
                          className="restore-button"
                        >
                          Restore
                        </button>
                      )}
                      
                      {versions.length > 1 && (
                        <button
                          onClick={() => handleDeleteVersion(version.versionId)}
                          className="delete-version-button"
                          disabled={version.isActive}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  {expandedVersions.has(version.versionId) && (
                    <div className="version-content">
                      <h4>Version Data:</h4>
                      <div className="version-data">
                        {renderVersionData(version.data, category)}
                      </div>
                    </div>
                  )}
                </div>
              ))}
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