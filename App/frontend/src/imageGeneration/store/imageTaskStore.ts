/**
 * Image Task Store
 * Zustand store for tracking image generation tasks with notification support
 */

import { create } from 'zustand';
import type { ImageTaskState, ImageTaskStatus, ImageTaskType, ImageRetryContext } from '../types';

interface ImageTaskStore {
    tasks: Record<string, ImageTaskState | undefined>;

    // Modal state (for notification click handling)
    modalTaskId: string | null;
    openModal: (taskId: string) => void;
    closeModal: () => void;

    // Task lifecycle
    startTask: (id: string, taskType: ImageTaskType, label: string, retryContext?: ImageRetryContext) => void;
    updateProgress: (id: string, stage: string, message: string, percentage?: number) => void;
    completeTask: (id: string, result?: { assetId?: string; revisedPrompt?: string; thumbnailUrl?: string }) => void;
    failTask: (id: string, error: string) => void;
    cancelTask: (id: string) => void;
    clearTask: (id: string) => void;

    // Queries
    getTask: (id: string) => ImageTaskState | undefined;
    getActiveTasks: () => ImageTaskState[];
    isAnyTaskGenerating: () => boolean;
}

export const useImageTaskStore = create<ImageTaskStore>()((set, get) => ({
    tasks: {},

    // Modal state
    modalTaskId: null,
    openModal: (taskId) => set({ modalTaskId: taskId }),
    closeModal: () => set({ modalTaskId: null }),

    startTask: (id, taskType, label, retryContext) =>
        set((state) => ({
            tasks: {
                ...state.tasks,
                [id]: {
                    id,
                    status: 'generating' as ImageTaskStatus,
                    taskType,
                    label,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    retryContext,
                },
            },
        })),

    updateProgress: (id, stage, message, percentage) =>
        set((state) => {
            const task = state.tasks[id];
            if (!task) return state;
            return {
                tasks: {
                    ...state.tasks,
                    [id]: {
                        ...task,
                        status: stage as ImageTaskStatus,
                        progress: { stage, message, percentage },
                        updatedAt: Date.now(),
                    },
                },
            };
        }),

    completeTask: (id, result) =>
        set((state) => {
            const task = state.tasks[id];
            if (!task) return state;
            return {
                tasks: {
                    ...state.tasks,
                    [id]: {
                        ...task,
                        status: 'success' as ImageTaskStatus,
                        result,
                        updatedAt: Date.now(),
                    },
                },
            };
        }),

    failTask: (id, error) =>
        set((state) => {
            const task = state.tasks[id];
            if (!task) return state;
            return {
                tasks: {
                    ...state.tasks,
                    [id]: {
                        ...task,
                        status: 'error' as ImageTaskStatus,
                        error,
                        updatedAt: Date.now(),
                    },
                },
            };
        }),

    cancelTask: (id) =>
        set((state) => {
            const task = state.tasks[id];
            if (!task) return state;
            return {
                tasks: {
                    ...state.tasks,
                    [id]: {
                        ...task,
                        status: 'cancelled' as ImageTaskStatus,
                        updatedAt: Date.now(),
                    },
                },
            };
        }),

    clearTask: (id) =>
        set((state) => {
            const { [id]: _, ...rest } = state.tasks;
            return { tasks: rest };
        }),

    getTask: (id) => get().tasks[id],

    getActiveTasks: () =>
        Object.values(get().tasks)
            .filter(
                (t): t is ImageTaskState =>
                    t !== undefined &&
                    (t.status === 'preparing' || t.status === 'generating' || t.status === 'processing')
            )
            .sort((a, b) => b.createdAt - a.createdAt),

    isAnyTaskGenerating: () =>
        Object.values(get().tasks).some(
            (t) =>
                t !== undefined &&
                (t.status === 'preparing' || t.status === 'generating' || t.status === 'processing')
        ),
}));

export default useImageTaskStore;
