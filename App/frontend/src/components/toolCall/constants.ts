export const ACTION_LABELS: Record<string, string> = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  replace: 'Replace',
  patch: 'Patch',
  set: 'Set',
  read: 'Read',
  search: 'Search',
};

export const TYPE_LABELS: Record<string, string> = {
  basic_info: 'Basic Info',
  character: 'Character',
  organization: 'Organization',
  location: 'Location',
  lorebook: 'Lorebook',
  outline: 'Outline',
  act: 'Act',
  chapter: 'Chapter',
  manuscript: 'Manuscript',
  story_object: 'Story Object',
  sub_agent: 'Sub Agent',
};

export const STATUS_LABELS: Record<string, string> = {
  collecting: 'Collecting',
  validating: 'Validating',
  ready: 'Ready',
  error: 'Error',
};

export const MODE_TITLES: Record<string, { eyebrow: string; title: string }> = {
  streaming: {
    eyebrow: 'Streaming',
    title: 'AI is generating changes...',
  },
  pending: {
    eyebrow: 'Pending',
    title: 'Review proposed changes',
  },
  confirmed: {
    eyebrow: 'Completed',
    title: 'Changes applied',
  },
};

export const humanize = (value?: string): string => {
  if (!value) return '';
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/g, (char) => char.toUpperCase());
};

export const formatRelativeTime = (timestamp: number): string => {
  const diff = Date.now() - timestamp;
  if (Number.isNaN(diff)) return '';
  if (diff < 5_000) return 'Just now';
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
