import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fragmentService } from '../../../api/fragmentService';
import { confirm } from '../../../store/dialogStore';
import { makeFragmentDraftKey, type DirtyItem, type FragmentDraft, type SaveFailure, type SelectedFragment } from '../PromptEditor/draftTypes';
import { getDraftFragmentFullPath, getFragmentDraftLabel, isFragmentDraftDirty, toErrorMessage, validateFragmentContent } from '../PromptEditor/draftUtils';
import { generateTempId } from '../../../utils/tempId';

export function useFragmentDrafts() {
  const { t } = useTranslation();

  const [fragmentDrafts, setFragmentDrafts] = useState<Record<string, FragmentDraft>>({});
  const [newFragmentDraft, setNewFragmentDraft] = useState<FragmentDraft | null>(null);
  const [selectedFragment, setSelectedFragment] = useState<SelectedFragment | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [allFragmentContents, setAllFragmentContents] = useState<Map<string, string>>(new Map());

  // Ref mirroring
  const fragmentDraftsRef = useRef(fragmentDrafts);
  const allFragmentContentsRef = useRef(allFragmentContents);
  useEffect(() => { fragmentDraftsRef.current = fragmentDrafts; }, [fragmentDrafts]);
  useEffect(() => { allFragmentContentsRef.current = allFragmentContents; }, [allFragmentContents]);

  // loadFragmentContents
  const loadFragmentContents = useCallback(async () => {
    try {
      const fragments = await fragmentService.getAllFragmentsWithContent();
      const map = new Map<string, string>();
      for (const f of fragments) {
        const path = f.folder_path ? `${f.folder_path}/${f.fragment_name}` : f.fragment_name;
        map.set(path, f.content);
      }
      setAllFragmentContents(map);
    } catch { /* ignore */ }
  }, []);

  // selectedPath / selectedFragmentKey derived
  const selectedPath = useMemo(() => {
    if (!selectedFragment) return null;
    return selectedFragment.fullPath;
  }, [selectedFragment]);

  const selectedFragmentKey = useMemo(() => {
    if (!selectedFragment) return null;
    return makeFragmentDraftKey(selectedFragment.folderId, selectedFragment.fragmentName);
  }, [selectedFragment]);

  // currentFragmentDraft
  const currentFragmentDraft = selectedFragmentKey ? fragmentDrafts[selectedFragmentKey] : newFragmentDraft;

  // ensureFragmentDraftLoaded
  const ensureFragmentDraftLoaded = useCallback(async (folderId: string | null, fragmentName: string, fullPath: string) => {
    const key = makeFragmentDraftKey(folderId, fragmentName);
    if (fragmentDraftsRef.current[key]?.originalContent !== undefined) return;

    setFragmentDrafts((prev) => ({
      ...prev,
      [key]: {
        key,
        label: fullPath,
        folderId,
        sourceFolderId: folderId,
        sourceFragmentName: fragmentName,
        folderPath: fullPath.includes('/') ? fullPath.slice(0, fullPath.lastIndexOf('/')) : '',
        fragmentName,
        fullPath,
        isLoading: true,
        isNew: false,
        originalContent: '',
        originalDescription: '',
        content: '',
        description: '',
        dirty: false,
        validation: null,
        isDeleting: false,
      },
    }));

    try {
      const fragment = await fragmentService.getFragment(folderId, fragmentName);
      setFragmentDrafts((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] as FragmentDraft),
          isLoading: false,
          loadError: undefined,
          originalContent: fragment.content,
          originalDescription: fragment.description || '',
          content: fragment.content,
          description: fragment.description || '',
          dirty: false,
        },
      }));
    } catch (error) {
      setFragmentDrafts((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] as FragmentDraft),
          isLoading: false,
          loadError: toErrorMessage(error),
        },
      }));
    }
  }, []);

  // Load on selection change
  useEffect(() => {
    if (!selectedFragment) return;
    ensureFragmentDraftLoaded(selectedFragment.folderId, selectedFragment.fragmentName, selectedFragment.fullPath);
  }, [selectedFragment?.folderId, selectedFragment?.fragmentName, selectedFragment?.fullPath, ensureFragmentDraftLoaded]);

  // Fragment content validation effect (debounced)
  useEffect(() => {
    if (!currentFragmentDraft || currentFragmentDraft.isLoading) return;
    const key = currentFragmentDraft.key;
    const timer = window.setTimeout(async () => {
      const validation = await validateFragmentContent(currentFragmentDraft.content, currentFragmentDraft.fullPath, fragmentDraftsRef.current, allFragmentContentsRef.current);
      if (currentFragmentDraft.isNew) {
        setNewFragmentDraft((prev) => (prev?.key === key ? { ...prev, validation } : prev));
      } else {
        setFragmentDrafts((prev) => {
          const cur = prev[key];
          if (!cur) return prev;
          return { ...prev, [key]: { ...cur, validation } };
        });
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [currentFragmentDraft?.content, currentFragmentDraft?.fullPath, currentFragmentDraft?.isLoading, currentFragmentDraft?.key]);

  // handleFragmentSelect
  const handleFragmentSelect = useCallback((folderId: string | null, fragmentName: string, fullPath: string) => {
    setSelectedFragment({ folderId, fragmentName, fullPath });
  }, []);

  // handleCreateFragment
  const handleCreateFragment = useCallback((folderPath: string | null) => {
    if (newFragmentDraft) {
      setSelectedFragment(null);
      return;
    }

    const tempId = generateTempId();
    const draft: FragmentDraft = {
      key: `fragment:${tempId}`,
      label: getFragmentDraftLabel({ folderPath: folderPath || '', fragmentName: '' }),
      folderId: null,
      sourceFolderId: null,
      sourceFragmentName: null,
      folderPath: folderPath || '',
      fragmentName: '',
      fullPath: '',
      isLoading: false,
      isNew: true,
      originalContent: '',
      originalDescription: '',
      content: '',
      description: '',
      dirty: true,
      validation: null,
      isDeleting: false,
    };
    setNewFragmentDraft(draft);
    setSelectedFragment(null);
  }, [newFragmentDraft]);

  // handleFragmentDeleted
  const handleFragmentDeleted = useCallback(() => {
    setSelectedFragment(null);
    setRefreshTrigger((prev) => prev + 1);
    loadFragmentContents().catch(() => undefined);
  }, [loadFragmentContents]);

  // handleFolderDeleted
  const handleFolderDeleted = useCallback((deletedFolderPath: string) => {
    setFragmentDrafts((prev) => Object.fromEntries(
      Object.entries(prev).filter(([, draft]) => !draft.fullPath.startsWith(`${deletedFolderPath}/`))
    ));
    setNewFragmentDraft((prev) => {
      if (!prev) return null;
      return prev.fullPath.startsWith(`${deletedFolderPath}/`) ? null : prev;
    });
    setSelectedFragment((prev) => {
      if (!prev) return null;
      return prev.fullPath.startsWith(`${deletedFolderPath}/`) ? null : prev;
    });
    loadFragmentContents().catch(() => undefined);
  }, [loadFragmentContents]);

  // updateCurrentFragmentDraft
  const updateCurrentFragmentDraft = useCallback((updater: (draft: FragmentDraft) => FragmentDraft) => {
    if (!currentFragmentDraft) return;
    if (currentFragmentDraft.isNew) {
      setNewFragmentDraft((prev) => {
        if (!prev || prev.key !== currentFragmentDraft.key) return prev;
        return updater(prev);
      });
      return;
    }
    setFragmentDrafts((prev) => {
      const cur = prev[currentFragmentDraft.key];
      if (!cur) return prev;
      return {
        ...prev,
        [currentFragmentDraft.key]: updater(cur),
      };
    });
  }, [currentFragmentDraft]);

  // handleDescriptionChange
  const handleDescriptionChange = useCallback((value: string) => {
    if (!currentFragmentDraft) return;
    updateCurrentFragmentDraft((draft) => ({
      ...draft,
      description: value,
      dirty: isFragmentDraftDirty({
        ...draft,
        description: value,
      }),
      loadError: undefined,
    }));
  }, [currentFragmentDraft, updateCurrentFragmentDraft]);

  // handleFragmentNameChange
  const handleFragmentNameChange = useCallback((value: string) => {
    if (!currentFragmentDraft || currentFragmentDraft.isNew) return;
    updateCurrentFragmentDraft((draft) => {
      const nextDraft = {
        ...draft,
        fragmentName: value,
      };
      const fullPath = getDraftFragmentFullPath(nextDraft);
      return {
        ...nextDraft,
        fullPath,
        label: getFragmentDraftLabel(nextDraft),
        dirty: isFragmentDraftDirty({
          ...nextDraft,
          fragmentName: value,
        }),
        loadError: undefined,
      };
    });
  }, [currentFragmentDraft, updateCurrentFragmentDraft]);

  // handleDeleteSelectedFragment
  const handleDeleteSelectedFragment = useCallback(async () => {
    if (!currentFragmentDraft) return;
    if (currentFragmentDraft.isNew) {
      setNewFragmentDraft(null);
      return;
    }
    const ok = await confirm({
      title: 'Delete Fragment',
      message: `Are you sure you want to delete "${currentFragmentDraft.fullPath}"? This will delete all versions.`,
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!ok) return;

    const key = currentFragmentDraft.key;
    setFragmentDrafts((prev) => {
      const cur = prev[key];
      if (!cur) return prev;
      return { ...prev, [key]: { ...cur, isDeleting: true } };
    });

    try {
      await fragmentService.deleteFragment(currentFragmentDraft.sourceFolderId, currentFragmentDraft.sourceFragmentName!);
      setFragmentDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      handleFragmentDeleted();
    } catch (error) {
      setFragmentDrafts((prev) => {
        const cur = prev[key];
        if (!cur) return prev;
        return { ...prev, [key]: { ...cur, isDeleting: false, loadError: toErrorMessage(error) } };
      });
    }
  }, [currentFragmentDraft, handleFragmentDeleted]);

  // getDirtyFragments
  const getDirtyFragments = useCallback((): DirtyItem[] => {
    const dirty: DirtyItem[] = [];
    for (const d of Object.values(fragmentDraftsRef.current)) {
      if (!d.dirty) continue;
      dirty.push({
        kind: 'fragment',
        key: d.key,
        label: d.label,
        folderId: d.folderId,
        fragmentName: d.fragmentName,
        fullPath: d.fullPath,
      });
    }
    if (newFragmentDraft?.dirty) {
      dirty.push({
        kind: 'fragment',
        key: newFragmentDraft.key,
        label: newFragmentDraft.label,
        folderId: newFragmentDraft.folderId,
        fragmentName: newFragmentDraft.fragmentName,
        fullPath: newFragmentDraft.fullPath,
      });
    }
    return dirty;
  }, [newFragmentDraft]);

  // saveFragments
  const saveFragments = useCallback(async (): Promise<{ attempted: number; saved: number; failures: SaveFailure[] }> => {
    const failures: SaveFailure[] = [];
    let attempted = 0;
    let saved = 0;

    const dirtyFragments = [
      ...Object.values(fragmentDraftsRef.current).filter((d) => d.dirty),
      ...(newFragmentDraft?.dirty ? [newFragmentDraft] : []),
    ];
    let didSaveAnyFragment = false;
    for (const d of dirtyFragments) {
      attempted += 1;
      const trimmedName = d.fragmentName.trim();
      const applyFragmentError = (message: string) => {
        if (d.isNew) {
          setNewFragmentDraft((prev) => (prev?.key === d.key ? { ...prev, loadError: message } : prev));
          return;
        }
        setFragmentDrafts((prev) => {
          const cur = prev[d.key];
          if (!cur) return prev;
          return { ...prev, [d.key]: { ...cur, loadError: message } };
        });
      };

      if (!trimmedName) {
        const errorMessage = t('settings.promptEditor.createFragment.nameRequired');
        failures.push({
          item: { kind: 'fragment', key: d.key, label: d.label, folderId: d.folderId, fragmentName: d.fragmentName, fullPath: d.fullPath },
          error: errorMessage,
        });
        applyFragmentError(errorMessage);
        continue;
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
        const errorMessage = t('settings.promptEditor.createFragment.invalidName');
        failures.push({
          item: { kind: 'fragment', key: d.key, label: d.label, folderId: d.folderId, fragmentName: d.fragmentName, fullPath: d.fullPath },
          error: errorMessage,
        });
        applyFragmentError(errorMessage);
        continue;
      }
      const validation = await validateFragmentContent(d.content, d.fullPath, fragmentDraftsRef.current, allFragmentContentsRef.current);
      if (!validation.valid) {
        failures.push({
          item: { kind: 'fragment', key: d.key, label: d.label, folderId: d.folderId, fragmentName: d.fragmentName, fullPath: d.fullPath },
          error: validation.errors[0]?.message || t('settings.promptEditor.toast.templateSyntaxError'),
        });
        if (d.isNew) {
          setNewFragmentDraft((prev) => (prev?.key === d.key ? { ...prev, validation, loadError: validation.errors[0]?.message } : prev));
        } else {
          setFragmentDrafts((prev) => {
            const cur = prev[d.key];
            if (!cur) return prev;
            return { ...prev, [d.key]: { ...cur, validation, loadError: validation.errors[0]?.message } };
          });
        }
        continue;
      }

      try {
        if (d.isNew) {
          const created = await fragmentService.createFragment(
            { folderPath: d.folderPath.trim() || null },
            trimmedName,
            d.content,
            d.description || undefined,
            'Initial creation'
          );
          setNewFragmentDraft(null);
          setSelectedFragment({
            folderId: created.folder_id,
            fragmentName: created.fragment_name,
            fullPath: created.folder_path ? `${created.folder_path}/${created.fragment_name}` : created.fragment_name,
          });
        } else {
          const updated = await fragmentService.updateFragment(d.sourceFolderId, d.sourceFragmentName!, {
            content: d.content,
            description: d.description || undefined,
            fragment_name: trimmedName !== d.sourceFragmentName ? trimmedName : undefined,
          });
          const nextFullPath = updated.folder_path ? `${updated.folder_path}/${updated.fragment_name}` : updated.fragment_name;
          const nextKey = makeFragmentDraftKey(updated.folder_id, updated.fragment_name);
          setFragmentDrafts((prev) => {
            const cur = prev[d.key];
            if (!cur) return prev;
            const nextDraft: FragmentDraft = {
              ...cur,
              key: nextKey,
              label: nextFullPath,
              folderId: updated.folder_id,
              sourceFolderId: updated.folder_id,
              sourceFragmentName: updated.fragment_name,
              folderPath: updated.folder_path || '',
              fragmentName: updated.fragment_name,
              fullPath: nextFullPath,
              originalContent: updated.content,
              originalDescription: updated.description || '',
              content: updated.content,
              description: updated.description || '',
              dirty: false,
              validation,
              loadError: undefined,
            };
            if (nextKey === d.key) {
              return { ...prev, [d.key]: nextDraft };
            }
            const next = { ...prev };
            delete next[d.key];
            next[nextKey] = nextDraft;
            return { ...next };
          });
          setSelectedFragment({
            folderId: updated.folder_id,
            fragmentName: updated.fragment_name,
            fullPath: nextFullPath,
          });
        }
        didSaveAnyFragment = true;
        saved += 1;
      } catch (error) {
        const errorMessage = toErrorMessage(error);
        failures.push({
          item: { kind: 'fragment', key: d.key, label: d.label, folderId: d.folderId, fragmentName: d.fragmentName, fullPath: d.fullPath },
          error: errorMessage,
        });
        applyFragmentError(errorMessage);
      }
    }

    if (didSaveAnyFragment) {
      await loadFragmentContents();
      setRefreshTrigger((prev) => prev + 1);
    }

    return { attempted, saved, failures };
  }, [loadFragmentContents, newFragmentDraft, t]);

  // discardFragments
  const discardFragments = useCallback(() => {
    setFragmentDrafts((prev) => {
      const next: Record<string, FragmentDraft> = { ...prev };
      for (const [k, d] of Object.entries(next)) {
        if (!d.dirty) continue;
        const fragmentName = d.sourceFragmentName || d.fragmentName;
        const fullPath = getDraftFragmentFullPath({ folderPath: d.folderPath, fragmentName });
        next[k] = {
          ...d,
          label: getFragmentDraftLabel({ folderPath: d.folderPath, fragmentName }),
          fragmentName,
          fullPath,
          content: d.originalContent,
          description: d.originalDescription,
          dirty: false,
          loadError: undefined,
        };
      }
      return next;
    });
    setNewFragmentDraft(null);
  }, []);

  // resetAll
  const resetAll = useCallback(() => {
    setFragmentDrafts({});
    setNewFragmentDraft(null);
    setSelectedFragment(null);
    setRefreshTrigger((prev) => prev + 1);
    loadFragmentContents().catch(() => undefined);
  }, [loadFragmentContents]);

  // restoreFragmentVersion
  const restoreFragmentVersion = useCallback(async (folderId: string | null, fragmentName: string, versionNumber: number) => {
    await fragmentService.restoreVersion(folderId, fragmentName, versionNumber);
    const fragment = await fragmentService.getFragment(folderId, fragmentName);
    const key = makeFragmentDraftKey(folderId, fragmentName);
    setFragmentDrafts((prev) => {
      const cur = prev[key];
      if (!cur) return prev;
      return {
        ...prev,
        [key]: {
          ...cur,
          originalContent: fragment.content,
          originalDescription: fragment.description || '',
          content: fragment.content,
          description: fragment.description || '',
          dirty: false,
        },
      };
    });
  }, []);

  // dirtyCount
  const dirtyCount = useMemo(() => {
    return Object.values(fragmentDrafts).filter((d) => d.dirty).length + (newFragmentDraft?.dirty ? 1 : 0);
  }, [fragmentDrafts, newFragmentDraft]);

  return {
    fragmentDrafts,
    setFragmentDrafts,
    newFragmentDraft,
    setNewFragmentDraft,
    selectedFragment,
    setSelectedFragment,
    refreshTrigger,
    allFragmentContents,
    fragmentDraftsRef,
    allFragmentContentsRef,
    loadFragmentContents,
    selectedPath,
    selectedFragmentKey,
    currentFragmentDraft,
    ensureFragmentDraftLoaded,
    handleFragmentSelect,
    handleCreateFragment,
    handleFragmentDeleted,
    handleFolderDeleted,
    updateCurrentFragmentDraft,
    handleDescriptionChange,
    handleFragmentNameChange,
    handleDeleteSelectedFragment,
    getDirtyFragments,
    saveFragments,
    discardFragments,
    resetAll,
    restoreFragmentVersion,
    dirtyCount,
  };
}
