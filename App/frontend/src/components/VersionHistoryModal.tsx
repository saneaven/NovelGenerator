import React, { useState, useEffect } from 'react';
import { BaseModal } from './BaseModal';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { useErrorStore } from '../store/errorStore';
import type { ObjectType } from '../types/unifiedObject';
import { Scroll, Loading, Mailbox, Check, Globe, Clock, SpeechBubble, DocumentAlt } from './icons';
import { TextButton } from './TextButton';
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
  const settings = useSettingsStore.getState();
  const availableLangs = currentObject?.data ? Object.keys(currentObject.data) : [];
  const currentLanguage = availableLangs.includes(settings.settings.mainLanguage)
    ? settings.settings.mainLanguage
    : (availableLangs[0] || 'en');

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
    if (!confirm('Are you sure you want to restore this version? This will create a new version with the restored content.')) {
      return;
    }

    try {
      await store.restoreVersion(objectType, objectId, versionId);

      // Reload versions to show the new restored version
      const versionHistory = await store.getVersions(objectType, objectId);
      setVersions(versionHistory.sort((a, b) => b.number - a.number));

      // Notify parent that a version was restored
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

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      size="large"
      title={<><Scroll size="2xl" />{getTypeDisplayName(objectType)} Version History</>}
      className="version-history-modal"
      footer={
        <TextButton variant="secondary" onClick={onClose}>
          Close
        </TextButton>
      }
    >
      <div className="version-history-content">
        {loading ? (
          <div className="loading-state"><Loading size="2xl" />Loading versions...</div>
        ) : versions.length === 0 ? (
          <div className="empty-state">
            <Mailbox size="4xl" />
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
                        {isCurrentVersion && <span className="active-badge"><Check size="xs" />Latest</span>}
                        <span className="version-languages-badge">
                          <Globe size={"1em"} />
                          {Object.keys(version.data || {}).join(', ') || 'No data'}
                        </span>
                      </div>
                      <div className="version-metadata">
                        <span className="version-timestamp">
                          <Clock size="sm" />
                          {new Date(version.created_at).toLocaleString()}
                        </span>
                        <span className="version-request">
                          <SpeechBubble size="sm" />
                          {version.user_request || 'No description'}
                        </span>
                      </div>
                    </div>

                    <div className="version-actions">
                      <TextButton
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleExpandVersion(version.id)}
                      >
                        {expandedVersions.has(version.id) ? 'Hide details' : 'Show details'}
                      </TextButton>

                      {!isCurrentVersion && (
                        <TextButton
                          variant="secondary"
                          size="sm"
                          onClick={() => handleRestoreVersion(version.id)}
                        >
                          Restore
                        </TextButton>
                      )}
                    </div>
                  </div>

                  {expandedVersions.has(version.id) && (
                    <div className="version-content">
                      <h4><DocumentAlt size="md" />Version Data (Language: {currentLanguage}):</h4>
                      <div className="version-data">
                        {renderVersionData(versionData, objectType)}
                      </div>
                      {Object.keys(version.data).length > 1 && (
                        <div className="version-languages">
                          <small>
                            <Globe size="xs" />
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
    </BaseModal>
  );
};

export default VersionHistoryModal;
