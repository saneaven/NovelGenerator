import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useActivePresetId,
  useVariablesQuery,
  useCreateVariableMutation,
  useUpdateVariableDefinitionMutation,
} from '../../../data/presets';
import { readVariablesFromCache } from '../../../data/presets/presetSelectors';
import {
  buildNewVariableDraft,
  buildVariableCreatePayload,
  buildVariableDefinitionUpdate,
  hydrateVariableDraft,
  type VariableDefinitionDraft,
} from '../PromptEditor/VariableEditor';
import { makeVariableDraftKey, type DirtyItem, type SaveFailure } from '../PromptEditor/draftTypes';
import { toErrorMessage } from '../PromptEditor/draftUtils';
import { generateTempId } from '../../../utils/tempId';

export function useVariableDrafts() {
  const activePresetId = useActivePresetId();
  const { data: variables = [], refetch: refetchVariables } = useVariablesQuery(activePresetId);
  const createVariableMutation = useCreateVariableMutation(activePresetId);
  const updateVariableDefinitionMutation = useUpdateVariableDefinitionMutation(activePresetId);
  const createVariable = createVariableMutation.mutateAsync;
  const updateVariableDefinition = updateVariableDefinitionMutation.mutateAsync;

  const [variableDrafts, setVariableDrafts] = useState<Record<string, VariableDefinitionDraft>>({});
  const [newVariableDraft, setNewVariableDraft] = useState<VariableDefinitionDraft | null>(null);
  const [selectedVariableId, setSelectedVariableId] = useState<string | null>(null);

  const variableDraftsRef = useRef(variableDrafts);
  const variablesRef = useRef(variables);
  useEffect(() => { variableDraftsRef.current = variableDrafts; }, [variableDrafts]);
  useEffect(() => { variablesRef.current = variables; }, [variables]);

  const selectedVariableKey = useMemo(() => {
    if (!selectedVariableId) return null;
    return makeVariableDraftKey(selectedVariableId);
  }, [selectedVariableId]);

  const currentVariableDraft = selectedVariableKey ? variableDrafts[selectedVariableKey] : newVariableDraft;

  const ensureVariableDraftLoaded = useCallback(
    async (variableId: string) => {
      const key = makeVariableDraftKey(variableId);
      if (variableDraftsRef.current[key]) return;

      let variable = variablesRef.current.find((v) => v.id === variableId);
      if (!variable) {
        await refetchVariables().catch(() => undefined);
        variable = readVariablesFromCache().find((v) => v.id === variableId);
        if (!variable) return;
      }

      setVariableDrafts((prev) => ({
        ...prev,
        [key]: hydrateVariableDraft(variable, key),
      }));
    },
    [refetchVariables]
  );

  useEffect(() => {
    if (!selectedVariableId) return;
    ensureVariableDraftLoaded(selectedVariableId);
  }, [ensureVariableDraftLoaded, selectedVariableId]);

  const handleCreateVariable = useCallback(() => {
    if (newVariableDraft) {
      setSelectedVariableId(null);
      return;
    }
    setNewVariableDraft(buildNewVariableDraft(makeVariableDraftKey(generateTempId())));
    setSelectedVariableId(null);
  }, [newVariableDraft]);

  const onDraftChange = useCallback((draft: VariableDefinitionDraft) => {
    if (draft.isNew) {
      setNewVariableDraft(draft);
      return;
    }
    if (!draft.variableId) return;
    const draftKey = makeVariableDraftKey(draft.variableId);
    setVariableDrafts((prev) => ({
      ...prev,
      [draftKey]: draft,
    }));
  }, []);

  const onDeleted = useCallback((variableId: string) => {
    setSelectedVariableId(null);
    setVariableDrafts((prev) => {
      const next = { ...prev };
      delete next[makeVariableDraftKey(variableId)];
      return next;
    });
  }, []);

  const onDiscardNew = useCallback(() => setNewVariableDraft(null), []);

  const getDirtyVariables = useCallback((): DirtyItem[] => {
    const dirty: DirtyItem[] = [];
    for (const d of Object.values(variableDraftsRef.current)) {
      if (!d.dirty) continue;
      dirty.push({
        kind: 'variable',
        key: d.draftKey,
        label: d.current.name || d.original.name || d.variableId || d.draftKey,
        variableId: d.variableId || d.draftKey,
      });
    }
    if (newVariableDraft?.dirty) {
      dirty.push({
        kind: 'variable',
        key: newVariableDraft.draftKey,
        label: newVariableDraft.current.name || 'New Variable',
        variableId: newVariableDraft.variableId || newVariableDraft.draftKey,
      });
    }
    return dirty;
  }, [newVariableDraft]);

  const saveVariables = useCallback(async (): Promise<{ attempted: number; saved: number; failures: SaveFailure[] }> => {
    const failures: SaveFailure[] = [];
    let attempted = 0;
    let saved = 0;

    const dirtyVariables = [
      ...Object.values(variableDraftsRef.current).filter((d) => d.dirty),
      ...(newVariableDraft?.dirty ? [newVariableDraft] : []),
    ];
    for (const d of dirtyVariables) {
      attempted += 1;

      const name = d.current.name.trim();
      if (!name) {
        if (d.isNew) {
          setNewVariableDraft((prev) => (prev?.draftKey === d.draftKey ? { ...prev, error: 'Name is required' } : prev));
        }
        failures.push({
          item: {
            kind: 'variable',
            key: d.draftKey,
            label: d.current.name || d.original.name || d.variableId || d.draftKey,
            variableId: d.variableId || d.draftKey,
          },
          error: 'Name is required',
        });
        continue;
      }

      if (d.error) {
        failures.push({
          item: {
            kind: 'variable',
            key: d.draftKey,
            label: d.current.name || d.original.name || d.variableId || d.draftKey,
            variableId: d.variableId || d.draftKey,
          },
          error: d.error,
        });
        continue;
      }

      try {
        if (d.isNew) {
          const created = await createVariable(buildVariableCreatePayload(d));
          setNewVariableDraft(null);
          setSelectedVariableId(created.id);
        } else {
          await updateVariableDefinition({ id: d.variableId!, data: buildVariableDefinitionUpdate(d) });
          setVariableDrafts((prev) => {
            const key = makeVariableDraftKey(d.variableId!);
            const cur = prev[key];
            if (!cur) return prev;
            return {
              ...prev,
              [key]: {
                ...cur,
                original: {
                  ...cur.current,
                  select_options: [...cur.current.select_options],
                  number_options: { ...cur.current.number_options },
                },
                dirty: false,
                error: '',
              },
            };
          });
        }
        saved += 1;
      } catch (error) {
        failures.push({
          item: {
            kind: 'variable',
            key: d.draftKey,
            label: d.current.name || d.original.name || d.variableId || d.draftKey,
            variableId: d.variableId || d.draftKey,
          },
          error: toErrorMessage(error),
        });
        if (d.isNew) {
          setNewVariableDraft((prev) => (prev?.draftKey === d.draftKey ? { ...prev, error: toErrorMessage(error) } : prev));
        } else {
          setVariableDrafts((prev) => {
            const cur = prev[d.draftKey];
            if (!cur) return prev;
            return {
              ...prev,
              [d.draftKey]: {
                ...cur,
                error: toErrorMessage(error),
              },
            };
          });
        }
      }
    }

    return { attempted, saved, failures };
  }, [createVariable, newVariableDraft, updateVariableDefinition]);

  const discardVariables = useCallback(() => {
    setVariableDrafts((prev) => {
      const next: Record<string, VariableDefinitionDraft> = { ...prev };
      for (const [k, d] of Object.entries(next)) {
        if (!d.dirty) continue;
        next[k] = {
          ...d,
          current: {
            ...d.original,
            select_options: [...d.original.select_options],
            number_options: { ...d.original.number_options },
          },
          dirty: false,
          error: '',
        };
      }
      return next;
    });
    setNewVariableDraft(null);
  }, []);

  const resetAll = useCallback(() => {
    setVariableDrafts({});
    setNewVariableDraft(null);
    setSelectedVariableId(null);
  }, []);

  const dirtyCount = useMemo(() => {
    return Object.values(variableDrafts).filter((d) => d.dirty).length + (newVariableDraft?.dirty ? 1 : 0);
  }, [variableDrafts, newVariableDraft]);

  return {
    variableDrafts,
    newVariableDraft,
    selectedVariableId,
    setSelectedVariableId,
    selectedVariableKey,
    currentVariableDraft,
    ensureVariableDraftLoaded,
    handleCreateVariable,
    onDraftChange,
    onDeleted,
    onDiscardNew,
    getDirtyVariables,
    saveVariables,
    discardVariables,
    resetAll,
    dirtyCount,
  };
}
