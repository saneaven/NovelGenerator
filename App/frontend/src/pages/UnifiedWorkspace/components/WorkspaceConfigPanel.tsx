import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ToggleSwitch from '../../../components/common/ToggleSwitch';
import AuthenticatedImage from '../../../components/common/AuthenticatedImage';
import JourneyNotificationDetail from '../../../components/Notification/JourneyNotificationDetail';
import { NumberInput } from '../../../components/ui/NumberInput';
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
import { journeyService, type JourneyDTO } from '../../../api/journeyService';
import { vectorStorageService, type VectorStorageStatusResponse } from '../../../api/vectorStorageService';
import { confirm, alert as showAlert } from '../../../store/dialogStore';
import { useProject, useUpdateProjectMutation } from '../../../data/projects';
import { List, Trash, Refresh, Download } from '../../../components/icons';
import { canCancelThreadStatus, canResumeThreadStatus } from '../../../types/thread';
import './WorkspaceConfigPanel.css';

interface WorkspaceConfigPanelProps {
  projectId: string;
}

const DEFAULT_POLICY: ImageCleanupPolicy = {
  delete_non_main_object_images: false,
  delete_unused_rich_text_images: true,
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
  include_non_main_object_images: false,
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

  const project = useProject(projectId);
  const updateProjectMutation = useUpdateProjectMutation();
  const [projectName, setProjectName] = useState(project?.name ?? '');
  const [projectDescription, setProjectDescription] = useState(project?.description ?? '');
  const [isSavingInfo, setIsSavingInfo] = useState(false);
  const [savedInfo, setSavedInfo] = useState(false);

  useEffect(() => {
    setProjectName(project?.name ?? '');
    setProjectDescription(project?.description ?? '');
    setSavedInfo(false);
  }, [projectId, project?.name, project?.description]);

  const handleSaveProjectInfo = useCallback(async () => {
    if (!projectName.trim()) return;
    setIsSavingInfo(true);
    setSavedInfo(false);
    try {
      await updateProjectMutation.mutateAsync({
        id: projectId,
        updates: {
          name: projectName.trim(),
          description: projectDescription.trim() || undefined,
        },
      });
      setSavedInfo(true);
      setTimeout(() => setSavedInfo(false), 2000);
    } catch (err: any) {
      console.error('Failed to update project info:', err);
      showAlert({ title: 'Project Info', message: 'Failed to save project info.' });
    } finally {
      setIsSavingInfo(false);
    }
  }, [projectId, projectName, projectDescription, updateProjectMutation]);

  const projectInfoDirty = projectName !== (project?.name ?? '') || projectDescription !== (project?.description ?? '');

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

  const [vectorStorageStatus, setVectorStorageStatus] = useState<VectorStorageStatusResponse | null>(null);
  const [isVectorStorageLoading, setIsVectorStorageLoading] = useState(false);
  const [isVectorStorageReindexing, setIsVectorStorageReindexing] = useState(false);
  const [lastVectorStorageSummary, setLastVectorStorageSummary] = useState<string | null>(null);
  const [journeys, setJourneys] = useState<JourneyDTO[]>([]);
  const [isJourneysLoading, setIsJourneysLoading] = useState(false);
  const [isDeletingAllJourneys, setIsDeletingAllJourneys] = useState(false);
  const [selectedJourney, setSelectedJourney] = useState<JourneyDTO | null>(null);

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

  const loadJourneys = useCallback(async () => {
    setIsJourneysLoading(true);
    try {
      const rows = await journeyService.list(projectId);
      setJourneys(rows);
      return rows;
    } catch (err: any) {
      console.error('Failed to load journeys:', err);
      setJourneys([]);
      return [];
    } finally {
      setIsJourneysLoading(false);
    }
  }, [projectId]);

  const loadVectorStorageStatus = useCallback(async () => {
    setIsVectorStorageLoading(true);
    try {
      const status = await vectorStorageService.getStatus(projectId);
      setVectorStorageStatus(status);
      return status;
    } catch (err: any) {
      console.error('Failed to load vector storage status:', err);
      setVectorStorageStatus(null);
      return null;
    } finally {
      setIsVectorStorageLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadJourneys();
  }, [loadJourneys]);

  useEffect(() => {
    void loadVectorStorageStatus();
  }, [loadVectorStorageStatus]);

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
      showAlert({ title: 'Image Cleanup', message: 'Failed to preview cleanup candidates.' });
    } finally {
      setIsPreviewing(false);
    }
  }, [projectId, policy]);

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

      if (!await confirm({ title: 'Delete Images', message: confirmText, variant: 'danger', confirmLabel: 'Delete' })) return;

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
        showAlert({ title: 'Image Cleanup', message: 'Failed to delete selected assets.' });
      } finally {
        setIsExecuting(false);
      }
    },
    [projectId, policy, handlePreview, t]
  );

  const handleRebuildIndex = useCallback(async () => {
    if (!await confirm({ title: 'Rebuild Index', message: t('workspaceConfig.imageCleanup.rebuildConfirm'), variant: 'warning', confirmLabel: 'Rebuild' })) return;
    setIsRebuilding(true);
    setLastExecute(null);
    try {
      const result = await assetService.rebuildRichTextImageRefs(projectId);
      setLastRebuildSummary(
        `Rebuilt: objects=${result.objects_processed}, languages=${result.languages_processed}, refs_inserted=${result.refs_inserted}, refs_deleted=${result.refs_deleted}`
      );
    } catch (err: any) {
      console.error('Rebuild index failed:', err);
      showAlert({ title: 'Image Cleanup', message: 'Failed to rebuild rich text image refs.' });
    } finally {
      setIsRebuilding(false);
    }
  }, [projectId, t]);

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
      showAlert({ title: 'Project Export', message: 'Failed to preview project export.' });
    } finally {
      setIsExportPreviewing(false);
    }
  }, [projectId, exportOptions]);

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
        showAlert({ title: 'Project Export', message: t('workspaceConfig.projectExport.selectAtLeastOne') });
        return;
      }

      await projectService.exportDownload(projectId, {
        options: exportOptions,
        asset_ids: exportOptions.image_scope === 'manual' ? Array.from(selected) : undefined,
      });

      setLastExportSummary(t('workspaceConfig.projectExport.exportStarted'));
    } catch (err: any) {
      console.error('Export failed:', err);
      showAlert({ title: 'Project Export', message: 'Failed to export project.' });
    } finally {
      setIsExporting(false);
    }
  }, [exportPreview, exportSelectedIds, exportOptions, projectId, t]);

  const handleVectorStorageReindex = useCallback(async () => {
    setIsVectorStorageReindexing(true);
    setLastVectorStorageSummary(null);

    try {
      if (!vectorStorageStatus?.enabled) {
        showAlert({ title: 'Vector Storage', message: t('workspaceConfig.vectorStorage.disabled') });
        return;
      }

      const profile = vectorStorageStatus?.profile;
      if (!profile) {
        showAlert({ title: 'Vector Storage', message: t('workspaceConfig.vectorStorage.profileMissing') });
        return;
      }
      await vectorStorageService.reindex(projectId, {});
      const refreshed = await loadVectorStorageStatus();
      if (refreshed) {
        setLastVectorStorageSummary(
          `Vector Storage status: ${refreshed.ready_sources}/${refreshed.total_sources} searchable` +
          ` · ${refreshed.unindexed_sources} unindexed` +
          ` · ${refreshed.stale_sources} stale` +
          ` · ${refreshed.missing_main_language_sources} missing main_language` +
          ` · ${refreshed.error_sources} errors`
        );
      }
    } catch (err: any) {
      console.error('Vector storage reindex failed:', err);
      const status = typeof err?.status === 'number' ? err.status : undefined;
      const backendMessage = typeof err?.message === 'string' && err.message.length > 0
        ? err.message
        : 'Failed to reindex project.';
      const detailParts: string[] = [];
      if (status !== undefined) detailParts.push(`HTTP ${status}`);
      if (err?.data !== undefined && err?.data !== null) {
        try {
          detailParts.push(typeof err.data === 'string' ? err.data : JSON.stringify(err.data, null, 2));
        } catch {
          detailParts.push(String(err.data));
        }
      } else if (err?.stack) {
        detailParts.push(String(err.stack));
      }
      showAlert({
        title: 'Vector Storage',
        message: backendMessage,
        variant: 'danger',
        detail: detailParts.length > 0 ? detailParts.join('\n\n') : null,
      });
    } finally {
      setIsVectorStorageReindexing(false);
    }
  }, [loadVectorStorageStatus, projectId, t, vectorStorageStatus?.enabled, vectorStorageStatus?.profile]);

  const handleCancelJourney = useCallback(async (journeyId: string) => {
    if (!await confirm({
      title: t('workspaceConfig.journeys.confirmCancelTitle'),
      message: t('workspaceConfig.journeys.confirmCancelMessage'),
      variant: 'warning',
      confirmLabel: t('workspaceConfig.journeys.cancelAction'),
    })) {
      return;
    }
    try {
      await journeyService.cancel(journeyId);
      const rows = await loadJourneys();
      if (selectedJourney?.journey_id === journeyId) {
        const refreshed = rows.find((row) => row.journey_id === journeyId);
        if (refreshed) setSelectedJourney(refreshed);
      }
    } catch (err: any) {
      console.error('Failed to cancel journey:', err);
      showAlert({ title: t('workspaceConfig.journeys.errorTitle'), message: t('workspaceConfig.journeys.errorCancel') });
    }
  }, [loadJourneys, selectedJourney?.journey_id, t]);

  const handleResumeJourney = useCallback(async (journeyId: string) => {
    try {
      await journeyService.resume(journeyId);
      const rows = await loadJourneys();
      if (selectedJourney?.journey_id === journeyId) {
        const refreshed = rows.find((row) => row.journey_id === journeyId);
        if (refreshed) setSelectedJourney(refreshed);
      }
    } catch (err: any) {
      console.error('Failed to resume journey:', err);
      showAlert({ title: t('workspaceConfig.journeys.errorTitle'), message: t('workspaceConfig.journeys.errorResume') });
    }
  }, [loadJourneys, selectedJourney?.journey_id, t]);

  const handleDeleteJourney = useCallback(async (journeyId: string) => {
    if (!await confirm({
      title: t('workspaceConfig.journeys.confirmDeleteTitle'),
      message: t('workspaceConfig.journeys.confirmDeleteMessage'),
      variant: 'danger',
      confirmLabel: t('workspaceConfig.journeys.delete'),
    })) {
      return;
    }
    try {
      await journeyService.delete(projectId, journeyId);
      if (selectedJourney?.journey_id === journeyId) {
        setSelectedJourney(null);
      }
      await loadJourneys();
    } catch (err: any) {
      console.error('Failed to delete journey:', err);
      showAlert({ title: t('workspaceConfig.journeys.errorTitle'), message: t('workspaceConfig.journeys.errorDelete') });
    }
  }, [loadJourneys, projectId, selectedJourney?.journey_id, t]);

  const handleDeleteAllJourneys = useCallback(async () => {
    if (!await confirm({
      title: t('workspaceConfig.journeys.confirmDeleteAllTitle'),
      message: t('workspaceConfig.journeys.confirmDeleteAllMessage'),
      variant: 'danger',
      confirmLabel: t('workspaceConfig.journeys.deleteAll'),
    })) {
      return;
    }
    setIsDeletingAllJourneys(true);
    try {
      await journeyService.deleteAll(projectId);
      setSelectedJourney(null);
      await loadJourneys();
    } catch (err: any) {
      console.error('Failed to delete all journeys:', err);
      showAlert({ title: t('workspaceConfig.journeys.errorTitle'), message: t('workspaceConfig.journeys.errorDeleteAll') });
    } finally {
      setIsDeletingAllJourneys(false);
    }
  }, [loadJourneys, projectId, t]);

  return (
    <div className="workspace-config-panel">
      <div className="workspace-config-card">
        <h2>{t('workspaceConfig.title')}</h2>
        <p className="workspace-config-hint">
          {t('workspaceConfig.imageCleanupHint')}
        </p>
      </div>

      <div className="workspace-config-card">
        <h3>{t('workspaceConfig.projectInfo.title')}</h3>
        <div className="workspace-config-form">
          <div className="workspace-config-field">
            <label>{t('workspaceConfig.projectInfo.name')}</label>
            <input
              type="text"
              className="workspace-config-text-input"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder={t('workspaceConfig.projectInfo.namePlaceholder')}
            />
          </div>
          <div className="workspace-config-field">
            <label>{t('workspaceConfig.projectInfo.description')}</label>
            <textarea
              className="workspace-config-textarea"
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
              placeholder={t('workspaceConfig.projectInfo.descriptionPlaceholder')}
            />
          </div>
        </div>
        <div className="workspace-config-actions">
          <TextButton
            onClick={handleSaveProjectInfo}
            variant="primary"
            size="sm"
            loading={isSavingInfo}
            disabled={!projectInfoDirty || !projectName.trim()}
          >
            {savedInfo ? t('workspaceConfig.projectInfo.saved') : t('workspaceConfig.projectInfo.save')}
          </TextButton>
        </div>
      </div>

      <div className="workspace-config-card">
        <h3>{t('workspaceConfig.journeys.title')}</h3>
        <p className="workspace-config-hint">
          {t('workspaceConfig.journeys.hint')}
        </p>

        <div className="workspace-config-actions">
          <TextButton
            onClick={() => { void loadJourneys(); }}
            variant="secondary"
            size="sm"
            iconLeft={<Refresh size="xs" />}
            loading={isJourneysLoading}
            disabled={isDeletingAllJourneys}
          >
            {t('workspaceConfig.journeys.refresh')}
          </TextButton>
          <TextButton
            onClick={() => { void handleDeleteAllJourneys(); }}
            variant="danger"
            size="sm"
            iconLeft={<Trash size="xs" />}
            loading={isDeletingAllJourneys}
            disabled={journeys.length === 0 || isJourneysLoading}
          >
            {t('workspaceConfig.journeys.deleteAll')}
          </TextButton>
        </div>

        {isJourneysLoading ? (
          <div className="workspace-config-empty">{t('common.loading')}</div>
        ) : journeys.length === 0 ? (
          <div className="workspace-config-empty">{t('workspaceConfig.journeys.empty')}</div>
        ) : (
          <ul className="workspace-config-candidate-list workspace-config-journey-list">
            {journeys.map((journey) => {
              const canResume = canResumeThreadStatus(journey.status);
              const canCancel = canCancelThreadStatus(journey.status);
              return (
                <li key={journey.journey_id} className="workspace-config-candidate-item workspace-config-journey-item">
                  <div className="workspace-config-candidate-meta">
                    <div className="workspace-config-candidate-title">
                      {journey.display_label || journey.kind || t('workspaceConfig.journeys.defaultLabel')}
                    </div>
                    <div className="workspace-config-candidate-sub">
                      {journey.status}
                      {journey.latest_run_id ? ` | ${t('workspaceConfig.journeys.activeRun')}` : ''}
                      {journey.last_error ? ` | ${journey.last_error}` : ''}
                    </div>
                  </div>
                  <div className="workspace-config-actions workspace-config-actions--inline">
                    <TextButton
                      onClick={() => setSelectedJourney(journey)}
                      size="sm"
                      variant="secondary"
                      disabled={isDeletingAllJourneys}
                      iconLeft={<List size="xs" />}
                    >
                      {t('workspaceConfig.journeys.open')}
                    </TextButton>
                    {canResume && (
                      <TextButton
                        onClick={() => { void handleResumeJourney(journey.journey_id); }}
                        size="sm"
                        variant="primary"
                        disabled={isDeletingAllJourneys}
                        iconLeft={<Refresh size="xs" />}
                      >
                        {t('workspaceConfig.journeys.resume')}
                      </TextButton>
                    )}
                    <TextButton
                      onClick={() => { void handleCancelJourney(journey.journey_id); }}
                      size="sm"
                      variant="secondary"
                      disabled={!canCancel || isDeletingAllJourneys}
                      iconLeft={<Refresh size="xs" />}
                    >
                      {t('workspaceConfig.journeys.cancel')}
                    </TextButton>
                    <TextButton
                      onClick={() => { void handleDeleteJourney(journey.journey_id); }}
                      size="sm"
                      variant="danger"
                      disabled={isDeletingAllJourneys}
                      iconLeft={<Trash size="xs" />}
                    >
                      {t('workspaceConfig.journeys.delete')}
                    </TextButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="workspace-config-card">
        <h3>{t('workspaceConfig.vectorStorage.title')}</h3>
        <p className="workspace-config-hint">{t('workspaceConfig.vectorStorage.hint')}</p>

        {isVectorStorageLoading ? (
          <div className="workspace-config-empty">{t('common.loading')}</div>
        ) : !vectorStorageStatus ? (
          <div className="workspace-config-empty">{t('workspaceConfig.vectorStorage.statusUnavailable')}</div>
        ) : !vectorStorageStatus.enabled ? (
          <div className="workspace-config-empty">{t('workspaceConfig.vectorStorage.disabled')}</div>
        ) : !vectorStorageStatus.profile ? (
          <div className="workspace-config-empty">{t('workspaceConfig.vectorStorage.profileMissing')}</div>
        ) : (
          <div className="workspace-config-preview-summary workspace-config-preview-summary--stack">
            <div>
              <strong>{t('workspaceConfig.vectorStorage.profile')}</strong> {vectorStorageStatus.profile.provider} / {vectorStorageStatus.profile.model}
            </div>
            <div>
              <strong>{t('workspaceConfig.vectorStorage.dimensions')}</strong> {vectorStorageStatus.profile.dimensions ?? t('workspaceConfig.vectorStorage.unknown')}
            </div>
            <div>
              <strong>{t('workspaceConfig.vectorStorage.sources')}</strong> {vectorStorageStatus.ready_sources}/{vectorStorageStatus.total_sources}
              {vectorStorageStatus.unindexed_sources > 0 && (
                <span> · {t('workspaceConfig.vectorStorage.unindexed', { count: vectorStorageStatus.unindexed_sources })}</span>
              )}
              {vectorStorageStatus.stale_sources > 0 && (
                <span> · {t('workspaceConfig.vectorStorage.stale', { count: vectorStorageStatus.stale_sources })}</span>
              )}
              {vectorStorageStatus.missing_main_language_sources > 0 && (
                <span> · {t('workspaceConfig.vectorStorage.missingMainLanguage', { count: vectorStorageStatus.missing_main_language_sources })}</span>
              )}
              {vectorStorageStatus.error_sources > 0 && (
                <span> · {t('workspaceConfig.vectorStorage.errors', { count: vectorStorageStatus.error_sources })}</span>
              )}
            </div>
            {vectorStorageStatus.last_indexed_at && (
              <div>
                <strong>{t('workspaceConfig.vectorStorage.lastIndexed')}</strong> {vectorStorageStatus.last_indexed_at}
              </div>
            )}
          </div>
        )}

        <div className="workspace-config-actions">
          <TextButton
            onClick={loadVectorStorageStatus}
            variant="secondary"
            size="sm"
            iconLeft={<Refresh size="xs" />}
            loading={isVectorStorageLoading}
          >
            {t('workspaceConfig.vectorStorage.refresh')}
          </TextButton>
          <TextButton
            onClick={handleVectorStorageReindex}
            variant="primary"
            size="sm"
            iconLeft={<Refresh size="xs" />}
            loading={isVectorStorageReindexing}
            disabled={!vectorStorageStatus?.enabled || !vectorStorageStatus?.profile}
          >
            {t('workspaceConfig.vectorStorage.reindex')}
          </TextButton>
        </div>

        {lastVectorStorageSummary && <div className="workspace-config-result">{lastVectorStorageSummary}</div>}
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
              checked={exportOptions.include_non_main_object_images}
              onChange={(checked) =>
                setExportOptions((prev) => ({ ...prev, include_non_main_object_images: checked }))
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

        {exportPreview && <hr className="workspace-config-divider" />}

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
                  <AuthenticatedImage
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
              <NumberInput
                min={0}
                step={1}
                value={policy.keep_recent_days}
                onValueChange={(v) =>
                  setPolicy((prev) => ({
                    ...prev,
                    keep_recent_days: v!,
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
              checked={policy.delete_unused_rich_text_images}
              onChange={(checked) => setPolicy((prev) => ({ ...prev, delete_unused_rich_text_images: checked }))}
              label={t('workspaceConfig.imageCleanup.deleteUnusedScene')}
              icon={<Trash size="sm" />}
            />
          </div>

          <div className="workspace-config-field">
            <ToggleSwitch
              checked={policy.delete_non_main_object_images}
              onChange={(checked) =>
                setPolicy((prev) => ({ ...prev, delete_non_main_object_images: checked }))
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

        {preview && (
          <>
            <hr className="workspace-config-divider" />
            <div className="workspace-config-preview-summary">
              <div>
                {t('workspaceConfig.imageCleanup.candidates')}: <strong>{preview.total_candidates}</strong>
                {' '}• {t('workspaceConfig.imageCleanup.totalSize')}: <strong>{formatBytes(preview.total_size_bytes)}</strong>
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
                      <AuthenticatedImage
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
          </>
        )}
      </div>

      {selectedJourney ? (
        <JourneyNotificationDetail
          threadId={selectedJourney.thread_id}
          projectId={projectId}
          label={selectedJourney.display_label || selectedJourney.kind || t('workspaceConfig.journeys.defaultLabel')}
          status={selectedJourney.status}
          message={selectedJourney.last_error || t('workspaceConfig.journeys.detailsFallback')}
          onClose={() => setSelectedJourney(null)}
        />
      ) : null}
    </div>
  );
};

export default WorkspaceConfigPanel;
