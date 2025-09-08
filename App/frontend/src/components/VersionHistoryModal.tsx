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
      basicInfo: '기본 정보',
      character: '등장인물',
      organization: '조직/단체',
      location: '장소',
      lorebook: '로어북',
      outline: '아웃라인',
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
    if (confirm('이 버전을 삭제하시겠습니까?')) {
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

  const formatVersionData = (data: any) => {
    if (typeof data === 'string') return data;
    if (typeof data === 'object' && data !== null) {
      return JSON.stringify(data, null, 2);
    }
    return String(data);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content version-history-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📚 {getCategoryDisplayName(category)} 버전 히스토리</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="version-history-content">
          {versions.length === 0 ? (
            <div className="empty-state">
              <p>저장된 버전이 없습니다.</p>
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
                        <span className="version-number">버전 #{versions.length - index}</span>
                        {version.isActive && <span className="active-badge">현재 사용중</span>}
                      </div>
                      <div className="version-metadata">
                        <span className="version-timestamp">
                          {version.timestamp.toLocaleString()}
                        </span>
                        <span className="version-request">
                          요청: {version.userRequest}
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
                          복원
                        </button>
                      )}
                      
                      {versions.length > 1 && (
                        <button
                          onClick={() => handleDeleteVersion(version.versionId)}
                          className="delete-version-button"
                          disabled={version.isActive}
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  </div>

                  {expandedVersions.has(version.versionId) && (
                    <div className="version-content">
                      <h4>버전 데이터:</h4>
                      <pre className="version-data">
                        {formatVersionData(version.data)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="cancel-button">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

export default VersionHistoryModal;