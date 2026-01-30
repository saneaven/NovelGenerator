import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ToggleSwitch from '../../../components/common/ToggleSwitch';
import TextButton from '../../../components/TextButton/TextButton';
import { getAssetUrl } from '../../../utils/assetUrl';
import {
  assetService,
  type ImageCleanupExecuteResponse,
  type ImageCleanupPolicy,
  type ImageCleanupPreviewResponse,
} from '../../../api/assetService';
import {
  projectService,
  type ProjectExportOptions,
  type ProjectExportPreviewResponse,
  type ProjectExportPreviewAssetItem,
} from '../../../api/projectService';
import { ragService, type RagProjectStatusResponse } from '../../../api/ragService';
import { useErrorStore } from '../../../store/errorStore';
import { useCredentialsStore } from '../../../store/credentialsStore';
import { List, Trash, Refresh, Download } from '../../../components/icons';
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
const EXPORT_STORAGE_KEY_PREFIX = 'workspace_project_export_options_';

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

const DEFAULT_EXPORT_OPTIONS: ProjectExportOptions = {
  include_images: true,
  image_scope: 'used_only',
  include_non_main_story_object_images: false,
  treat_generation_reference_images_as_used: true,
};

function loadExportOptions(projectId: string): ProjectExportOptions {
  try {
    const raw = localStorage.getItem(`${EXPORT_STORAGE_KEY_PREFIX}${projectId}`);
    if (!raw) return DEFAULT_EXPORT_OPTIONS;
    const parsed = JSON.parse(raw) as Partial<ProjectExportOptions>;
    return { ...DEFAULT_EXPORT_OPTIONS, ...parsed };
  } catch {
    return DEFAULT_EXPORT_OPTIONS;
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
  const { t } = useTranslation();
  const { showError } = useErrorStore();
  const credentials = useCredentialsStore((state) => state.credentials);

  const [policy, setPolicy] = useState<ImageCleanupPolicy>(() => loadPolicy(projectId));
  const [preview, setPreview] = useState<ImageCleanupPreviewResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [lastExecute, setLastExecute] = useState<ImageCleanupExecuteResponse | null>(null);
  const [lastRebuildSummary, setLastRebuildSummary] = useState<string | null>(null);

  const [exportOptions, setExportOptions] = useState<ProjectExportOptions>(() => loadExportOptions(projectId));
  const [exportPreview, setExportPreview] = useState<ProjectExportPreviewResponse | null>(null);
  const [exportSelectedIds, setExportSelectedIds] = useState<Set<string>>(new Set());
  const [isExportPreviewing, setIsExportPreviewing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [lastExportSummary, setLastExportSummary] = useState<string | null>(null);

  const [ragStatus, setRagStatus] = useState<RagProjectStatusResponse | null>(null);
  const [isRagLoading, setIsRagLoading] = useState(false);
  const [isRagReindexing, setIsRagReindexing] = useState(false);
  const [lastRagSummary, setLastRagSummary] = useState<string | null>(null);

  useEffect(() => {
    setPolicy(loadPolicy(projectId));
    setPreview(null);
    setSelectedIds(new Set());
    setLastExecute(null);
    setLastRebuildSummary(null);

    setExportOptions(loadExportOptions(projectId));
    setExportPreview(null);
    setExportSelectedIds(new Set());
    setLastExportSummary(null);
  }, [projectId]);

  useEffect(() => {
    try {
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${projectId}`, JSON.stringify(policy));
    } catch {
      // ignore
    }
  }, [projectId, policy]);

  useEffect(() => {
    try {
      localStorage.setItem(`${EXPORT_STORAGE_KEY_PREFIX}${projectId}`, JSON.stringify(exportOptions));
    } catch {
      // ignore
    }
  }, [projectId, exportOptions]);

  const loadRagStatus = useCallback(async () => {
    setIsRagLoading(true);
    try {
      const status = await ragService.getStatus(projectId);
      setRagStatus(status);
    } catch (err: any) {
      console.error('Failed to load RAG status:', err);
      setRagStatus(null);
    } finally {
      setIsRagLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadRagStatus();
  }, [loadRagStatus]);

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
        ? t('workspaceConfig.imageCleanup.deleteConfirm', { count: assetIds.length })
        : t('workspaceConfig.imageCleanup.deleteConfirmScrub', { count: assetIds.length });

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
    [projectId, policy, showError, handlePreview, t]
  );

  const handleRebuildIndex = useCallback(async () => {
    if (!window.confirm(t('workspaceConfig.imageCleanup.rebuildConfirm'))) return;
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
  }, [projectId, showError, t]);

  const exportAssets = exportPreview?.assets ?? [];
  const isExportManual = exportOptions.include_images && exportOptions.image_scope === 'manual';
  const exportAnySelected = exportSelectedIds.size > 0;

  const exportSelectedTotalBytes = useMemo(() => {
    if (!exportAssets.length || !exportAnySelected) return 0;
    let total = 0;
    for (const a of exportAssets) {
      if (exportSelectedIds.has(a.asset_id)) {
        total += a.file_size ?? 0;
      }
    }
    return total;
  }, [exportAssets, exportSelectedIds, exportAnySelected]);

  const exportSummary = useMemo(() => {
    if (!exportPreview) return null;

    const base = exportPreview.summary;
    if (!exportOptions.include_images) {
      return {
        objects: base.objects,
        assets_total: base.assets_total,
        assets_selected: 0,
        images_selected_bytes: 0,
      };
    }

    if (!isExportManual) {
      return base;
    }

    return {
      objects: base.objects,
      assets_total: base.assets_total,
      assets_selected: exportSelectedIds.size,
      images_selected_bytes: exportSelectedTotalBytes,
    };
  }, [exportPreview, exportOptions.include_images, isExportManual, exportSelectedIds.size, exportSelectedTotalBytes]);

  const handleExportPreview = useCallback(async () => {
    setIsExportPreviewing(true);
    setLastExportSummary(null);
    try {
      const result = await projectService.exportPreview(projectId, exportOptions);
      setExportPreview(result);
      setExportSelectedIds(new Set(result.default_selected_asset_ids));
    } catch (err: any) {
      console.error('Export preview failed:', err);
      showError('Project Export', 'Failed to preview project export.');
    } finally {
      setIsExportPreviewing(false);
    }
  }, [projectId, exportOptions, showError]);

  const handleExportToggleSelected = useCallback((assetId: string, checked: boolean) => {
    setExportSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(assetId);
      } else {
        next.delete(assetId);
      }
      return next;
    });
  }, []);

  const handleExportSelectAll = useCallback((assets: ProjectExportPreviewAssetItem[]) => {
    setExportSelectedIds(new Set(assets.map((a) => a.asset_id)));
  }, []);

  const handleExportSelectNone = useCallback(() => {
    setExportSelectedIds(new Set());
  }, []);

  const handleExportSelectUsed = useCallback((assets: ProjectExportPreviewAssetItem[]) => {
    setExportSelectedIds(new Set(assets.filter((a) => a.used).map((a) => a.asset_id)));
  }, []);

  const handleExportDownload = useCallback(async () => {
    setIsExporting(true);
    setLastExportSummary(null);
    try {
      let previewResult = exportPreview;
      let selected = exportSelectedIds;

      if (exportOptions.include_images && exportOptions.image_scope === 'manual' && !previewResult) {
        previewResult = await projectService.exportPreview(projectId, exportOptions);
        setExportPreview(previewResult);
        const defaultIds = new Set(previewResult.default_selected_asset_ids);
        setExportSelectedIds(defaultIds);
        selected = defaultIds;
      }

      if (exportOptions.include_images && exportOptions.image_scope === 'manual' && selected.size === 0) {
        showError('Project Export', t('workspaceConfig.projectExport.selectAtLeastOne'));
        return;
      }

      await projectService.exportDownload(projectId, {
        options: exportOptions,
        asset_ids: exportOptions.image_scope === 'manual' ? Array.from(selected) : undefined,
      });

      setLastExportSummary(t('workspaceConfig.projectExport.exportStarted'));
    } catch (err: any) {
      console.error('Export failed:', err);
      showError('Project Export', 'Failed to export project.');
    } finally {
      setIsExporting(false);
    }
  }, [exportPreview, exportSelectedIds, exportOptions, projectId, showError, t]);

  const handleRagReindex = useCallback(async () => {
    setIsRagReindexing(true);
    setLastRagSummary(null);

    try {
      if (!ragStatus?.enabled) {
        showError('RAG', 'RAG Search is disabled. Enable it in Settings > RAG Search.');
        return;
      }

      const profile = ragStatus?.profile;
      if (!profile) {
        showError('RAG', 'Embedding profile is not configured. Set it in Settings > RAG Search.');
        return;
      }

      const provider = profile.provider;
      const config: any = {};
      if (provider === 'custom') {
        config.api_key = credentials.custom?.apiKey || undefined;
        config.base_url = credentials.custom?.baseUrl || undefined;
      } else {
        config.api_key = (credentials as any)[provider]?.apiKey || undefined;
      }

      if (!config.api_key) {
        showError('RAG', `Missing API key for provider '${provider}' (Settings > Credentials).`);
        return;
      }
      if (provider === 'custom' && !config.base_url) {
        showError('RAG', 'Missing baseUrl for custom provider (Settings > Credentials).');
        return;
      }

      const res = await ragService.reindex(projectId, { config });
      setLastRagSummary(
        `Reindex complete: rebuilt ${res.rebuilt_sources}/${res.indexed_sources} (missing main_language: ${res.missing_main_language_sources}).`
      );
      await loadRagStatus();
    } catch (err: any) {
      console.error('RAG reindex failed:', err);
      showError('RAG', 'Failed to reindex project.');
    } finally {
      setIsRagReindexing(false);
    }
  }, [credentials, loadRagStatus, projectId, ragStatus?.profile, showError]);

  return (
    <div className="workspace-config-panel">
      <div className="workspace-config-card">
        <h2>{t('workspaceConfig.title')}</h2>
        <p className="workspace-config-hint">
          {t('workspaceConfig.imageCleanupHint')}
        </p>
      </div>

      <div className="workspace-config-card">
        <h3>{t('workspaceConfig.rag.title')}</h3>
        <p className="workspace-config-hint">{t('workspaceConfig.rag.hint')}</p>

        {isRagLoading ? (
          <div className="workspace-config-empty">{t('common.loading')}</div>
        ) : !ragStatus ? (
          <div className="workspace-config-empty">{t('workspaceConfig.rag.statusUnavailable')}</div>
        ) : !ragStatus.enabled ? (
          <div className="workspace-config-empty">{t('workspaceConfig.rag.disabled')}</div>
        ) : !ragStatus.profile ? (
          <div className="workspace-config-empty">{t('workspaceConfig.rag.profileMissing')}</div>
        ) : (
          <div className="workspace-config-preview-summary workspace-config-preview-summary--stack">
            <div>
              <strong>{t('workspaceConfig.rag.profile')}</strong> {ragStatus.profile.provider} / {ragStatus.profile.model}
            </div>
            <div>
              <strong>{t('workspaceConfig.rag.dimensions')}</strong> {ragStatus.profile.dimensions ?? t('workspaceConfig.rag.unknown')}
            </div>
            <div>
              <strong>{t('workspaceConfig.rag.sources')}</strong> {ragStatus.ready_sources}/{ragStatus.total_sources}
              {ragStatus.missing_main_language_sources > 0 && (
                <span> · {t('workspaceConfig.rag.missingMainLanguage', { count: ragStatus.missing_main_language_sources })}</span>
              )}
              {ragStatus.error_sources > 0 && (
                <span> · {t('workspaceConfig.rag.errors', { count: ragStatus.error_sources })}</span>
              )}
            </div>
            {ragStatus.last_indexed_at && (
              <div>
                <strong>{t('workspaceConfig.rag.lastIndexed')}</strong> {ragStatus.last_indexed_at}
              </div>
            )}
          </div>
        )}

        <div className="workspace-config-actions">
          <TextButton
            onClick={loadRagStatus}
            variant="secondary"
            size="sm"
            iconLeft={<Refresh size="xs" />}
            loading={isRagLoading}
          >
            {t('workspaceConfig.rag.refresh')}
          </TextButton>
          <TextButton
            onClick={handleRagReindex}
            variant="primary"
            size="sm"
            iconLeft={<Refresh size="xs" />}
            loading={isRagReindexing}
            disabled={!ragStatus?.enabled || !ragStatus?.profile}
          >
            {t('workspaceConfig.rag.reindex')}
          </TextButton>
        </div>

        {lastRagSummary && <div className="workspace-config-result">{lastRagSummary}</div>}
      </div>

      <div className="workspace-config-card">
        <h3>{t('workspaceConfig.projectExport.title')}</h3>
        <p className="workspace-config-hint">
          {t('workspaceConfig.projectExport.hint')}
        </p>

        <div className="workspace-config-form">
          <div className="workspace-config-field">
            <ToggleSwitch
              checked={exportOptions.include_images}
              onChange={(checked) => setExportOptions((prev) => ({ ...prev, include_images: checked }))}
              label={t('workspaceConfig.projectExport.includeImages')}
              icon={<Download size="sm" />}
            />
          </div>

          <div className="workspace-config-field">
            <label>{t('workspaceConfig.projectExport.imageScope')}</label>
            <select
              className="workspace-config-select"
              value={exportOptions.image_scope}
              onChange={(e) =>
                setExportOptions((prev) => ({
                  ...prev,
                  image_scope: e.target.value as ProjectExportOptions['image_scope'],
                }))
              }
              disabled={!exportOptions.include_images}
            >
              <option value="used_only">{t('workspaceConfig.projectExport.usedOnly')}</option>
              <option value="all">{t('workspaceConfig.projectExport.allImages')}</option>
              <option value="manual">{t('workspaceConfig.projectExport.manualSelection')}</option>
            </select>
            <p className="workspace-config-hint">
              {t('workspaceConfig.projectExport.imageScopeHint')}
            </p>
          </div>

          <div className="workspace-config-field">
            <ToggleSwitch
              checked={exportOptions.include_non_main_story_object_images}
              onChange={(checked) =>
                setExportOptions((prev) => ({ ...prev, include_non_main_story_object_images: checked }))
              }
              label={t('workspaceConfig.projectExport.includeNonMain')}
              icon={<List size="sm" />}
              disabled={!exportOptions.include_images}
            />
          </div>

          <div className="workspace-config-field">
            <ToggleSwitch
              checked={exportOptions.treat_generation_reference_images_as_used}
              onChange={(checked) =>
                setExportOptions((prev) => ({ ...prev, treat_generation_reference_images_as_used: checked }))
              }
              label={t('workspaceConfig.projectExport.includeReferenceImages')}
              icon={<List size="sm" />}
              disabled={!exportOptions.include_images}
            />
          </div>
        </div>

        <div className="workspace-config-actions">
          <TextButton
            onClick={handleExportPreview}
            variant="secondary"
            size="sm"
            iconLeft={<List size="xs" />}
            loading={isExportPreviewing}
          >
            {t('workspaceConfig.projectExport.preview')}
          </TextButton>
          <TextButton
            onClick={handleExportDownload}
            variant="primary"
            size="sm"
            iconLeft={<Download size="xs" />}
            loading={isExporting}
          >
            {t('workspaceConfig.projectExport.download')}
          </TextButton>
        </div>

        {lastExportSummary && <div className="workspace-config-result">{lastExportSummary}</div>}

        {exportPreview && exportSummary && (
          <div className="workspace-config-preview-summary workspace-config-preview-summary--stack">
            <div>
              {t('workspaceConfig.projectExport.objects')}: <strong>{exportSummary.objects}</strong> | {t('workspaceConfig.projectExport.assets')}: <strong>{exportSummary.assets_total}</strong>
            </div>
            <div>
              {t('workspaceConfig.projectExport.selectedImages')}: <strong>{exportSummary.assets_selected}</strong> | {t('workspaceConfig.projectExport.size')}:{' '}
              <strong>{formatBytes(exportSummary.images_selected_bytes)}</strong>
            </div>
          </div>
        )}

        {exportOptions.include_images && exportPreview && isExportManual && (
          <div className="workspace-config-actions">
            <TextButton onClick={() => handleExportSelectUsed(exportAssets)} size="sm" variant="secondary">
              {t('workspaceConfig.projectExport.selectUsed')}
            </TextButton>
            <TextButton onClick={() => handleExportSelectAll(exportAssets)} size="sm" variant="secondary">
              {t('workspaceConfig.projectExport.selectAll')}
            </TextButton>
            <TextButton onClick={handleExportSelectNone} size="sm" variant="secondary">
              {t('workspaceConfig.projectExport.selectNone')}
            </TextButton>
          </div>
        )}

        {!exportPreview ? (
          <div className="workspace-config-empty">{t('workspaceConfig.projectExport.noPreview')}</div>
        ) : !exportOptions.include_images ? (
          <div className="workspace-config-empty">{t('workspaceConfig.projectExport.imagesExcluded')}</div>
        ) : exportAssets.length === 0 ? (
          <div className="workspace-config-empty">{t('workspaceConfig.projectExport.noAssetsFound')}</div>
        ) : (
          <ul className="workspace-config-candidate-list">
            {exportAssets.map((a) => {
              const checked = exportSelectedIds.has(a.asset_id);
              return (
                <li key={a.asset_id} className="workspace-config-candidate-item">
                  {isExportManual && (
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => handleExportToggleSelected(a.asset_id, e.target.checked)}
                    />
                  )}
                  <img
                    className="workspace-config-thumb"
                    src={getAssetUrl(a) || ''}
                    alt={a.name}
                    loading="lazy"
                  />
                  <div className="workspace-config-candidate-meta">
                    <div className="workspace-config-candidate-title">{a.name}</div>
                    <div className="workspace-config-candidate-sub">
                      {a.asset_type ?? t('workspaceConfig.projectExport.uncategorized')}
                      {a.file_size != null && <> | {formatBytes(a.file_size)}</>}
                      {a.used && <> | {t('workspaceConfig.projectExport.used')}</>}
                      {a.reasons.length > 0 && <> | {a.reasons.join(', ')}</>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="workspace-config-card">
        <h3>{t('workspaceConfig.imageCleanup.title')}</h3>

        <div className="workspace-config-form">
          <div className="workspace-config-field">
            <label>{t('workspaceConfig.imageCleanup.keepRecentDays')}</label>
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
              <span className="workspace-config-suffix">{t('workspaceConfig.imageCleanup.days')}</span>
            </div>
            <p className="workspace-config-hint">{t('workspaceConfig.imageCleanup.keepRecentHint')}</p>
          </div>

          <div className="workspace-config-field">
            <ToggleSwitch
              checked={policy.delete_unused_manuscript_images}
              onChange={(checked) => setPolicy((prev) => ({ ...prev, delete_unused_manuscript_images: checked }))}
              label={t('workspaceConfig.imageCleanup.deleteUnusedScene')}
              icon={<Trash size="sm" />}
            />
          </div>

          <div className="workspace-config-field">
            <ToggleSwitch
              checked={policy.delete_non_main_story_object_images}
              onChange={(checked) =>
                setPolicy((prev) => ({ ...prev, delete_non_main_story_object_images: checked }))
              }
              label={t('workspaceConfig.imageCleanup.deleteNonMain')}
              icon={<Trash size="sm" />}
            />
          </div>

          <div className="workspace-config-field">
            <ToggleSwitch
              checked={policy.treat_reference_images_as_used}
              onChange={(checked) => setPolicy((prev) => ({ ...prev, treat_reference_images_as_used: checked }))}
              label={t('workspaceConfig.imageCleanup.treatReferenceAsUsed')}
              icon={<List size="sm" />}
            />
            {!policy.treat_reference_images_as_used && (
              <p className="workspace-config-warning">
                {t('workspaceConfig.imageCleanup.referenceWarning')}
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
            {t('workspaceConfig.imageCleanup.preview')}
          </TextButton>
          <TextButton
            onClick={handleRebuildIndex}
            variant="secondary"
            size="sm"
            iconLeft={<Refresh size="xs" />}
            loading={isRebuilding}
          >
            {t('workspaceConfig.imageCleanup.rebuildIndex')}
          </TextButton>
        </div>

        {lastRebuildSummary && <div className="workspace-config-result">{lastRebuildSummary}</div>}
      </div>

      <div className="workspace-config-card">
        <h3>{t('workspaceConfig.imageCleanup.preview')}</h3>

        <div className="workspace-config-preview-summary">
          <div>
            {t('workspaceConfig.imageCleanup.candidates')}: <strong>{preview?.total_candidates ?? 0}</strong>
            {preview && (
              <>
                {' '}
                • {t('workspaceConfig.imageCleanup.totalSize')}: <strong>{formatBytes(preview.total_size_bytes)}</strong>
              </>
            )}
          </div>
          <div>
            {t('workspaceConfig.imageCleanup.selected')}: <strong>{totalSelected}</strong> • {t('workspaceConfig.projectExport.size')}: <strong>{formatBytes(selectedTotalBytes)}</strong>
          </div>
        </div>

        <div className="workspace-config-actions">
          <TextButton onClick={handleSelectAll} size="sm" variant="secondary" disabled={!candidates.length}>
            {t('workspaceConfig.projectExport.selectAll')}
          </TextButton>
          <TextButton onClick={handleSelectNone} size="sm" variant="secondary" disabled={!candidates.length}>
            {t('workspaceConfig.projectExport.selectNone')}
          </TextButton>
          <TextButton
            onClick={() => handleExecute(Array.from(selectedIds))}
            size="sm"
            variant="danger"
            iconLeft={<Trash size="xs" />}
            disabled={!anySelected || isExecuting}
            loading={isExecuting}
          >
            {t('workspaceConfig.imageCleanup.deleteSelected')}
          </TextButton>
        </div>

        {lastExecute && (
          <div className="workspace-config-result">
            {t('workspaceConfig.imageCleanup.deleted')}: {lastExecute.deleted.length}
            {lastExecute.scrubbed_reference_entries > 0 && (
              <> • {t('workspaceConfig.imageCleanup.scrubbedRefs')}: {lastExecute.scrubbed_reference_entries}</>
            )}
            {lastExecute.skipped.length > 0 && <> • {t('workspaceConfig.imageCleanup.skipped')}: {lastExecute.skipped.length}</>}
            {lastExecute.errors.length > 0 && <> • {t('workspaceConfig.imageCleanup.errors')}: {lastExecute.errors.length}</>}
          </div>
        )}

        {candidates.length === 0 ? (
          <div className="workspace-config-empty">{t('workspaceConfig.imageCleanup.noCandidates')}</div>
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
                    src={getAssetUrl(c) || ''}
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
