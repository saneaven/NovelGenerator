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

  it('starts empty and persists version 2 under the shared storage key', () => {
    expect(useObjectPickerSelectionStore.getState().selections).toEqual({});

    useObjectPickerSelectionStore.getState().replaceSelectionSlice({
      userId: 'user-1',
      projectId: 'project-1',
      bucket: 'agent-context',
      availableIds: ['object-1'],
      nextSelectedIds: ['object-1'],
    });

    expect(JSON.parse(storageValues.get('object-picker-selections') ?? '{}')).toEqual({
      state: {
        selections: {
          'user-1': {
            'project-1': {
              'agent-context': ['object-1'],
            },
          },
        },
      },
      version: 2,
    });
  });

  it('resets all persisted selections when migrating from version 1', async () => {
    storageValues.set('object-picker-selections', JSON.stringify({
      state: {
        selections: {
          'user-1': {
            'project-1': {
              'all-context': ['all-1'],
              'translation-target': ['target-1'],
              'translation-context': ['context-1'],
            },
          },
        },
      },
      version: 1,
    }));

    await useObjectPickerSelectionStore.persist.rehydrate();

    expect(useObjectPickerSelectionStore.getState().selections).toEqual({});
    expect(JSON.parse(storageValues.get('object-picker-selections') ?? '{}')).toEqual({
      state: { selections: {} },
      version: 2,
    });
  });

  it('hydrates version 2 selections and isolates users and projects', async () => {
    storageValues.set('object-picker-selections', JSON.stringify({
      state: {
        selections: {
          'user-1': {
            'project-1': { 'agent-context': ['agent-1'] },
            'project-2': { 'translation-target': ['target-2'] },
          },
          'user-2': {
            'project-1': { 'translation-context': ['context-1'] },
          },
        },
      },
      version: 2,
    }));

    await useObjectPickerSelectionStore.persist.rehydrate();

    expect(useObjectPickerSelectionStore.getState().selections).toEqual({
      'user-1': {
        'project-1': { 'agent-context': ['agent-1'] },
        'project-2': { 'translation-target': ['target-2'] },
      },
      'user-2': {
        'project-1': { 'translation-context': ['context-1'] },
      },
    });
  });

  it('isolates and restores every bucket within the same user and project', async () => {
    const action = useObjectPickerSelectionStore.getState().replaceSelectionSlice;
    const selections = [
      ['agent-context', 'agent-1'],
      ['ai-edit-context', 'edit-1'],
      ['image-prompt-context', 'image-1'],
      ['translation-target', 'target-1'],
      ['translation-context', 'context-1'],
    ] as const;

    selections.forEach(([bucket, objectId]) => {
      action({
        userId: 'user-1',
        projectId: 'project-1',
        bucket,
        availableIds: [objectId],
        nextSelectedIds: [objectId],
      });
    });

    const expectedBuckets = {
      'agent-context': ['agent-1'],
      'ai-edit-context': ['edit-1'],
      'image-prompt-context': ['image-1'],
      'translation-target': ['target-1'],
      'translation-context': ['context-1'],
    };
    expect(
      useObjectPickerSelectionStore.getState().selections['user-1']['project-1'],
    ).toEqual(expectedBuckets);

    const persisted = storageValues.get('object-picker-selections');
    expect(persisted).toBeDefined();
    if (!persisted) throw new Error('Expected selections to be persisted.');
    useObjectPickerSelectionStore.setState({ selections: {} });
    storageValues.set('object-picker-selections', persisted);

    await useObjectPickerSelectionStore.persist.rehydrate();

    expect(
      useObjectPickerSelectionStore.getState().selections['user-1']['project-1'],
    ).toEqual(expectedBuckets);
  });

  it('replaces only the editable slice and evaluates functional updates atomically', () => {
    useObjectPickerSelectionStore.setState({
      selections: {
        'user-1': {
          'project-1': {
            'ai-edit-context': ['visible-old', 'language-hidden', 'edit-target'],
          },
        },
      },
    });

    useObjectPickerSelectionStore.getState().replaceSelectionSlice({
      userId: 'user-1',
      projectId: 'project-1',
      bucket: 'ai-edit-context',
      availableIds: ['visible-old', 'visible-new', 'edit-target'],
      excludedIds: ['edit-target'],
      nextSelectedIds: (current) => [...current, 'visible-new'],
    });

    expect(
      useObjectPickerSelectionStore.getState()
        .selections['user-1']['project-1']['ai-edit-context'],
    ).toEqual(['language-hidden', 'edit-target', 'visible-old', 'visible-new']);

    useObjectPickerSelectionStore.getState().replaceSelectionSlice({
      userId: 'user-1',
      projectId: 'project-1',
      bucket: 'ai-edit-context',
      availableIds: ['visible-old', 'visible-new', 'edit-target'],
      excludedIds: ['edit-target'],
      nextSelectedIds: ['visible-new'],
    });

    expect(
      useObjectPickerSelectionStore.getState()
        .selections['user-1']['project-1']['ai-edit-context'],
    ).toEqual(['language-hidden', 'edit-target', 'visible-new']);
  });

  it('clears only the deleted project for the owning user', () => {
    useObjectPickerSelectionStore.setState({
      selections: {
        'user-1': {
          'project-1': { 'agent-context': ['one'] },
          'project-2': { 'agent-context': ['two'] },
        },
        'user-2': {
          'project-1': { 'agent-context': ['other-user'] },
        },
      },
    });

    useObjectPickerSelectionStore.getState().clearProject('user-1', 'project-1');

    expect(useObjectPickerSelectionStore.getState().selections).toEqual({
      'user-1': {
        'project-2': { 'agent-context': ['two'] },
      },
      'user-2': {
        'project-1': { 'agent-context': ['other-user'] },
      },
    });
  });

  it('ignores writes without a user or project', () => {
    const action = useObjectPickerSelectionStore.getState().replaceSelectionSlice;
    action({
      userId: '',
      projectId: 'project-1',
      bucket: 'agent-context',
      availableIds: ['one'],
      nextSelectedIds: ['one'],
    });
    action({
      userId: 'user-1',
      projectId: '',
      bucket: 'agent-context',
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
      bucket: 'agent-context',
      availableIds: ['one'],
      nextSelectedIds: 'one',
    });
    expect(
      useObjectPickerSelectionStore.getState()
        .selections['user-1']['project-1']['agent-context'],
    ).toEqual(['one']);

    action({
      userId: 'user-1',
      projectId: 'project-1',
      bucket: 'agent-context',
      availableIds: ['one'],
      nextSelectedIds: '',
    });
    expect(
      useObjectPickerSelectionStore.getState()
        .selections['user-1']['project-1']['agent-context'],
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
