import { create } from 'zustand';
import { generateTempId } from '../utils/tempId';

export type DialogVariant = 'danger' | 'warning' | 'info';

export interface ConfirmOptions {
  title: string;
  message: string;
  variant?: DialogVariant;
  confirmLabel?: string;
  cancelLabel?: string;
  detail?: string | null;
}

export interface AlertOptions {
  title: string;
  message: string;
  variant?: DialogVariant;
  detail?: string | null;
}

export interface DialogEntry {
  id: string;
  type: 'confirm' | 'alert';
  title: string;
  message: string;
  variant: DialogVariant;
  confirmLabel: string;
  cancelLabel: string;
  detail?: string | null;
  resolve: (result: boolean) => void;
}

interface DialogStore {
  queue: DialogEntry[];
  pushConfirm: (options: ConfirmOptions) => Promise<boolean>;
  pushAlert: (options: AlertOptions) => Promise<void>;
  respond: (result: boolean) => void;
}

export const useDialogStore = create<DialogStore>((set, get) => ({
  queue: [],

  pushConfirm: (options) => {
    return new Promise<boolean>((resolve) => {
      const entry: DialogEntry = {
        id: generateTempId(),
        type: 'confirm',
        title: options.title,
        message: options.message,
        variant: options.variant ?? 'info',
        confirmLabel: options.confirmLabel ?? 'Confirm',
        cancelLabel: options.cancelLabel ?? 'Cancel',
        detail: options.detail,
        resolve,
      };
      set((state) => ({ queue: [...state.queue, entry] }));
    });
  },

  pushAlert: (options) => {
    return new Promise<void>((resolve) => {
      const entry: DialogEntry = {
        id: generateTempId(),
        type: 'alert',
        title: options.title,
        message: options.message,
        variant: options.variant ?? 'info',
        confirmLabel: 'OK',
        cancelLabel: '',
        detail: options.detail,
        resolve: () => resolve(),
      };
      set((state) => ({ queue: [...state.queue, entry] }));
    });
  },

  respond: (result) => {
    const { queue } = get();
    if (queue.length === 0) return;
    const [current, ...rest] = queue;
    set({ queue: rest });
    current.resolve(result);
  },
}));

export const confirm = (options: ConfirmOptions): Promise<boolean> => {
  return useDialogStore.getState().pushConfirm(options);
};

export const alert = (options: AlertOptions): Promise<void> => {
  return useDialogStore.getState().pushAlert(options);
};
