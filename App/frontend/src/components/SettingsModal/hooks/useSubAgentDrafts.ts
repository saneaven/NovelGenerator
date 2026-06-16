import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useActivePresetId,
  useSubAgentsQuery,
  useCreateSubAgentMutation,
  useUpdateSubAgentMutation,
} from '../../../data/presets';
import { readSubAgentsFromCache } from '../../../data/presets/presetSelectors';
import { fetchScenario, invalidateScenario } from '../../../data/settings';
import { scenarioService } from '../../../api/scenarioService';
import {
  buildEmptySubAgentDraft,
  buildSubAgentPayload,
  hydrateSubAgentDraft,
  normalizeAgentName,
  type SubAgentDefinitionDraft,
} from '../PromptEditor/SubAgentEditor';
import { makeSubAgentDraftKey, type DirtyItem, type SaveFailure, type ScenarioDraft } from '../PromptEditor/draftTypes';
import { buildDefaultSubAgentScenario, getSubAgentScenarioLabel, toErrorMessage } from '../PromptEditor/draftUtils';
import {
  DEFAULT_SUB_AGENT_SYSTEM_PROMPT,
  DEFAULT_SUB_AGENT_USER_PROMPT,
} from '../PromptEditor/subAgentDefaults';
import { generateTempId } from '../../../utils/tempId';
import type { ScenarioDocument } from '../../../types/scenarios';

export function useSubAgentDrafts() {
  const activePresetId = useActivePresetId();
  const { data: subAgents = [], refetch: refetchSubAgents } = useSubAgentsQuery(activePresetId);
  const createSubAgentMutation = useCreateSubAgentMutation(activePresetId);
  const updateSubAgentMutation = useUpdateSubAgentMutation(activePresetId);
  const createSubAgent = createSubAgentMutation.mutateAsync;
  const updateSubAgent = updateSubAgentMutation.mutateAsync;
  const loadScenario = fetchScenario;
  const invalidateScenarioCache = invalidateScenario;

  const [subAgentDrafts, setSubAgentDrafts] = useState<Record<string, SubAgentDefinitionDraft>>({});
  const [subAgentScenarioDrafts, setSubAgentScenarioDrafts] = useState<Record<string, ScenarioDraft>>({});
  const [newSubAgentDraft, setNewSubAgentDraft] = useState<SubAgentDefinitionDraft | null>(null);
  const [selectedSubAgentId, setSelectedSubAgentId] = useState<string | null>(null);

  // Ref mirroring
  const subAgentDraftsRef = useRef(subAgentDrafts);
  const subAgentScenarioDraftsRef = useRef(subAgentScenarioDrafts);
  const subAgentsRef = useRef(subAgents);
  useEffect(() => { subAgentDraftsRef.current = subAgentDrafts; }, [subAgentDrafts]);
  useEffect(() => { subAgentScenarioDraftsRef.current = subAgentScenarioDrafts; }, [subAgentScenarioDrafts]);
  useEffect(() => { subAgentsRef.current = subAgents; }, [subAgents]);

  // Derived values
  const selectedSubAgentKey = useMemo(() => {
    if (!selectedSubAgentId) return null;
    return makeSubAgentDraftKey(selectedSubAgentId);
  }, [selectedSubAgentId]);

  const currentSubAgentDraft = selectedSubAgentKey ? subAgentDrafts[selectedSubAgentKey] : newSubAgentDraft;
  const currentSubAgentScenarioKey = selectedSubAgentKey ?? newSubAgentDraft?.draftKey ?? null;
  const currentSubAgentScenarioDraft = currentSubAgentScenarioKey ? subAgentScenarioDrafts[currentSubAgentScenarioKey] : null;

  const selectedSubAgent = useMemo(() => {
    if (!selectedSubAgentId) return null;
    return subAgents.find((s) => s.id === selectedSubAgentId) || null;
  }, [selectedSubAgentId, subAgents]);

  const subAgentIdentityName = useMemo(() => {
    return currentSubAgentDraft?.isNew
      ? normalizeAgentName(currentSubAgentDraft.current.agent_name) || null
      : currentSubAgentDraft?.original.agent_name || selectedSubAgent?.agent_name || null;
  }, [currentSubAgentDraft, selectedSubAgent]);

  // handleSubAgentDraftChange
  const handleSubAgentDraftChange = useCallback((draft: SubAgentDefinitionDraft) => {
    const scenarioLabel = getSubAgentScenarioLabel(draft.current.display_name, draft.current.agent_name);
    const scenarioTaskSubtype = normalizeAgentName(draft.current.agent_name) || 'new_agent';
    if (draft.isNew) {
      setNewSubAgentDraft(draft);
      setSubAgentScenarioDrafts((prev) => {
        const current = prev[draft.draftKey];
        if (!current) return prev;
        return {
          ...prev,
          [draft.draftKey]: {
            ...current,
            label: scenarioLabel,
            taskSubtype: scenarioTaskSubtype,
          },
        };
      });
      return;
    }
    if (!draft.subAgentId) return;
    const draftKey = makeSubAgentDraftKey(draft.subAgentId);
    setSubAgentDrafts((prev) => ({
      ...prev,
      [draftKey]: draft,
    }));
    setSubAgentScenarioDrafts((prev) => {
      const current = prev[draftKey];
      if (!current) return prev;
      return {
        ...prev,
        [draftKey]: {
          ...current,
          label: scenarioLabel,
        },
      };
    });
  }, []);

  // ensureSubAgentDraftLoaded
  const ensureSubAgentDraftLoaded = useCallback(
    async (subAgentId: string) => {
      const key = makeSubAgentDraftKey(subAgentId);
      if (subAgentDraftsRef.current[key]) return;

      let agent = subAgentsRef.current.find((s) => s.id === subAgentId);
      if (!agent) {
        await refetchSubAgents().catch(() => undefined);
        agent = readSubAgentsFromCache().find((s) => s.id === subAgentId);
        if (!agent) return;
      }

      setSubAgentDrafts((prev) => ({
        ...prev,
        [key]: hydrateSubAgentDraft(agent, key),
      }));
    },
    [refetchSubAgents],
  );

  // ensureSubAgentScenarioDraftLoaded
  const ensureSubAgentScenarioDraftLoaded = useCallback(
    async (subAgentId: string, label: string) => {
      const key = makeSubAgentDraftKey(subAgentId);
      if (subAgentScenarioDraftsRef.current[key]) return;

      const agent = subAgentsRef.current.find((item) => item.id === subAgentId);
      if (!agent) return;

      const emptyScenario: ScenarioDocument = { system_template: '', blocks: [] };
      setSubAgentScenarioDrafts((prev) => ({
        ...prev,
        [key]: {
          key,
          label,
          taskType: 'subAgent',
          taskSubtype: agent.agent_name,
          isLoading: true,
          originalScenario: emptyScenario,
          scenario: emptyScenario,
          dirty: false,
          saveWarnings: [],
        },
      }));

      try {
        const loaded = await loadScenario('subAgent', agent.agent_name);
        setSubAgentScenarioDrafts((prev) => ({
          ...prev,
          [key]: {
            ...(prev[key] as ScenarioDraft),
            isLoading: false,
            loadError: undefined,
            originalScenario: loaded,
            scenario: loaded,
            dirty: false,
            saveWarnings: [],
          },
        }));
      } catch (error) {
        setSubAgentScenarioDrafts((prev) => ({
          ...prev,
          [key]: {
            ...(prev[key] as ScenarioDraft),
            isLoading: false,
            loadError: toErrorMessage(error),
          },
        }));
      }
    },
    [loadScenario],
  );

  // Load effects on selection change
  useEffect(() => {
    if (!selectedSubAgentId) return;
    ensureSubAgentDraftLoaded(selectedSubAgentId);
  }, [ensureSubAgentDraftLoaded, selectedSubAgentId]);

  useEffect(() => {
    if (!selectedSubAgentId) return;
    if (!subAgentIdentityName) return;
    const displayName =
      currentSubAgentDraft?.current.display_name
      || selectedSubAgent?.display_name
      || subAgentIdentityName;
    ensureSubAgentScenarioDraftLoaded(
      selectedSubAgentId,
      `Sub Agent: ${displayName} / call_${subAgentIdentityName}`,
    );
  }, [currentSubAgentDraft?.current.display_name, ensureSubAgentScenarioDraftLoaded, selectedSubAgent?.display_name, selectedSubAgentId, subAgentIdentityName]);

  // New sub-agent scenario initialization effect
  useEffect(() => {
    if (!newSubAgentDraft) return;
    const label = getSubAgentScenarioLabel(newSubAgentDraft.current.display_name, newSubAgentDraft.current.agent_name);
    const taskSubtype = normalizeAgentName(newSubAgentDraft.current.agent_name) || 'new_agent';
    setSubAgentScenarioDrafts((prev) => {
      const current = prev[newSubAgentDraft.draftKey];
      if (current) {
        return {
          ...prev,
          [newSubAgentDraft.draftKey]: {
            ...current,
            label,
            taskSubtype,
          },
        };
      }
      const baseScenario = buildDefaultSubAgentScenario();
      return {
        ...prev,
        [newSubAgentDraft.draftKey]: {
          key: newSubAgentDraft.draftKey,
          label,
          taskType: 'subAgent',
          taskSubtype,
          isLoading: false,
          originalScenario: baseScenario,
          scenario: baseScenario,
          dirty: false,
          saveWarnings: [],
        },
      };
    });
  }, [newSubAgentDraft]);

  // handleCreateSubAgent
  const handleCreateSubAgent = useCallback(() => {
    if (newSubAgentDraft) {
      setSelectedSubAgentId(null);
      return;
    }
    setNewSubAgentDraft(buildEmptySubAgentDraft(makeSubAgentDraftKey(generateTempId())));
    setSelectedSubAgentId(null);
  }, [newSubAgentDraft]);

  // onScenarioChange
  const onScenarioChange = useCallback((nextScenario: ScenarioDocument) => {
    if (!currentSubAgentScenarioKey) return;
    setSubAgentScenarioDrafts((prev) => {
      const cur = prev[currentSubAgentScenarioKey];
      if (!cur) return prev;
      const dirty = JSON.stringify(nextScenario) !== JSON.stringify(cur.originalScenario);
      return {
        ...prev,
        [currentSubAgentScenarioKey]: {
          ...cur,
          scenario: nextScenario,
          dirty,
          saveWarnings: [],
        },
      };
    });
  }, [currentSubAgentScenarioKey]);

  // onReloadScenario
  const onReloadScenario = useCallback(async () => {
    if (!currentSubAgentScenarioKey || !currentSubAgentScenarioDraft || currentSubAgentDraft?.isNew) return;
    invalidateScenarioCache('subAgent', currentSubAgentScenarioDraft.taskSubtype);
    const loaded = await loadScenario('subAgent', currentSubAgentScenarioDraft.taskSubtype);
    setSubAgentScenarioDrafts((prev) => {
      const cur = prev[currentSubAgentScenarioKey];
      if (!cur) return prev;
      return {
        ...prev,
        [currentSubAgentScenarioKey]: {
          ...cur,
          originalScenario: loaded,
          scenario: loaded,
          dirty: false,
          saveWarnings: [],
        },
      };
    });
  }, [currentSubAgentDraft?.isNew, currentSubAgentScenarioDraft, currentSubAgentScenarioKey, invalidateScenarioCache, loadScenario]);

  // onDeleted
  const onDeleted = useCallback((subAgentId: string) => {
    setSelectedSubAgentId(null);
    setSubAgentDrafts((prev) => {
      const next = { ...prev };
      delete next[makeSubAgentDraftKey(subAgentId)];
      return next;
    });
    setSubAgentScenarioDrafts((prev) => {
      const next = { ...prev };
      delete next[makeSubAgentDraftKey(subAgentId)];
      return next;
    });
  }, []);

  // onDiscardNew
  const onDiscardNew = useCallback(() => {
    if (!newSubAgentDraft) return;
    setSubAgentScenarioDrafts((prev) => {
      const next = { ...prev };
      delete next[newSubAgentDraft.draftKey];
      return next;
    });
    setNewSubAgentDraft(null);
  }, [newSubAgentDraft]);

  // getDirtySubAgents
  const getDirtySubAgents = useCallback((): DirtyItem[] => {
    const dirty: DirtyItem[] = [];
    // Sub-agent scenario drafts
    for (const d of Object.values(subAgentScenarioDraftsRef.current)) {
      if (!d.dirty) continue;
      dirty.push({
        kind: 'scenario',
        key: d.key,
        label: d.label,
        taskType: d.taskType,
        taskSubtype: d.taskSubtype,
        nodeId: d.nodeId,
      });
    }
    // Sub-agent definition drafts
    for (const d of Object.values(subAgentDraftsRef.current)) {
      if (!d.dirty) continue;
      dirty.push({
        kind: 'subAgent',
        key: d.draftKey,
        label: d.current.display_name || d.original.display_name || d.subAgentId || d.draftKey,
        subAgentId: d.subAgentId || d.draftKey,
      });
    }
    if (newSubAgentDraft?.dirty) {
      dirty.push({
        kind: 'subAgent',
        key: newSubAgentDraft.draftKey,
        label: newSubAgentDraft.current.display_name || 'New Sub Agent',
        subAgentId: newSubAgentDraft.subAgentId || newSubAgentDraft.draftKey,
      });
    }
    return dirty;
  }, [newSubAgentDraft]);

  // saveSubAgents
  const saveSubAgents = useCallback(async (): Promise<{ attempted: number; saved: number; failures: SaveFailure[] }> => {
    const failures: SaveFailure[] = [];
    let attempted = 0;
    let saved = 0;

    // 1. Save existing sub-agent scenario drafts
    const dirtyExistingSubAgentPromptScenarios = Object.values(subAgentScenarioDraftsRef.current).filter((d) => {
      if (!d.dirty) return false;
      return d.key !== newSubAgentDraft?.draftKey;
    });
    for (const d of dirtyExistingSubAgentPromptScenarios) {
      attempted += 1;
      try {
        const result = await scenarioService.saveScenario(d.taskType, d.taskSubtype, d.scenario);
        invalidateScenarioCache(d.taskType, d.taskSubtype);
        saved += 1;
        setSubAgentScenarioDrafts((prev) => {
          const cur = prev[d.key];
          if (!cur) return prev;
          return {
            ...prev,
            [d.key]: {
              ...cur,
              originalScenario: result.scenario,
              scenario: result.scenario,
              dirty: false,
              saveWarnings: result.warnings || [],
            },
          };
        });
      } catch (error) {
        failures.push({
          item: {
            kind: 'scenario',
            key: d.key,
            label: d.label,
            taskType: d.taskType,
            taskSubtype: d.taskSubtype,
            nodeId: d.nodeId,
          },
          error: toErrorMessage(error),
        });
      }
    }

    // 2. Save existing sub-agent definition drafts
    const dirtySubAgents = Object.values(subAgentDraftsRef.current).filter((d) => d.dirty);
    for (const d of dirtySubAgents) {
      attempted += 1;

      if (d.error) {
        failures.push({
          item: {
            kind: 'subAgent',
            key: d.draftKey,
            label: d.current.display_name || d.original.display_name || d.subAgentId || d.draftKey,
            subAgentId: d.subAgentId || d.draftKey,
          },
          error: d.error,
        });
        continue;
      }

      let agent_name = d.current.agent_name.trim();
      if (agent_name.startsWith('call_')) {
        agent_name = agent_name.slice('call_'.length);
      }

      try {
        const updated = await updateSubAgent({
          id: d.subAgentId!,
          data: {
            agent_name,
            display_name: d.current.display_name.trim(),
            description: d.current.description.trim(),
            enabled: d.current.enabled,
            allowed_invocation_modes: d.current.allowed_invocation_modes,
            tool_grants: d.current.tool_grants.map((item) => ({
              feature_key: item.feature_key,
              categories: [...item.categories],
            })),
            allowed_sub_agent_ids: d.current.allowed_sub_agent_ids,
            allowed_mcp_server_ids: d.current.allowed_mcp_server_ids,
            use_custom_llm_config: d.current.use_custom_llm_config,
            llm_config_override: d.current.llm_config_override,
          },
        });

        saved += 1;
        setSubAgentScenarioDrafts((prev) => {
          const key = makeSubAgentDraftKey(d.subAgentId!);
          const cur = prev[key];
          if (!cur) return prev;
          return {
            ...prev,
            [key]: {
              ...cur,
              label: getSubAgentScenarioLabel(updated.display_name, updated.agent_name),
              taskSubtype: updated.agent_name,
            },
          };
        });
        setSubAgentDrafts((prev) => {
          const key = makeSubAgentDraftKey(d.subAgentId!);
          const cur = prev[key];
          if (!cur) return prev;

          const base = {
            agent_name: updated.agent_name,
            display_name: updated.display_name,
            description: updated.description,
            enabled: updated.enabled,
            allowed_invocation_modes: [...updated.allowed_invocation_modes],
            tool_grants: [...updated.tool_grants].map((item) => ({
              feature_key: item.feature_key,
              categories: [...item.categories],
            })),
            allowed_sub_agent_ids: [...updated.allowed_sub_agent_ids],
            allowed_mcp_server_ids: [...updated.allowed_mcp_server_ids],
            use_custom_llm_config: updated.use_custom_llm_config,
            llm_config_override: updated.llm_config_override,
          };

          return {
            ...prev,
            [key]: {
              ...cur,
              original: base,
              current: {
                ...base,
                allowed_invocation_modes: [...base.allowed_invocation_modes],
                tool_grants: [...base.tool_grants].map((item) => ({ feature_key: item.feature_key, categories: [...item.categories] })),
                allowed_sub_agent_ids: [...base.allowed_sub_agent_ids],
                allowed_mcp_server_ids: [...base.allowed_mcp_server_ids],
              },
              dirty: false,
              error: '',
            },
          };
        });
      } catch (error) {
        failures.push({
          item: {
            kind: 'subAgent',
            key: d.draftKey,
            label: d.current.display_name || d.original.display_name || d.subAgentId || d.draftKey,
            subAgentId: d.subAgentId || d.draftKey,
          },
          error: toErrorMessage(error),
        });
        setSubAgentDrafts((prev) => {
          const key = makeSubAgentDraftKey(d.subAgentId!);
          const cur = prev[key];
          if (!cur) return prev;
          return {
            ...prev,
            [key]: {
              ...cur,
              error: toErrorMessage(error),
            },
          };
        });
      }
    }

    // 3. Save new sub-agent
    if (newSubAgentDraft?.dirty) {
      attempted += 1;
      if (newSubAgentDraft.error) {
        failures.push({
          item: {
            kind: 'subAgent',
            key: newSubAgentDraft.draftKey,
            label: newSubAgentDraft.current.display_name || 'New Sub Agent',
            subAgentId: newSubAgentDraft.draftKey,
          },
          error: newSubAgentDraft.error,
        });
      } else {
        try {
          const scenarioDraft = subAgentScenarioDraftsRef.current[newSubAgentDraft.draftKey];
          const scenario = scenarioDraft?.scenario;
          const rangeBlock = scenario?.blocks.find((block) => block.type === 'rangeMapping' && block.rangeMapping);
          const created = await createSubAgent({
            ...buildSubAgentPayload(newSubAgentDraft),
            prompt_templates: scenario ? {
              system_prompt: scenario.system_template || DEFAULT_SUB_AGENT_SYSTEM_PROMPT,
              user_prompt: rangeBlock?.type === 'rangeMapping'
                ? rangeBlock.rangeMapping?.user_template || DEFAULT_SUB_AGENT_USER_PROMPT
                : DEFAULT_SUB_AGENT_USER_PROMPT,
            } : {
              system_prompt: DEFAULT_SUB_AGENT_SYSTEM_PROMPT,
              user_prompt: DEFAULT_SUB_AGENT_USER_PROMPT,
            },
          });
          saved += 1;
          setNewSubAgentDraft(null);
          setSubAgentScenarioDrafts((prev) => {
            const next = { ...prev };
            delete next[newSubAgentDraft.draftKey];
            return next;
          });
          setSelectedSubAgentId(created.id);
        } catch (error) {
          failures.push({
            item: {
              kind: 'subAgent',
              key: newSubAgentDraft.draftKey,
              label: newSubAgentDraft.current.display_name || 'New Sub Agent',
              subAgentId: newSubAgentDraft.draftKey,
            },
            error: toErrorMessage(error),
          });
          setNewSubAgentDraft((prev) => (prev ? { ...prev, error: toErrorMessage(error) } : prev));
        }
      }
    }

    return { attempted, saved, failures };
  }, [createSubAgent, invalidateScenarioCache, newSubAgentDraft, updateSubAgent]);

  // discardSubAgents
  const discardSubAgents = useCallback(() => {
    setSubAgentScenarioDrafts((prev) => {
      const next: Record<string, ScenarioDraft> = { ...prev };
      for (const [k, d] of Object.entries(next)) {
        if (!d.dirty) continue;
        next[k] = { ...d, scenario: d.originalScenario, dirty: false, saveWarnings: [] };
      }
      if (newSubAgentDraft) {
        delete next[newSubAgentDraft.draftKey];
      }
      return next;
    });
    setSubAgentDrafts((prev) => {
      const next: Record<string, SubAgentDefinitionDraft> = { ...prev };
      for (const [k, d] of Object.entries(next)) {
        if (!d.dirty) continue;
        next[k] = {
          ...d,
          current: {
            ...d.original,
            allowed_invocation_modes: [...d.original.allowed_invocation_modes],
            tool_grants: [...d.original.tool_grants].map((item) => ({ feature_key: item.feature_key, categories: [...item.categories] })),
            allowed_sub_agent_ids: [...d.original.allowed_sub_agent_ids],
            allowed_mcp_server_ids: [...d.original.allowed_mcp_server_ids],
          },
          dirty: false,
          error: '',
        };
      }
      return next;
    });
    setNewSubAgentDraft(null);
  }, [newSubAgentDraft]);

  // resetAll
  const resetAll = useCallback(() => {
    setSubAgentDrafts({});
    setSubAgentScenarioDrafts({});
    setNewSubAgentDraft(null);
    setSelectedSubAgentId(null);
  }, []);

  // dirtyCount
  const dirtyCount = useMemo(() => {
    const subAgentPromptCount = Object.values(subAgentScenarioDrafts).filter((d) => d.dirty).length;
    const subAgentCount = Object.values(subAgentDrafts).filter((d) => d.dirty).length + (newSubAgentDraft?.dirty ? 1 : 0);
    return subAgentPromptCount + subAgentCount;
  }, [subAgentScenarioDrafts, subAgentDrafts, newSubAgentDraft]);

  return {
    subAgentDrafts,
    subAgentScenarioDrafts,
    newSubAgentDraft,
    selectedSubAgentId,
    setSelectedSubAgentId,
    currentSubAgentDraft,
    currentSubAgentScenarioDraft,
    currentSubAgentScenarioKey,
    selectedSubAgent,
    subAgentIdentityName,
    handleSubAgentDraftChange,
    handleCreateSubAgent,
    onScenarioChange,
    onReloadScenario,
    onDeleted,
    onDiscardNew,
    getDirtySubAgents,
    saveSubAgents,
    discardSubAgents,
    resetAll,
    dirtyCount,
  };
}
