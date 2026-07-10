import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageValues = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => storageValues.get(key) ?? null,
  setItem: (key: string, value: string) => storageValues.set(key, value),
  removeItem: (key: string) => storageValues.delete(key),
  clear: () => storageValues.clear(),
  key: (index: number) => Array.from(storageValues.keys())[index] ?? null,
  get length() {
    return storageValues.size;
  },
});

const {
  getEffectiveSharedSelection,
  replaceSharedSelectionSlice,
  useObjectPickerSelectionStore,
} = await import('./objectPickerSelectionStore');

describe('objectPickerSelectionStore', () => {
  beforeEach(() => {
    useObjectPickerSelectionStore.setState({ selections: {} });
    storageValues.clear();
  });

  it('starts empty and persists version 1 under the shared storage key', () => {
    expect(useObjectPickerSelectionStore.getState().selections).toEqual({});

    useObjectPickerSelectionStore.getState().replaceSelectionSlice({
      userId: 'user-1',
      projectId: 'project-1',
      bucket: 'all-context',
      availableIds: ['object-1'],
      nextSelectedIds: ['object-1'],
    });

    expect(JSON.parse(storageValues.get('object-picker-selections') ?? '{}')).toEqual({
      state: {
        selections: {
          'user-1': {
            'project-1': {
              'all-context': ['object-1'],
            },
          },
        },
      },
      version: 1,
    });
  });

  it('hydrates persisted selections and isolates users, projects, and buckets', async () => {
    storageValues.set('object-picker-selections', JSON.stringify({
      state: {
        selections: {
          'user-1': {
            'project-1': { 'all-context': ['all-1'] },
            'project-2': { 'translation-target': ['target-2'] },
          },
          'user-2': {
            'project-1': { 'translation-context': ['context-1'] },
          },
        },
      },
      version: 1,
    }));

    await useObjectPickerSelectionStore.persist.rehydrate();

    expect(useObjectPickerSelectionStore.getState().selections).toEqual({
      'user-1': {
        'project-1': { 'all-context': ['all-1'] },
        'project-2': { 'translation-target': ['target-2'] },
      },
      'user-2': {
        'project-1': { 'translation-context': ['context-1'] },
      },
    });
  });

  it('replaces only the editable slice and evaluates functional updates atomically', () => {
    useObjectPickerSelectionStore.setState({
      selections: {
        'user-1': {
          'project-1': {
            'all-context': ['visible-old', 'language-hidden', 'edit-target'],
          },
        },
      },
    });

    useObjectPickerSelectionStore.getState().replaceSelectionSlice({
      userId: 'user-1',
      projectId: 'project-1',
      bucket: 'all-context',
      availableIds: ['visible-old', 'visible-new', 'edit-target'],
      excludedIds: ['edit-target'],
      nextSelectedIds: (current) => [...current, 'visible-new'],
    });

    expect(
      useObjectPickerSelectionStore.getState()
        .selections['user-1']['project-1']['all-context'],
    ).toEqual(['language-hidden', 'edit-target', 'visible-old', 'visible-new']);

    useObjectPickerSelectionStore.getState().replaceSelectionSlice({
      userId: 'user-1',
      projectId: 'project-1',
      bucket: 'all-context',
      availableIds: ['visible-old', 'visible-new', 'edit-target'],
      excludedIds: ['edit-target'],
      nextSelectedIds: ['visible-new'],
    });

    expect(
      useObjectPickerSelectionStore.getState()
        .selections['user-1']['project-1']['all-context'],
    ).toEqual(['language-hidden', 'edit-target', 'visible-new']);
  });

  it('clears only the deleted project for the owning user', () => {
    useObjectPickerSelectionStore.setState({
      selections: {
        'user-1': {
          'project-1': { 'all-context': ['one'] },
          'project-2': { 'all-context': ['two'] },
        },
        'user-2': {
          'project-1': { 'all-context': ['other-user'] },
        },
      },
    });

    useObjectPickerSelectionStore.getState().clearProject('user-1', 'project-1');

    expect(useObjectPickerSelectionStore.getState().selections).toEqual({
      'user-1': {
        'project-2': { 'all-context': ['two'] },
      },
      'user-2': {
        'project-1': { 'all-context': ['other-user'] },
      },
    });
  });

  it('ignores writes without a user or project', () => {
    const action = useObjectPickerSelectionStore.getState().replaceSelectionSlice;
    action({
      userId: '',
      projectId: 'project-1',
      bucket: 'all-context',
      availableIds: ['one'],
      nextSelectedIds: ['one'],
    });
    action({
      userId: 'user-1',
      projectId: '',
      bucket: 'all-context',
      availableIds: ['one'],
      nextSelectedIds: ['one'],
    });

    expect(useObjectPickerSelectionStore.getState().selections).toEqual({});
  });

  it('normalizes single-selection values for controlled ObjectPicker callbacks', () => {
    const action = useObjectPickerSelectionStore.getState().replaceSelectionSlice;
    action({
      userId: 'user-1',
      projectId: 'project-1',
      bucket: 'all-context',
      availableIds: ['one'],
      nextSelectedIds: 'one',
    });
    expect(
      useObjectPickerSelectionStore.getState()
        .selections['user-1']['project-1']['all-context'],
    ).toEqual(['one']);

    action({
      userId: 'user-1',
      projectId: 'project-1',
      bucket: 'all-context',
      availableIds: ['one'],
      nextSelectedIds: '',
    });
    expect(
      useObjectPickerSelectionStore.getState()
        .selections['user-1']['project-1']['all-context'],
    ).toEqual([]);
  });
});

describe('shared ObjectPicker selection derivation', () => {
  it('exposes only available non-excluded IDs and filters stale values', () => {
    expect(getEffectiveSharedSelection(
      ['available', 'stale', 'excluded'],
      ['available', 'excluded', 'preselected'],
      ['excluded'],
      ['preselected'],
    )).toEqual(['available', 'preselected']);
  });

  it('keeps preselected values call-local instead of persisting them', () => {
    expect(getEffectiveSharedSelection([], ['fixed'], [], ['fixed'])).toEqual(['fixed']);
    expect(replaceSharedSelectionSlice([], ['fixed'], [], ['fixed'], ['fixed'])).toEqual([]);
  });
});
