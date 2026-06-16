import { create } from 'zustand';

/**
 * Browser-only notification UI state.
 *
 * The only client-state piece left after the feed moved to TanStack Query:
 * which notification (if any) has its detail modal open. `openDetail` just sets
 * the id — consumers guard against a now-missing entry themselves.
 */
interface NotificationUiStore {
  detailNotificationId: string | null;

  openDetail: (id: string) => void;
  closeDetail: () => void;
}

export const useNotificationUiStore = create<NotificationUiStore>((set) => ({
  detailNotificationId: null,

  openDetail: (id) => set({ detailNotificationId: id }),
  closeDetail: () => set({ detailNotificationId: null }),
}));

export default useNotificationUiStore;
