import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ToggleSwitch from '../../../components/ToggleSwitch';
import TextButton from '../../../components/TextButton/TextButton';
import { getAssetUrl } from '../../../utils/assetUrl';
import {
  assetService,
  type ImageCleanupExecuteResponse,
  type ImageCleanupPolicy,
  type ImageCleanupPreviewResponse,
} from '../../../api/assetService';
import { useErrorStore } from '../../../store/errorStore';
import { List, Trash, Refresh } from '../../../components/icons';
import './WorkspaceConfigPanel.css';

interface WorkspaceConfigPanelProps {
  projectId: string;
}

const DEFAULT_POLICY: ImageCleanupPolicy = {
  delete_non_main_story_object_images: false,
  delete_unused_manuscript_images: true,
  keep_recent_days: 7,
  treat_reference_images_as_used: true,
};

const STORAGE_KEY_PREFIX = 'workspace_image_cleanup_policy_';

function loadPolicy(projectId: string): ImageCleanupPolicy {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${projectId}`);
    if (!raw) return DEFAULT_POLICY;
    const parsed = JSON.parse(raw) as Partial<ImageCleanupPolicy>;
    return { ...DEFAULT_POLICY, ...parsed };
  } catch {
    return DEFAULT_POLICY;
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

const WorkspaceConfigPanel: React.FC<WorkspaceConfigPanelProps> = ({ projectId }) => {
  const { showError } = useErrorStore();

  const [policy, setPolicy] = useState<ImageCleanupPolicy>(() => loadPolicy(projectId));
  const [preview, setPreview] = useState<ImageCleanupPreviewResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [lastExecute, setLastExecute] = useState<ImageCleanupExecuteResponse | null>(null);
  const [lastRebuildSummary, setLastRebuildSummary] = useState<string | null>(null);

  useEffect(() => {
    setPolicy(loadPolicy(projectId));
    setPreview(null);
    setSelectedIds(new Set());
    setLastExecute(null);
    setLastRebuildSummary(null);
  }, [projectId]);

  useEffect(() => {
    try {
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${projectId}`, JSON.stringify(policy));
    } catch {
      // ignore
    }
  }, [projectId, policy]);

  const candidates = preview?.candidates ?? [];

  const totalSelected = selectedIds.size;
  const anySelected = totalSelected > 0;

  const selectedTotalBytes = useMemo(() => {
    if (!candidates.length || !anySelected) return 0;
    let total = 0;
    for (const c of candidates) {
      if (selectedIds.has(c.asset_id)) {
        total += c.file_size ?? 0;
      }
    }
    return total;
  }, [candidates, selectedIds, anySelected]);

  const handlePreview = useCallback(async () => {
    setIsPreviewing(true);
    setLastExecute(null);
    setLastRebuildSummary(null);
    try {
      const result = await assetService.previewImageCleanup(projectId, policy);
      setPreview(result);
      setSelectedIds(new Set(result.candidates.map((c) => c.asset_id)));
    } catch (err: any) {
      console.error('Preview cleanup failed:', err);
      showError('Image Cleanup', 'Failed to preview cleanup candidates.');
    } finally {
      setIsPreviewing(false);
    }
  }, [projectId, policy, showError]);

  const handleToggleSelected = useCallback((assetId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(assetId);
      } else {
        next.delete(assetId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(candidates.map((c) => c.asset_id)));
  }, [candidates]);

  const handleSelectNone = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleExecute = useCallback(
    async (assetIds: string[]) => {
      if (!assetIds.length) return;

      const confirmText = policy.treat_reference_images_as_used
        ? `Delete ${assetIds.length} asset(s)?`
        : `Delete ${assetIds.length} asset(s) and scrub generation reference-image links?`;

      if (!window.confirm(confirmText)) return;

      setIsExecuting(true);
      setLastRebuildSummary(null);
      try {
        const result = await assetService.executeImageCleanup(projectId, {
          policy,
          asset_ids: assetIds,
        });
        setLastExecute(result);
        await handlePreview();
      } catch (err: any) {
        console.error('Execute cleanup failed:', err);
        showError('Image Cleanup', 'Failed to delete selected assets.');
      } finally {
        setIsExecuting(false);
      }
    },
    [projectId, policy, showError, handlePreview]
  );

  const handleRebuildIndex = useCallback(async () => {
    if (!window.confirm('Rebuild manuscript image index from last saved doc?')) return;
    setIsRebuilding(true);
    setLastExecute(null);
    try {
      const result = await assetService.rebuildManuscriptImagesIndex(projectId);
      setLastRebuildSummary(
        `Rebuilt: manuscripts=${result.manuscripts_processed}, languages=${result.languages_processed}, images_inserted=${result.images_inserted}, unresolved_refs=${result.unresolved_refs}`
      );
    } catch (err: any) {
      console.error('Rebuild index failed:', err);
      showError('Image Cleanup', 'Failed to rebuild manuscript image index.');
    } finally {
      setIsRebuilding(false);
    }
  }, [projectId, showError]);

  return (
    <div className="workspace-config-panel">
      <div className="workspace-config-card">
        <h2>Config</h2>
        <p className="workspace-config-hint">
          Image cleanup uses the last manual-save state. Autosaved (local) edits are not reflected until you save.
        </p>
      </div>

      <div className="workspace-config-card">
        <h3>Image Cleanup Policy</h3>

        <div className="workspace-config-form">
          <div className="workspace-config-field">
            <label>Keep Recent (days)</label>
            <div className="workspace-config-input-with-suffix">
              <input
                type="number"
                min="0"
                step="1"
                value={policy.keep_recent_days}
                onChange={(e) =>
                  setPolicy((prev) => ({
                    ...prev,
                    keep_recent_days: Math.max(0, parseInt(e.target.value || '0', 10)),
                  }))
                }
                className="workspace-config-number-input"
              />
              <span className="workspace-config-suffix">days</span>
            </div>
            <p className="workspace-config-hint">Assets created within this window are excluded (0 disables).</p>
          </div>

          <div className="workspace-config-field">
            <ToggleSwitch
              checked={policy.delete_unused_manuscript_images}
              onChange={(checked) => setPolicy((prev) => ({ ...prev, delete_unused_manuscript_images: checked }))}
              label="Delete unused scene assets (not referenced in manuscripts)"
              icon={<Trash size="sm" />}
            />
          </div>

          <div className="workspace-config-field">
            <ToggleSwitch
              checked={policy.delete_non_main_story_object_images}
              onChange={(checked) =>
                setPolicy((prev) => ({ ...prev, delete_non_main_story_object_images: checked }))
              }
              label="Delete non-main story object images (if not used in manuscripts)"
              icon={<Trash size="sm" />}
            />
          </div>

          <div className="workspace-config-field">
            <ToggleSwitch
              checked={policy.treat_reference_images_as_used}
              onChange={(checked) => setPolicy((prev) => ({ ...prev, treat_reference_images_as_used: checked }))}
              label="Treat generation reference images as used (block deletion)"
              icon={<List size="sm" />}
            />
            {!policy.treat_reference_images_as_used && (
              <p className="workspace-config-warning">
                If disabled, deleting an asset will remove its ID from other assets&apos; generation reference images.
              </p>
            )}
          </div>
        </div>

        <div className="workspace-config-actions">
          <TextButton
            onClick={handlePreview}
            variant="primary"
            size="sm"
            iconLeft={<List size="xs" />}
            loading={isPreviewing}
          >
            Preview
          </TextButton>
          <TextButton
            onClick={handleRebuildIndex}
            variant="secondary"
            size="sm"
            iconLeft={<Refresh size="xs" />}
            loading={isRebuilding}
          >
            Rebuild Manuscript Index
          </TextButton>
        </div>

        {lastRebuildSummary && <div className="workspace-config-result">{lastRebuildSummary}</div>}
      </div>

      <div className="workspace-config-card">
        <h3>Preview</h3>

        <div className="workspace-config-preview-summary">
          <div>
            Candidates: <strong>{preview?.total_candidates ?? 0}</strong>
            {preview && (
              <>
                {' '}
                • Total size: <strong>{formatBytes(preview.total_size_bytes)}</strong>
              </>
            )}
          </div>
          <div>
            Selected: <strong>{totalSelected}</strong> • Size: <strong>{formatBytes(selectedTotalBytes)}</strong>
          </div>
        </div>

        <div className="workspace-config-actions">
          <TextButton onClick={handleSelectAll} size="sm" variant="secondary" disabled={!candidates.length}>
            Select All
          </TextButton>
          <TextButton onClick={handleSelectNone} size="sm" variant="secondary" disabled={!candidates.length}>
            Select None
          </TextButton>
          <TextButton
            onClick={() => handleExecute(Array.from(selectedIds))}
            size="sm"
            variant="danger"
            iconLeft={<Trash size="xs" />}
            disabled={!anySelected || isExecuting}
            loading={isExecuting}
          >
            Delete Selected
          </TextButton>
        </div>

        {lastExecute && (
          <div className="workspace-config-result">
            Deleted: {lastExecute.deleted.length}
            {lastExecute.scrubbed_reference_entries > 0 && (
              <> • Scrubbed refs: {lastExecute.scrubbed_reference_entries}</>
            )}
            {lastExecute.skipped.length > 0 && <> • Skipped: {lastExecute.skipped.length}</>}
            {lastExecute.errors.length > 0 && <> • Errors: {lastExecute.errors.length}</>}
          </div>
        )}

        {candidates.length === 0 ? (
          <div className="workspace-config-empty">No candidates. Click Preview to refresh.</div>
        ) : (
          <ul className="workspace-config-candidate-list">
            {candidates.map((c) => {
              const checked = selectedIds.has(c.asset_id);
              return (
                <li key={c.asset_id} className="workspace-config-candidate-item">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => handleToggleSelected(c.asset_id, e.target.checked)}
                  />
                  <img
                    className="workspace-config-thumb"
                    src={getAssetUrl(c, 'thumbnail') || ''}
                    alt={c.name}
                    loading="lazy"
                  />
                  <div className="workspace-config-candidate-meta">
                    <div className="workspace-config-candidate-title">{c.name}</div>
                    <div className="workspace-config-candidate-sub">
                      {c.asset_type ?? 'uncategorized'}
                      {c.file_size !== null && <> • {formatBytes(c.file_size)}</>}
                      {c.reasons.length > 0 && <> • {c.reasons.join(', ')}</>}
                      {c.referenced_by_count > 0 && (
                        <> • referenced_by={c.referenced_by_count}</>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default WorkspaceConfigPanel;
