import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchScenario, invalidateScenario } from '../../../data/settings';
import { scenarioService } from '../../../api/scenarioService';
import { makeScenarioDraftKey, type DirtyItem, type SaveFailure, type ScenarioDraft } from '../PromptEditor/draftTypes';
import { toErrorMessage } from '../PromptEditor/draftUtils';
import type { ScenarioDocument, TaskType } from '../../../types/scenarios';

export function useScenarioDrafts() {
  const loadScenario = fetchScenario;
  const invalidateScenarioCache = invalidateScenario;

  const [scenarioDrafts, setScenarioDrafts] = useState<Record<string, ScenarioDraft>>({});

  const scenarioDraftsRef = useRef(scenarioDrafts);
  useEffect(() => {
    scenarioDraftsRef.current = scenarioDrafts;
  }, [scenarioDrafts]);

  const ensureScenarioDraftLoaded = useCallback(
    async (taskType: TaskType, taskSubtype: string, label: string, nodeId?: string) => {
      const key = makeScenarioDraftKey(taskType, taskSubtype);
      if (scenarioDraftsRef.current[key]) return;

      const emptyScenario: ScenarioDocument = { system_template: '', blocks: [] };
      setScenarioDrafts((prev) => ({
        ...prev,
        [key]: {
          key,
          label,
          nodeId,
          taskType,
          taskSubtype,
          isLoading: true,
          originalScenario: emptyScenario,
          scenario: emptyScenario,
          dirty: false,
          saveWarnings: [],
        },
      }));

      try {
        const loaded = await loadScenario(taskType, taskSubtype);
        setScenarioDrafts((prev) => ({
          ...prev,
          [key]: {
            ...(prev[key] as ScenarioDraft),
            label,
            nodeId,
            taskType,
            taskSubtype,
            isLoading: false,
            loadError: undefined,
            originalScenario: loaded,
            scenario: loaded,
            dirty: false,
            saveWarnings: [],
          },
        }));
      } catch (error) {
        setScenarioDrafts((prev) => ({
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

  const updateScenarioDraft = useCallback((key: string, updater: (draft: ScenarioDraft) => ScenarioDraft) => {
    setScenarioDrafts((prev) => {
      const cur = prev[key];
      if (!cur) return prev;
      return { ...prev, [key]: updater(cur) };
    });
  }, []);

  const getDirtyScenarios = useCallback((): DirtyItem[] => {
    const dirty: DirtyItem[] = [];
    for (const d of Object.values(scenarioDraftsRef.current)) {
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
    return dirty;
  }, []);

  const saveScenarios = useCallback(async (): Promise<{ attempted: number; saved: number; failures: SaveFailure[] }> => {
    const failures: SaveFailure[] = [];
    let attempted = 0;
    let saved = 0;

    const dirtyScenarios = Object.values(scenarioDraftsRef.current).filter((d) => d.dirty);
    for (const d of dirtyScenarios) {
      attempted += 1;
      try {
        const result = await scenarioService.saveScenario(d.taskType, d.taskSubtype, d.scenario);
        invalidateScenarioCache(d.taskType, d.taskSubtype);
        saved += 1;
        setScenarioDrafts((prev) => {
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

    return { attempted, saved, failures };
  }, [invalidateScenarioCache]);

  const discardScenarios = useCallback(() => {
    setScenarioDrafts((prev) => {
      const next: Record<string, ScenarioDraft> = { ...prev };
      for (const [k, d] of Object.entries(next)) {
        if (!d.dirty) continue;
        next[k] = { ...d, scenario: d.originalScenario, dirty: false, saveWarnings: [] };
      }
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    setScenarioDrafts({});
  }, []);

  const dirtyCount = useMemo(() => {
    return Object.values(scenarioDrafts).filter((d) => d.dirty).length;
  }, [scenarioDrafts]);

  const restoreScenarioVersion = useCallback(async (key: string, taskType: TaskType, taskSubtype: string) => {
    invalidateScenarioCache(taskType, taskSubtype);
    const loaded = await loadScenario(taskType, taskSubtype);
    setScenarioDrafts((prev) => {
      const cur = prev[key];
      if (!cur) return prev;
      return {
        ...prev,
        [key]: {
          ...cur,
          originalScenario: loaded,
          scenario: loaded,
          dirty: false,
          saveWarnings: [],
        },
      };
    });
  }, [invalidateScenarioCache, loadScenario]);

  return {
    scenarioDrafts,
    scenarioDraftsRef,
    ensureScenarioDraftLoaded,
    updateScenarioDraft,
    getDirtyScenarios,
    saveScenarios,
    discardScenarios,
    resetAll,
    dirtyCount,
    restoreScenarioVersion,
    loadScenario,
    invalidateScenarioCache,
  };
}
