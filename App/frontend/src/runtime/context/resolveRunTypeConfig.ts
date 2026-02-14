/**
 * Resolve run-type-specific configuration.
 *
 * Each run type (root, child) produces a RunTypeConfig — a normalized bag of
 * everything that differs per type. The downstream buildExecutionConfig is
 * completely generic and never branches on run type.
 *
 * Adding a new run type = adding a new resolver function + registering it here.
 */

import type { Run } from '../types';
import type { RunTypeConfig } from './types';
import type { ToolCallSchema } from '../../toolCall';
import { LLMTaskMode } from '../../llm/types';
import { PromptManager } from '../../llm/PromptManager';
import { useSettingsStore } from '../../store/settingsStore';
import { useCredentialsStore } from '../../store/credentialsStore';
import { useSubAgentStore } from '../../store/subAgentStore';
import { useAgentPromptSnapshotStore } from '../../store/agentPromptSnapshotStore';
import { useRuntimeStore } from '../store/runtimeStore';
import { getToolsForSet } from '../../toolCall';
import { schemaRegistry } from '../../toolCall/schemas/schemaRegistry';
import { buildCallToolSchema } from '../../subAgent/tools/SubAgentCallTools';

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function resolveRunTypeConfig(run: Run): Promise<RunTypeConfig> {
  if (run.runKind === 'root') return resolveRootRunConfig(run);
  if (run.runKind === 'child') return resolveChildRunConfig(run);
  throw new Error(`Unknown run kind: ${run.runKind}`);
}

// ---------------------------------------------------------------------------
// Root run config
// ---------------------------------------------------------------------------

async function resolveRootRunConfig(run: Run): Promise<RunTypeConfig> {
  const settingsStore = useSettingsStore.getState();
  const agentConfig = settingsStore.getTaskConfig('agent');
  const settings = settingsStore.getSettings();
  const providerConfig = useCredentialsStore.getState().getProviderConfigForBackend(agentConfig.provider);

  const toolSchemas = await loadRootRunTools(run, settings);

  let frozenProjectData = run.frozenProjectData as any;
  if (!frozenProjectData) {
    const snapshot = useAgentPromptSnapshotStore.getState().get(run.projectId, run.agentId);
    frozenProjectData = snapshot?.projectData ?? PromptManager.buildProjectData(run.projectId, run.language);
  }
  useRuntimeStore.getState().patchRun(run.id, { frozenProjectData });

  return {
    mode: run.runMode === 'planMode' ? LLMTaskMode.AGENT_PLAN_MODE : LLMTaskMode.AGENT_AGENT_MODE,
    kind: 'agent',
    label: 'AI Response',
    provider: agentConfig.provider,
    providerConfig,
    model: agentConfig.model,
    temperature: agentConfig.temperature,
    thinkingMode: agentConfig.advanced.thinking_mode,
    thinkingConfig: agentConfig.advanced.thinking_config,
    requestFormat: agentConfig.advanced.request_format,
    thinkingFormat: agentConfig.advanced.thinking_format,
    enable_prefill: agentConfig.advanced.enable_prefill,
    toolSchemas,
    frozenProjectData,
    promptFields: {
      runMode: run.runMode ?? 'agentMode',
      surface: run.surface ?? 'story-object',
      contextObjectIds: run.contextObjectIds,
    },
  };
}

// ---------------------------------------------------------------------------
// Child run config
// ---------------------------------------------------------------------------

async function resolveChildRunConfig(run: Run): Promise<RunTypeConfig> {
  const settingsStore = useSettingsStore.getState();
  const subAgentConfig = settingsStore.getTaskConfig('subAgent');

  await useSubAgentStore.getState().ensureLoaded();

  const subAgentStore = useSubAgentStore.getState();
  const definition = run.subAgentId ? subAgentStore.getById(run.subAgentId) : undefined;

  if (run.subAgentId && !definition) {
    throw new Error(`SubAgent definition not found: ${run.subAgentId}`);
  }

  const effectiveConfig = definition?.use_custom_llm_config && definition.llm_config_override
    ? definition.llm_config_override
    : subAgentConfig;

  const providerConfig = useCredentialsStore.getState().getProviderConfigForBackend(effectiveConfig.provider);
  const toolSchemas = await loadChildRunTools(run);

  let frozenProjectData = run.frozenProjectData as any;
  if (!frozenProjectData) {
    frozenProjectData = PromptManager.buildProjectData(run.projectId, run.language);
  }
  useRuntimeStore.getState().patchRun(run.id, { frozenProjectData });

  return {
    mode: LLMTaskMode.SUB_AGENT,
    kind: 'subAgent',
    label: 'Sub Agent',
    provider: effectiveConfig.provider,
    providerConfig,
    model: effectiveConfig.model,
    temperature: effectiveConfig.temperature,
    thinkingMode: effectiveConfig.advanced.thinking_mode,
    thinkingConfig: effectiveConfig.advanced.thinking_config,
    requestFormat: effectiveConfig.advanced.request_format,
    thinkingFormat: effectiveConfig.advanced.thinking_format,
    enable_prefill: effectiveConfig.advanced.enable_prefill,
    toolSchemas,
    toolChoice: 'required',
    frozenProjectData,
    promptFields: {
      agentName: definition!.agent_name,
    },
  };
}

// ---------------------------------------------------------------------------
// Tool loading (moved from RuntimeOrchestrator)
// ---------------------------------------------------------------------------

async function loadRootRunTools(
  run: Run,
  settings: ReturnType<ReturnType<typeof useSettingsStore.getState>['getSettings']>,
): Promise<ToolCallSchema[] | undefined> {
  const toolSet = run.runMode === 'planMode' ? 'agent_plan_mode' : 'agent_agent_mode';
  const baseTools = settings.nativeOutputMode
    ? undefined
    : getToolsForSet(toolSet, { ragSearchEnabled: settings.ragSearchEnabled });

  if (settings.nativeOutputMode) {
    return baseTools;
  }

  await useSubAgentStore.getState().ensureLoaded();

  const dynamicSubAgentTools = useSubAgentStore.getState().subAgents
    .filter((subAgent) => subAgent.enabled && subAgent.allowed_invocation_modes.includes(run.caller))
    .sort((left, right) => left.display_name.localeCompare(right.display_name))
    .map(buildCallToolSchema);

  return [...(baseTools ?? []), ...dynamicSubAgentTools];
}

async function loadChildRunTools(run: Run): Promise<ToolCallSchema[]> {
  if (!run.subAgentId) {
    throw new Error('Missing subAgentId for child run');
  }

  await useSubAgentStore.getState().ensureLoaded();

  const subAgentState = useSubAgentStore.getState();
  const definition = subAgentState.subAgents.find((s) => s.id === run.subAgentId);
  if (!definition) {
    throw new Error(`Sub Agent not found: ${run.subAgentId}`);
  }

  if (!definition.enabled) {
    throw new Error(`Sub Agent is disabled: ${run.subAgentId}`);
  }

  if (!definition.allowed_invocation_modes.includes(run.caller)) {
    throw new Error(`Sub Agent not allowed from caller: ${run.caller}`);
  }

  const schemas: ToolCallSchema[] = [];

  for (const name of definition.allowed_tool_names) {
    if (name.startsWith('call_')) continue;
    const schema = schemaRegistry.get(name);
    if (!schema) {
      throw new Error(`Unsupported tool in allowlist: ${name}`);
    }
    schemas.push({
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
    });
  }

  for (const subAgentId of definition.allowed_sub_agent_ids ?? []) {
    if (subAgentId === definition.id) continue;
    const target = subAgentState.subAgents.find((s) => s.id === subAgentId);
    if (!target || !target.enabled) continue;
    schemas.push(buildCallToolSchema(target));
  }

  // Always include return_sub_agent_result — required for tool-call-only completion
  const returnSchema = schemaRegistry.get('return_sub_agent_result');
  if (returnSchema) {
    schemas.push({
      name: returnSchema.name,
      description: returnSchema.description,
      parameters: returnSchema.parameters,
    });
  }

  return schemas;
}
