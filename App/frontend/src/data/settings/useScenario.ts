/**
 * Scenario documents (per task type/subtype) as queries.
 *
 * Replaces the old store's `scenarioCache` Map + `loadScenario` /
 * `getScenarioFromCache` / `invalidateScenarioCache`. Scenarios are static for
 * a session unless explicitly invalidated (after a scenario save, or on preset
 * switch — see `presetSelectors`, which invalidates `settingsKeys.scenarios()`),
 * so `staleTime: Infinity` + targeted invalidation reproduces the cache.
 */

import { scenarioService } from '../../api/scenarioService';
import { queryClient } from '../queryClient';
import { settingsKeys } from '../keys/settingsKeys';
import type { ScenarioDocument, TaskType } from '../../types/scenarios';

/** Fetch (and cache) a scenario document. Imperative — mirrors `loadScenario`. */
export function fetchScenario(taskType: TaskType, taskSubtype: string): Promise<ScenarioDocument> {
  return queryClient.fetchQuery({
    queryKey: settingsKeys.scenario(taskType, taskSubtype),
    queryFn: async () => (await scenarioService.getScenario(taskType, taskSubtype)).scenario,
    staleTime: Infinity,
  });
}

/** Read a cached scenario without fetching. */
export function readScenarioFromCache(taskType: TaskType, taskSubtype: string): ScenarioDocument | undefined {
  return queryClient.getQueryData<ScenarioDocument>(settingsKeys.scenario(taskType, taskSubtype));
}

/** Invalidate one scenario (taskType+subtype) or all scenarios (no args). */
export function invalidateScenario(taskType?: TaskType, taskSubtype?: string): void {
  if (!taskType) {
    queryClient.invalidateQueries({ queryKey: settingsKeys.scenarios() });
    return;
  }
  if (!taskSubtype) {
    throw new Error('invalidateScenario requires taskType and taskSubtype (or no args to clear all)');
  }
  queryClient.invalidateQueries({ queryKey: settingsKeys.scenario(taskType, taskSubtype) });
}
