import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLLMTaskStore } from '../../store/llmTaskStore';
import { useImageTaskStore } from '../../imageGeneration/store/imageTaskStore';
import type { ImageTaskState } from '../../imageGeneration/types';
import NotificationItem, { type NotificationTask } from './NotificationItem';
import NotificationDetailModal from './NotificationDetailModal';
import ImagePreviewModal from './ImagePreviewModal';
import { useScroll } from 'motion/react';
import { UnifiedImageModal } from '../AssetManager';

interface NotificationPanelProps {
  onClose: () => void;
}

const NotificationPanel: React.FC<NotificationPanelProps> = () => {
  const itemsViewportRef = useRef<HTMLDivElement>(null);
  const itemsContainerRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll({ container: itemsViewportRef });
  const [itemStride, setItemStride] = useState(80);
  const [viewportHeight, setViewportHeight] = useState(320);
  const [isMobile, setIsMobile] = useState(false);
  const frontCount = 4;
  const depthRange = 4;
  const maxDepthZ = 260;
  const stackLift = 40;
  const maxBlur = 6;
  // LLM Task Store - get sessions map for deriving task refs
  const llmSessionsMap = useLLMTaskStore((state) => state.sessions);
  const clearLLMNotification = useLLMTaskStore((state) => state.clearNotification);
  const clearAllLLMNotifications = useLLMTaskStore((state) => state.clearAllNotifications);
  const cancelLLMTask = useLLMTaskStore((state) => state.cancelTask);

  // Image Task Store - get tasks map for deriving task refs
  const imageTasksMap = useImageTaskStore((state) => state.tasks);
  const clearImageTask = useImageTaskStore((state) => state.clearTask);
  const clearAllImageTasks = useImageTaskStore((state) => state.clearAllTasks);
  const cancelImageTask = useImageTaskStore((state) => state.cancelTask);

  // Derive task refs from maps (memoized to prevent infinite loops)
  const allTaskRefs = useMemo(() => {
    const llmRefs = Object.entries(llmSessionsMap)
      .filter(([_, s]) => s && s.status !== 'idle')
      .map(([id, s]) => ({ id, source: 'llm' as const, createdAt: s!.createdAt }));
    const imageRefs = Object.entries(imageTasksMap)
      .filter(([_, t]) => t && t.status !== 'idle')
      .map(([id, t]) => ({ id, source: 'image' as const, createdAt: t!.createdAt }));
    return [...llmRefs, ...imageRefs].sort((a, b) => b.createdAt - a.createdAt);
  }, [llmSessionsMap, imageTasksMap]);

  const orderedTaskRefs = useMemo(() => {
    if (!isMobile) return allTaskRefs;
    return [...allTaskRefs].reverse();
  }, [allTaskRefs, isMobile]);

  const [detailSessionId, setDetailSessionId] = useState<string | null>(null);
  const [imageRetryTask, setImageRetryTask] = useState<ImageTaskState | null>(null);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);

  const handleDismiss = useCallback(
    (task: NotificationTask) => {
      if (task.source === 'llm') {
        // If LLM task is running, cancel it first
        if (task.status === 'running') {
          cancelLLMTask(task.id);
        }
        clearLLMNotification(task.id);
      } else {
        // If image task is running, cancel it first
        if (task.status === 'preparing' || task.status === 'generating' || task.status === 'processing') {
          cancelImageTask(task.id);
        }
        clearImageTask(task.id);
      }
    },
    [cancelLLMTask, clearLLMNotification, cancelImageTask, clearImageTask]
  );

  const handleOpenDetail = useCallback((task: NotificationTask) => {
    if (task.source === 'llm') {
      setDetailSessionId(task.id);
    } else {
      // For image tasks, if error with retry context, open retry modal
      if (task.status === 'error' && task.retryContext) {
        setImageRetryTask(task);
      } else if (task.status === 'success' && task.result?.assetId) {
        // For success, show image preview
        setPreviewAssetId(task.result.assetId);
      }
    }
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailSessionId(null);
  }, []);

  const handleDismissToast = useCallback((id: string) => {
    setDetailSessionId(null);
    clearLLMNotification(id);
  }, [clearLLMNotification]);

  const handleImageRetryModalClose = useCallback(() => {
    if (imageRetryTask) {
      clearImageTask(imageRetryTask.id);
    }
    setImageRetryTask(null);
  }, [imageRetryTask, clearImageTask]);

  const handleClearAll = useCallback(() => {
    clearAllLLMNotifications();
    clearAllImageTasks();
  }, [clearAllLLMNotifications, clearAllImageTasks]);

  const renderImageRetryModal = () => {
    if (!imageRetryTask?.retryContext) return null;

    const { request } = imageRetryTask.retryContext;

    // Use UnifiedImageModal for retry with initial settings from failed request
    return (
      <UnifiedImageModal
        isOpen={true}
        onClose={handleImageRetryModalClose}
        preset={imageRetryTask.taskType === 'scene-image' ? 'sceneManager' : 'objectManager'}
        onImageGenerated={() => handleImageRetryModalClose()}
        title="Retry Image Generation"
        initialGenerationSettings={{
          provider: request.provider,
          model: request.model,
          size: request.size,
          prompt: request.prompt,
          positivePrompt: request.positivePrompt,
          negativePrompt: request.negativePrompt,
          settings: {
            // Provider-specific settings
            quality: request.quality,
            style: request.style,
            sampler: request.sampler,
            steps: request.steps,
            scale: request.scale,
            noiseSchedule: request.noiseSchedule,
            styleId: request.styleId,
          },
        }}
      />
    );
  };

  // Get detail session directly from store (per-item subscription pattern)
  const detailSession = useLLMTaskStore((state) =>
    detailSessionId ? state.sessions[detailSessionId] : null
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 480px)');
    const handleChange = () => setIsMobile(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  useLayoutEffect(() => {
    const container = itemsContainerRef.current;
    const viewport = itemsViewportRef.current;
    if (!container || !viewport) return;
    let frameId = 0;

    const measure = () => {
      const firstItem = container.querySelector<HTMLElement>('.notification-item');
      if (!firstItem) return;
      const styles = getComputedStyle(container);
      const gap = parseFloat(styles.rowGap || styles.gap || '0') || 0;
      const height = firstItem.getBoundingClientRect().height;
      if (height > 0) {
        setItemStride(height + gap);
      }
      const viewportBox = viewport.getBoundingClientRect();
      if (viewportBox.height > 0) {
        setViewportHeight(viewportBox.height);
      }
    };

    const scheduleMeasure = () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      frameId = requestAnimationFrame(measure);
    };

    measure();

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(container);
    resizeObserver.observe(viewport);
    const firstItem = container.querySelector<HTMLElement>('.notification-item');
    if (firstItem) {
      resizeObserver.observe(firstItem);
    }

    window.addEventListener('resize', scheduleMeasure);
    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [orderedTaskRefs.length, orderedTaskRefs[0]?.id]);

  useLayoutEffect(() => {
    if (!isMobile) return;
    const viewport = itemsViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [isMobile, orderedTaskRefs.length]);

  const headerNode = (
    <div className="notification-header">
      <h3 className="notification-header-title">Notifications</h3>
      {allTaskRefs.length > 0 && (
        <button
          className="notification-header-clear"
          onClick={handleClearAll}
        >
          Clear All
        </button>
      )}
    </div>
  );

  return (
    <>
      {/* Thin Header Card */}
      {!isMobile && headerNode}

      {/* Floating Items */}
      <div className="notification-items-viewport" ref={itemsViewportRef}>
        <div
          className="notification-items-container"
          ref={itemsContainerRef}
          style={{
            paddingTop: isMobile ? stackLift * (depthRange + 2) : undefined,
            paddingBottom: !isMobile ? stackLift * (depthRange + 2) : undefined,
          }}
        >
          {orderedTaskRefs.length === 0 ? (
            <div className="notification-empty">
              <p>No notifications</p>
            </div>
          ) : (
            orderedTaskRefs.map((ref, index) => (
              <NotificationItem
                key={ref.id}
                taskId={ref.id}
                source={ref.source}
                index={index}
                totalCount={orderedTaskRefs.length}
                scrollY={scrollY}
                itemStride={itemStride}
                viewportHeight={viewportHeight}
                frontCount={frontCount}
                depthRange={depthRange}
                maxDepthZ={maxDepthZ}
                stackLift={stackLift}
                maxBlur={maxBlur}
                isMobile={isMobile}
                onDismiss={handleDismiss}
                onOpenDetail={handleOpenDetail}
              />
            ))
          )}
        </div>
      </div>

      {isMobile && headerNode}

      {detailSession && (
        <NotificationDetailModal
          session={detailSession}
          onClose={handleCloseDetail}
          onDismissToast={() => handleDismissToast(detailSession.id)}
        />
      )}

      {renderImageRetryModal()}

      {previewAssetId && (
        <ImagePreviewModal
          isOpen={true}
          onClose={() => setPreviewAssetId(null)}
          assetId={previewAssetId}
        />
      )}
    </>
  );
};

export default NotificationPanel;
