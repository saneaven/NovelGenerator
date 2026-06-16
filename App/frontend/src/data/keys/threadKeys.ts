/** Query-key factory for agent conversation threads. */

export const threadKeys = {
  all: ['threads'] as const,
  list: (projectId: string) => [...threadKeys.all, 'list', projectId] as const,
  detail: (threadId: string) => [...threadKeys.all, 'detail', threadId] as const,
  messages: (threadId: string) => [...threadKeys.all, 'messages', threadId] as const,
};
