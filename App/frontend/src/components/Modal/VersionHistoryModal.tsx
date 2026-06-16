import React, { useState, useEffect } from 'react';
import { BaseModal } from '../BaseModal';
import { unifiedObjectService } from '../../api/unifiedObjectService';
import { useRestoreVersionMutation } from '../../data/objects/mutations/useRestoreVersionMutation';
import { useObjectQuery } from '../../data/objects/useObjectQuery';
import { useSettingsStore } from '../../store/settingsStore';
import type { ObjectType } from '../../types/unifiedObject';
import { Scroll, Loading, Mailbox, Check, Globe, Clock, SpeechBubble, DocumentAlt } from '../icons';
import { TextButton } from '../TextButton';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { confirm, alert as showAlert } from '../../store/dialogStore';
import { formatBasicInfoList, normalizeBasicInfoData } from '../../utils/basicInfo';
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
    // Optional: lazy-load full content for a specific version on selection.
    // When provided, loadVersions can return an empty preview and content
    // is fetched only when the user actually clicks a version.
    loadVersionContent?: (versionNumber: number) => Promise<string>;
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
  const restoreVersionMutation = useRestoreVersionMutation();
  const [versions, setVersions] = useState<any[]>([]);
  const [textVersions, setTextVersions] = useState<TextVersionHistoryItem[]>([]);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());
  // Lazy-loaded full version content, keyed by version id (story mode only)
  const [versionContent, setVersionContent] = useState<Record<string, Record<string, Record<string, any>>>>({});
  const [loadingVersionIds, setLoadingVersionIds] = useState<Set<string>>(new Set());
  // Lazy-loaded text-mode preview content, keyed by version_number
  const [textVersionContent, setTextVersionContent] = useState<Record<number, string>>({});
  const [loadingTextVersions, setLoadingTextVersions] = useState<Set<number>>(new Set());
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
          // Metadata-only fetch — full content is lazy-loaded on Details expand
          const versionHistory = await unifiedObjectService.getVersions(objectType!, objectId);
          setVersions(versionHistory.sort((a, b) => b.number - a.number));
          setVersionContent({});
          setExpandedVersions(new Set());
        } else if (mode === 'text' && textVersionProps) {
          const history = await textVersionProps.loadVersions();
          setTextVersions(history);
          setTextVersionContent({});
          // Auto-select the latest version (first in the list, which is sorted descending)
          if (history.length > 0) {
            setSelectedVersion(history[0].version_number);
          } else {
            setSelectedVersion(null);
          }
        }
      } catch (error) {
        console.error('Failed to load versions:', error);
        showAlert({ title: 'Load Error', message: 'Failed to load version history. Please try again.' });
      } finally {
        setLoading(false);
      }
    };

    loadVersions();
  }, [isOpen, objectId, objectType, mode]);

  // Lazy-load text-mode version content when the user selects a version
  useEffect(() => {
    if (mode !== 'text' || !textVersionProps?.loadVersionContent) return;
    if (selectedVersion === null) return;
    if (textVersionContent[selectedVersion] !== undefined) return;
    if (loadingTextVersions.has(selectedVersion)) return;

    const versionNumber = selectedVersion;
    const loader = textVersionProps.loadVersionContent;
    setLoadingTextVersions((prev) => {
      const next = new Set(prev);
      next.add(versionNumber);
      return next;
    });
    loader(versionNumber)
      .then((content) => {
        setTextVersionContent((prev) => ({ ...prev, [versionNumber]: content }));
      })
      .catch((error) => {
        console.error('Failed to load version content:', error);
        showAlert({ title: 'Load Error', message: 'Failed to load version content. Please try again.' });
      })
      .finally(() => {
        setLoadingTextVersions((prev) => {
          const next = new Set(prev);
          next.delete(versionNumber);
          return next;
        });
      });
  }, [mode, selectedVersion, textVersionProps, textVersionContent, loadingTextVersions]);

  // Story mode helpers
  const mainLanguage = useSettingsStore((state) => state.getSettings().mainLanguage);
  const currentObjectQuery = useObjectQuery(objectType ?? 'basic_info', mode === 'story' ? objectId : undefined, mainLanguage);
  const currentObject = mode === 'story' ? currentObjectQuery.data ?? null : null;
  const availableLangs = currentObject?.language_state?.available_languages ?? [];
  const currentLanguage = availableLangs.includes(mainLanguage)
    ? mainLanguage
    : (availableLangs[0] || 'en');

  const getTypeDisplayName = (type: ObjectType, kind?: string): string => {
    const names: Record<ObjectType, string> = {
      basic_info: 'Basic Info',
      story_entity_folder: 'Story Entity Folder',
      story_entity: 'Story Entity',
      outline: 'Outline',
      manuscript: 'Manuscript',
      guidelines: 'Guidelines',
      timeline_track: 'Timeline Track',
      timeline_event: 'Timeline Event',
    };
    if (type === 'outline') {
      if (kind === 'act') return 'Act';
      if (kind === 'chapter') return 'Chapter';
    }
    return names[type] || type;
  };

  // Story mode restore
  const handleRestoreStoryVersion = async (versionId: string) => {
    const confirmed = await confirm({
      title: 'Restore Version',
      message: 'Are you sure you want to restore this version? This will create a new version with the restored content.',
      variant: 'warning',
      confirmLabel: 'Restore',
    });
    if (!confirmed) {
      return;
    }

    try {
      await restoreVersionMutation.mutateAsync({ type: objectType!, id: objectId!, versionId });
      const versionHistory = await unifiedObjectService.getVersions(objectType!, objectId!);
      setVersions(versionHistory.sort((a, b) => b.number - a.number));
      setVersionContent({});
      setExpandedVersions(new Set());
      onRestoreVersion?.();
    } catch (error) {
      console.error('Failed to restore version:', error);
      showAlert({ title: 'Restore Error', message: 'Failed to restore version. Please try again.' });
    }
  };

  // Text mode restore
  const handleRestoreTextVersion = async (versionNumber: number) => {
    const confirmed = await confirm({
      title: 'Restore Version',
      message: `Are you sure you want to restore version ${versionNumber}? This will create a new version with the restored content.`,
      variant: 'warning',
      confirmLabel: 'Restore',
    });
    if (!confirmed) {
      return;
    }

    setIsRestoring(true);
    try {
      await textVersionProps!.restoreVersion(versionNumber);
      onRestoreVersion?.();
      onClose();
    } catch (error) {
      console.error('Failed to restore version:', error);
      showAlert({ title: 'Restore Error', message: 'Failed to restore version. Please try again.' });
    } finally {
      setIsRestoring(false);
    }
  };

  const toggleExpandVersion = async (versionId: string) => {
    const newExpanded = new Set(expandedVersions);
    if (newExpanded.has(versionId)) {
      newExpanded.delete(versionId);
      setExpandedVersions(newExpanded);
      return;
    }
    newExpanded.add(versionId);
    setExpandedVersions(newExpanded);

    // Lazy-load full content for this version on first expand
    if (mode === 'story' && objectType && objectId && !versionContent[versionId]) {
      setLoadingVersionIds((prev) => {
        const next = new Set(prev);
        next.add(versionId);
        return next;
      });
      try {
        const full = await unifiedObjectService.getVersion(objectType, objectId, versionId);
        if (full.data) {
          setVersionContent((prev) => ({ ...prev, [versionId]: full.data! }));
        }
      } catch (error) {
        console.error('Failed to load version content:', error);
        showAlert({ title: 'Load Error', message: 'Failed to load version content. Please try again.' });
      } finally {
        setLoadingVersionIds((prev) => {
          const next = new Set(prev);
          next.delete(versionId);
          return next;
        });
      }
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const richMarkdownForType = (data: Record<string, unknown>, type: ObjectType): string | undefined => {
    if (type === 'guidelines') {
      return typeof data.authorNote === 'string' && data.authorNote.trim() ? data.authorNote : undefined;
    }
    if (type === 'story_entity' || type === 'outline' || type === 'manuscript') {
      return typeof data.content === 'string' && data.content.trim() ? data.content : undefined;
    }
    return undefined;
  };

  const renderVersionData = (data: any, type: ObjectType) => {
    if (!data || typeof data !== 'object') {
      return <div className="version-data-simple">{String(data)}</div>;
    }

    if (type === 'basic_info') {
      const basicInfo = normalizeBasicInfoData(data);
      return (
        <div className="version-data-formatted">
          <div className="data-field">
            <label>Title:</label>
            <span>{basicInfo.title || 'Not set'}</span>
          </div>
          <div className="data-field">
            <label>Logline:</label>
            <span>{basicInfo.logline || 'Not set'}</span>
          </div>
          <div className="data-field">
            <label>Genres:</label>
            <span>{formatBasicInfoList(basicInfo.genres) || 'Not set'}</span>
          </div>
          <div className="data-field">
            <label>Tags:</label>
            <span>{formatBasicInfoList(basicInfo.tags) || 'Not set'}</span>
          </div>
        </div>
      );
    }

    const richMarkdown = richMarkdownForType(data as Record<string, unknown>, type);

    if (type === 'guidelines') {
      return (
        <div className="version-data-formatted">
          <div className="data-field data-field--stacked">
            <label>Author Note:</label>
            {richMarkdown ? (
              <div className="version-data-markdown-shell">
                <MarkdownRenderer className="markdown-content version-data-markdown">
                  {richMarkdown}
                </MarkdownRenderer>
              </div>
            ) : (
              <span>Not set</span>
            )}
          </div>
        </div>
      );
    }

    if (type === 'story_entity' || type === 'outline') {
      return (
        <div className="version-data-formatted">
          <div className="data-field">
            <label>Name:</label>
            <span>{typeof data.name === 'string' && data.name.trim() ? data.name : 'Not set'}</span>
          </div>
          <div className="data-field">
            <label>Description:</label>
            <span className="description-text">{typeof data.description === 'string' && data.description.trim() ? data.description : 'Not set'}</span>
          </div>
          {richMarkdown && (
            <div className="data-field data-field--stacked">
              <label>Content:</label>
              <div className="version-data-markdown-shell">
                <MarkdownRenderer className="markdown-content version-data-markdown">
                  {richMarkdown}
                </MarkdownRenderer>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (type === 'manuscript') {
      return (
        <div className="version-data-formatted">
          <div className="data-field data-field--stacked">
            <label>Content:</label>
            {richMarkdown ? (
              <div className="version-data-markdown-shell">
                <MarkdownRenderer className="markdown-content version-data-markdown">
                  {richMarkdown}
                </MarkdownRenderer>
              </div>
            ) : (
              <span>Not set</span>
            )}
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
                {loadingTextVersions.has(selectedVersionData.version_number) ? (
                  <div className="loading-state"><Loading size="lg" />Loading content...</div>
                ) : (
                  <pre>
                    {textVersionContent[selectedVersionData.version_number] ??
                      selectedVersionData.preview}
                  </pre>
                )}
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
          // languages from metadata-only response.
          const versionLanguages: string[] = version.languages ?? [];
          const fullData = versionContent[version.id];
          const isExpanded = expandedVersions.has(version.id);
          const isContentLoading = loadingVersionIds.has(version.id);
          const versionData =
            (fullData && (fullData[currentLanguage] || Object.values(fullData)[0])) || {};

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
                        {versionLanguages.join(', ') || 'No data'}
                      </span>

                      <div className="version-actions">
                        <TextButton
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleExpandVersion(version.id)}
                        >
                        {isExpanded ? 'Collapse' : 'Details'}
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

                {isExpanded && (
                  <div className="version-content">
                    <div className="content-header">
                        <DocumentAlt size="md" />
                        <span>Data Preview ({currentLanguage})</span>
                    </div>
                    <div className="version-data">
                      {isContentLoading ? (
                        <div className="loading-state"><Loading size="lg" />Loading content...</div>
                      ) : fullData ? (
                        renderVersionData(versionData, objectType!)
                      ) : (
                        <div className="empty-state"><p>No content available.</p></div>
                      )}
                    </div>
                    {versionLanguages.length > 1 && (
                      <div className="version-languages">
                        <small>
                          <Globe size="xs" />
                          Available in: {versionLanguages.join(', ')}
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
    ? <><Scroll size="2xl" />{getTypeDisplayName(objectType!, currentObject?.kind)} Version History</>
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
