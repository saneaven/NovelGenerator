/** Query-key factory for in-app (persisted) notifications. */

export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => [...notificationKeys.all, 'list'] as const,
};
