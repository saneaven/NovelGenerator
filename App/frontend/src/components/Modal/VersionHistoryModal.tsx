import React, { useState, useEffect } from 'react';
import { BaseModal } from '../BaseModal';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useErrorStore } from '../../store/errorStore';
import type { ObjectType } from '../../types/unifiedObject';
import { docToMarkdown } from '../../editor/manuscript/convert';
import { Scroll, Loading, Mailbox, Check, Globe, Clock, SpeechBubble, DocumentAlt } from '../icons';
import { TextButton } from '../TextButton';
import './VersionHistoryModal.css';

// Unified type for text-based version history (prompts and fragments)
export interface TextVersionHistoryItem {
  version_number: number;
  created_at: string;
  note: string | null;
  preview: string;
}

interface VersionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestoreVersion?: () => void;

  // Story object mode (existing)
  objectType?: ObjectType;
  objectId?: string;

  // Text version mode (new) - for prompts AND fragments
  textVersionProps?: {
    title: string;
    loadVersions: () => Promise<TextVersionHistoryItem[]>;
    restoreVersion: (versionNumber: number) => Promise<void>;
  };
}

const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  isOpen,
  onClose,
  onRestoreVersion,
  objectType,
  objectId,
  textVersionProps,
}) => {
  const store = useUnifiedObjectStore();
  const { showError } = useErrorStore();
  const [versions, setVersions] = useState<any[]>([]);
  const [textVersions, setTextVersions] = useState<TextVersionHistoryItem[]>([]);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Determine mode
  const mode = objectType && objectId ? 'story' : 'text';

  useEffect(() => {
    const loadVersions = async () => {
      if (!isOpen) return;

      setLoading(true);
      try {
        if (mode === 'story' && objectId) {
          const versionHistory = await store.getVersions(objectType!, objectId);
          setVersions(versionHistory.sort((a, b) => b.number - a.number));
        } else if (mode === 'text' && textVersionProps) {
          const history = await textVersionProps.loadVersions();
          setTextVersions(history);
          // Auto-select the latest version (first in the list, which is sorted descending)
          if (history.length > 0) {
            setSelectedVersion(history[0].version_number);
          }
        }
      } catch (error) {
        console.error('Failed to load versions:', error);
        showError('Load Error', 'Failed to load version history. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    loadVersions();
  }, [isOpen, objectId, objectType, mode]);

  // Story mode helpers
  const currentObject = mode === 'story' ? store.objects[objectId!] : null;
  const mainLanguage = useSettingsStore((state) => state.getSettings().mainLanguage);
  const availableLangs = currentObject?.data ? Object.keys(currentObject.data) : [];
  const currentLanguage = availableLangs.includes(mainLanguage)
    ? mainLanguage
    : (availableLangs[0] || 'en');

  const getTypeDisplayName = (type: ObjectType): string => {
    const names: Record<ObjectType, string> = {
      basic_info: 'Basic Info',
      character: 'Character',
      organization: 'Organization',
      location: 'Location',
      lorebook: 'Lorebook',
      outline: 'Outline',
      act: 'Act',
      chapter: 'Chapter',
      manuscript: 'Manuscript',
      guidelines: 'Guidelines',
    };
    return names[type] || type;
  };

  // Story mode restore
  const handleRestoreStoryVersion = async (versionId: string) => {
    if (!confirm('Are you sure you want to restore this version? This will create a new version with the restored content.')) {
      return;
    }

    try {
      await store.restoreVersion(objectType!, objectId!, versionId);
      const versionHistory = await store.getVersions(objectType!, objectId!);
      setVersions(versionHistory.sort((a, b) => b.number - a.number));
      onRestoreVersion?.();
    } catch (error) {
      console.error('Failed to restore version:', error);
      showError('Restore Error', 'Failed to restore version. Please try again.');
    }
  };

  // Text mode restore
  const handleRestoreTextVersion = async (versionNumber: number) => {
    if (!confirm(`Are you sure you want to restore version ${versionNumber}? This will create a new version with the restored content.`)) {
      return;
    }

    setIsRestoring(true);
    try {
      await textVersionProps!.restoreVersion(versionNumber);
      onRestoreVersion?.();
      onClose();
    } catch (error) {
      console.error('Failed to restore version:', error);
      showError('Restore Error', 'Failed to restore version. Please try again.');
    } finally {
      setIsRestoring(false);
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

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const renderVersionData = (data: any, type: ObjectType) => {
    if (!data || typeof data !== 'object') {
      return <div className="version-data-simple">{String(data)}</div>;
    }

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

    if (type === 'manuscript') {
      const rawDoc = (data as any).doc;
      const preview = typeof rawDoc === 'object' && rawDoc
        ? docToMarkdown(rawDoc)
        : '';

      return (
        <div className="version-data-formatted">
          <div className="data-field">
            <label>Content:</label>
            <span className="content-preview">
              {preview.substring(0, 200)}
              {preview.length > 200 ? '...' : ''}
            </span>
          </div>
        </div>
      );
    }

    return (
      <div className="version-data-json">
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </div>
    );
  };

  // Text mode selected version data
  const selectedVersionData = textVersions.find(v => v.version_number === selectedVersion);

  // Render text mode content (sidebar + preview)
  const renderTextModeContent = () => {
    if (loading) {
      return <div className="loading-state"><Loading size="2xl" />Loading versions...</div>;
    }

    if (textVersions.length === 0) {
      return (
        <div className="empty-state">
          <Mailbox size="4xl" />
          <p>No version history available</p>
        </div>
      );
    }

    return (
      <div className="history-layout">
        {/* Version List Sidebar */}
        <aside className="history-list">
          <h4 className="history-list__title">Versions ({textVersions.length})</h4>
          <div className="history-list__items">
            {textVersions.map((version, index) => (
              <div
                key={version.version_number}
                className={`history-item ${index === 0 ? 'history-item--active' : ''} ${
                  selectedVersion === version.version_number ? 'history-item--selected' : ''
                }`}
                onClick={() => setSelectedVersion(version.version_number)}
              >
                <div className="history-item__header">
                  <span className="history-item__number">v{version.version_number}</span>
                  <div className="history-item__badges">
                    {index === 0 && <span className="badge badge--active">Active</span>}
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
                {selectedVersion !== textVersions[0]?.version_number && (
                  <TextButton
                    variant="primary"
                    size="sm"
                    onClick={() => handleRestoreTextVersion(selectedVersionData.version_number)}
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
    );
  };

  // Render story mode content (timeline)
  const renderStoryModeContent = () => {
    if (loading) {
      return <div className="loading-state"><Loading size="2xl" />Loading versions...</div>;
    }

    if (versions.length === 0) {
      return (
        <div className="empty-state">
          <Mailbox size="4xl" />
          <p>No saved versions.</p>
        </div>
      );
    }

    return (
      <div className="versions-list">
        {versions.map((version) => {
          const isCurrentVersion = currentObject?.version.id === version.id;
          const versionData = version.data[currentLanguage] || Object.values(version.data)[0] || {};

          return (
            <div
              key={version.id}
              className={`version-item ${isCurrentVersion ? 'active' : ''}`}
            >
              {/* Timeline Indicator Section */}
              <div className="version-indicator">
                <div className="indicator-dot">
                  {isCurrentVersion && <Check size="xs" />}
                </div>
                <div className="indicator-line"></div>
              </div>

              {/* Main Content Section */}
              <div className="version-main">
                <div className="version-header">
                  <div className="version-info">
                    <div className="version-title-row">
                      <span className="version-number">Version {version.number}</span>
                      {isCurrentVersion && <span className="badge badge--active">Current</span>}
                      <span className="version-languages-badge">
                        <Globe size="xs" />
                        {Object.keys(version.data || {}).join(', ') || 'No data'}
                      </span>

                      <div className="version-actions">
                        <TextButton
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleExpandVersion(version.id)}
                        >
                        {expandedVersions.has(version.id) ? 'Collapse' : 'Details'}
                        </TextButton>

                        {!isCurrentVersion && (
                        <TextButton
                            variant="secondary"
                            size="sm"
                            onClick={() => handleRestoreStoryVersion(version.id)}
                        >
                            Restore
                        </TextButton>
                        )}
                      </div>
                    </div>
                    
                    <div className="version-meta-row">
                      <span className="meta-item">
                        <Clock size="sm" />
                        {new Date(version.created_at).toLocaleString()}
                      </span>
                      {version.user_request && (
                        <span className="meta-item request-info">
                          <SpeechBubble size="sm" />
                          {version.user_request}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {expandedVersions.has(version.id) && (
                  <div className="version-content">
                    <div className="content-header">
                        <DocumentAlt size="md" />
                        <span>Data Preview ({currentLanguage})</span>
                    </div>
                    <div className="version-data">
                      {renderVersionData(versionData, objectType!)}
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
            </div>
          );
        })}
      </div>
    );
  };

  // Determine title
  const modalTitle = mode === 'story'
    ? <><Scroll size="2xl" />{getTypeDisplayName(objectType!)} Version History</>
    : <><Scroll size="2xl" />{textVersionProps?.title || 'Version History'}</>;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      size="large"
      title={modalTitle}
      className={`version-history-modal ${mode === 'text' ? 'version-history-modal--text' : ''}`}
      footer={
        <TextButton variant="secondary" onClick={onClose}>
          Close
        </TextButton>
      }
    >
      <div className="version-history-content">
        {mode === 'story' ? renderStoryModeContent() : renderTextModeContent()}
      </div>
    </BaseModal>
  );
};

export default VersionHistoryModal;
