import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLLMTaskStore, type LLMTaskSessionState } from '../../store/llmTaskStore';
import { useImageTaskStore } from '../../imageGeneration/store/imageTaskStore';
import type { ImageTaskState } from '../../imageGeneration/types';
import NotificationItem, { type NotificationTask } from './NotificationItem';
import NotificationDetailModal from './NotificationDetailModal';
import { useScroll } from 'motion/react';

// Import modal types for retry functionality
import AIEditModal from '../AIEditModal';
import ManuscriptAIEditModal from '../ManuscriptAIEditModal';
import TranslationModal from '../TranslationModal';
import UnifiedImagePromptModal from '../ImageGeneration/UnifiedImagePromptModal';
import { UnifiedImageModal } from '../AssetManager';

interface NotificationPanelProps {
  onClose: () => void;
}

const NotificationPanel: React.FC<NotificationPanelProps> = () => {
  const shouldUseMocks = import.meta.env.DEV;
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
  // LLM Task Store
  const llmSessionsMap = useLLMTaskStore((state) => state.sessions);
  const llmSessions = useMemo(() =>
    Object.values(llmSessionsMap)
      .filter((s): s is LLMTaskSessionState => s !== undefined && s.status !== 'idle'),
    [llmSessionsMap]
  );
  const clearLLMNotification = useLLMTaskStore((state) => state.clearNotification);
  const clearAllLLMNotifications = useLLMTaskStore((state) => state.clearAllNotifications);
  const cancelLLMTask = useLLMTaskStore((state) => state.cancelTask);

  // Image Task Store
  const imageTasksMap = useImageTaskStore((state) => state.tasks);
  const imageTasks = useMemo(() =>
    Object.values(imageTasksMap)
      .filter((t): t is ImageTaskState => t !== undefined && t.status !== 'idle'),
    [imageTasksMap]
  );
  const clearImageTask = useImageTaskStore((state) => state.clearTask);
  const clearAllImageTasks = useImageTaskStore((state) => state.clearAllTasks);
  const cancelImageTask = useImageTaskStore((state) => state.cancelTask);

  // Merge and sort all tasks
  const allTasks = useMemo(() => {
    const combined: NotificationTask[] = [
      ...llmSessions.map(s => ({ ...s, kind: 'llm' as const })),
      ...imageTasks.map(t => ({ ...t, kind: 'image' as const })),
    ];
    return combined.sort((a, b) => b.createdAt - a.createdAt);
  }, [llmSessions, imageTasks]);

  const [mockTasks, setMockTasks] = useState<NotificationTask[]>(() => {
    if (!shouldUseMocks) return [];
    const now = Date.now();
    const llmBase = {
      contentParts: [],
      thinkingParts: [],
      functionCallProgress: [],
      taskType: 'chat' as const,
    };
    const imageBase = {
      taskType: 'scene-image' as const,
    };
    return [
      {
        ...llmBase,
        id: 'mock-llm-1',
        status: 'running',
        label: 'Drafting chapter outline',
        progress: { current: 2, total: 6, currentItemLabel: 'Section 2/6' },
        createdAt: now - 1000 * 12,
        updatedAt: now - 1000 * 4,
        isRead: false,
        kind: 'llm' as const,
      },
      {
        ...llmBase,
        id: 'mock-llm-2',
        status: 'success',
        label: 'Scene polish pass',
        createdAt: now - 1000 * 60 * 3,
        updatedAt: now - 1000 * 60 * 2,
        isRead: true,
        kind: 'llm' as const,
      },
      {
        ...llmBase,
        id: 'mock-llm-3',
        status: 'error',
        label: 'Translate excerpt',
        error: 'Rate limit reached',
        createdAt: now - 1000 * 60 * 6,
        updatedAt: now - 1000 * 60 * 5,
        isRead: false,
        kind: 'llm' as const,
      },
      {
        ...llmBase,
        id: 'mock-llm-4',
        status: 'cancelled',
        label: 'Character summary',
        createdAt: now - 1000 * 60 * 8,
        updatedAt: now - 1000 * 60 * 7,
        isRead: true,
        kind: 'llm' as const,
      },
      {
        ...imageBase,
        id: 'mock-img-1',
        status: 'generating',
        label: 'Character portrait',
        progress: { stage: 'generating', message: 'Generating... (35%)', percentage: 35 },
        createdAt: now - 1000 * 20,
        updatedAt: now - 1000 * 10,
        isRead: false,
        kind: 'image' as const,
      },
      {
        ...imageBase,
        id: 'mock-img-2',
        status: 'processing',
        label: 'Scene illustration',
        progress: { stage: 'processing', message: 'Processing output' },
        createdAt: now - 1000 * 90,
        updatedAt: now - 1000 * 80,
        isRead: false,
        kind: 'image' as const,
      },
      {
        ...imageBase,
        id: 'mock-img-3',
        status: 'success',
        label: 'Location concept',
        createdAt: now - 1000 * 60 * 9,
        updatedAt: now - 1000 * 60 * 8,
        isRead: true,
        kind: 'image' as const,
      },
      {
        ...imageBase,
        id: 'mock-img-4',
        status: 'error',
        label: 'Cover art',
        error: 'Failed to generate image',
        createdAt: now - 1000 * 60 * 12,
        updatedAt: now - 1000 * 60 * 11,
        isRead: false,
        kind: 'image' as const,
      },
      {
        ...llmBase,
        id: 'mock-llm-5',
        status: 'success',
        label: 'Dialogue pass',
        createdAt: now - 1000 * 60 * 14,
        updatedAt: now - 1000 * 60 * 13,
        isRead: true,
        kind: 'llm' as const,
      },
      {
        ...llmBase,
        id: 'mock-llm-6',
        status: 'running',
        label: 'Summarizing chapters',
        progress: { current: 4, total: 10, currentItemLabel: 'Chapter 4/10' },
        createdAt: now - 1000 * 40,
        updatedAt: now - 1000 * 20,
        isRead: false,
        kind: 'llm' as const,
      },
    ];
  });

  const displayTasks = useMemo(() => {
    if (!shouldUseMocks) return allTasks;
    if (allTasks.length >= 10 || mockTasks.length === 0) return allTasks;
    const needed = Math.max(0, 10 - allTasks.length);
    const merged = [...allTasks, ...mockTasks.slice(0, needed)];
    return merged.sort((a, b) => b.createdAt - a.createdAt);
  }, [allTasks, mockTasks, shouldUseMocks]);

  const orderedTasks = useMemo(() => {
    if (!isMobile) return displayTasks;
    return [...displayTasks].reverse();
  }, [displayTasks, isMobile]);

  const [detailSessionId, setDetailSessionId] = useState<string | null>(null);
  const [llmRetrySession, setLLMRetrySession] = useState<LLMTaskSessionState | null>(null);
  const [imageRetryTask, setImageRetryTask] = useState<ImageTaskState | null>(null);

  const handleDismiss = useCallback(
    (task: NotificationTask) => {
      if (task.id.startsWith('mock-')) {
        setMockTasks((prev) => prev.filter((mock) => mock.id !== task.id));
        return;
      }
      if (task.kind === 'llm') {
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
    if (task.id.startsWith('mock-')) return;
    if (task.kind === 'llm') {
      setDetailSessionId(task.id);
    } else {
      // For image tasks, if error with retry context, open retry modal
      if (task.status === 'error' && task.retryContext) {
        setImageRetryTask(task);
      }
      // For success, could show image preview (future enhancement)
    }
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailSessionId(null);
  }, []);

  const handleDismissToast = useCallback((id: string) => {
    setDetailSessionId(null);
    clearLLMNotification(id);
  }, [clearLLMNotification]);

  const handleLLMRetry = useCallback((session: LLMTaskSessionState) => {
    setLLMRetrySession(session);
    setDetailSessionId(null);
  }, []);

  const handleLLMRetryModalClose = useCallback(() => {
    if (llmRetrySession) {
      clearLLMNotification(llmRetrySession.id);
    }
    setLLMRetrySession(null);
  }, [llmRetrySession, clearLLMNotification]);

  const handleImageRetryModalClose = useCallback(() => {
    if (imageRetryTask) {
      clearImageTask(imageRetryTask.id);
    }
    setImageRetryTask(null);
  }, [imageRetryTask, clearImageTask]);

  const handleClearAll = useCallback(() => {
    clearAllLLMNotifications();
    clearAllImageTasks();
    if (shouldUseMocks) {
      setMockTasks([]);
    }
  }, [clearAllLLMNotifications, clearAllImageTasks, shouldUseMocks]);

  const renderLLMRetryModal = () => {
    if (!llmRetrySession?.retryContext) return null;

    const { taskType, modalProps, formState } = llmRetrySession.retryContext;

    switch (taskType) {
      case 'ai-edit':
        return (
          <AIEditModal
            isOpen={true}
            onClose={handleLLMRetryModalClose}
            category={modalProps.category}
            projectId={modalProps.projectId}
            targetId={modalProps.targetId}
            onResult={modalProps.onResult}
            defaultUserRequest={formState?.userRequest}
          />
        );

      case 'chapter-edit':
        return (
          <ManuscriptAIEditModal
            isOpen={true}
            onClose={handleLLMRetryModalClose}
            projectId={modalProps.projectId}
            chapterId={modalProps.chapterId}
            chapterName={modalProps.chapterName}
            onResult={modalProps.onResult}
            defaultUserRequest={formState?.userRequest}
          />
        );

      case 'translation':
        return (
          <TranslationModal
            isOpen={true}
            onClose={handleLLMRetryModalClose}
            projectId={modalProps.projectId}
            onComplete={modalProps.onComplete}
            allowedObjectTypes={modalProps.allowedObjectTypes}
            defaultSourceLanguage={formState?.sourceLanguage}
            defaultTargetLanguage={formState?.targetLanguage}
            defaultUserInput={formState?.userInput}
          />
        );

      case 'image-prompt':
        return (
          <UnifiedImagePromptModal
            isOpen={true}
            onClose={handleLLMRetryModalClose}
            contextType={modalProps.contextType || 'object'}
            objectType={modalProps.objectType}
            objectId={modalProps.objectId}
            onPromptGenerated={modalProps.onPromptGenerated}
            promptMode={modalProps.promptMode}
            defaultUserRequest={formState?.userRequest}
            sceneContext={modalProps.sceneContext}
          />
        );

      default:
        console.warn(`Retry not implemented for task type: ${taskType}`);
        return null;
    }
  };

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

  const detailSession = detailSessionId
    ? llmSessions.find((s) => s.id === detailSessionId)
    : null;

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 480px)');
    const handleChange = () => setIsMobile(mediaQuery.matches);
    handleChange();
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
    } else {
      mediaQuery.addListener(handleChange);
    }
    return () => {
      if (mediaQuery.addEventListener) {
        mediaQuery.removeEventListener('change', handleChange);
      } else {
        mediaQuery.removeListener(handleChange);
      }
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
  }, [orderedTasks.length, orderedTasks[0]?.id]);

  useLayoutEffect(() => {
    if (!isMobile) return;
    const viewport = itemsViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [isMobile, orderedTasks.length]);

  const headerNode = (
    <div className="notification-header">
      <h3 className="notification-header-title">Notifications</h3>
      {displayTasks.length > 0 && (
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
      {orderedTasks.length === 0 ? (
        <div className="notification-empty">
          <p>No notifications</p>
        </div>
      ) : (
        <div className="notification-items-viewport" ref={itemsViewportRef}>
          <div
            className="notification-items-container"
            ref={itemsContainerRef}
            style={{
              paddingTop: isMobile ? stackLift * (depthRange + 2) : undefined,
              paddingBottom: !isMobile ? stackLift * (depthRange + 2) : undefined,
            }}
          >
            {orderedTasks.map((task, index) => (
              <NotificationItem
                key={task.id}
                task={task}
                index={index}
                totalCount={orderedTasks.length}
                scrollY={scrollY}
                itemStride={itemStride}
                viewportHeight={viewportHeight}
                frontCount={frontCount}
                depthRange={depthRange}
                maxDepthZ={maxDepthZ}
                stackLift={stackLift}
                maxBlur={maxBlur}
                isMobile={isMobile}
                onDismiss={() => handleDismiss(task)}
                onOpenDetail={() => handleOpenDetail(task)}
              />
            ))}
          </div>
        </div>
      )}

      {isMobile && headerNode}

      {detailSession && (
        <NotificationDetailModal
          session={detailSession}
          onClose={handleCloseDetail}
          onDismissToast={() => handleDismissToast(detailSession.id)}
          onRetry={handleLLMRetry}
        />
      )}

      {renderLLMRetryModal()}
      {renderImageRetryModal()}
    </>
  );
};

export default NotificationPanel;
