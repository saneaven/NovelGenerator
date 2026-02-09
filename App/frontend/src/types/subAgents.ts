import type { TaskAIConfig } from '../store/settingsStore';

export type SubAgentAllowedInvocation = 'planMode' | 'agentMode' | 'subAgent';

export interface SubAgentDefinition {
  /** Management identifier (UUID string). Used for update/delete and allowlists. */
  id: string;

  /** Tool suffix (slug). The actual tool name is call_{agent_name}. */
  agent_name: string;

  /** Human-readable name shown in UI and used in tool descriptions. */
  display_name: string;

  description: string;
  enabled: boolean;

  allowed_invocation_modes: SubAgentAllowedInvocation[];

  /** Static tool names only (create_x/read_x/patch_x/replace_x etc). Never store call_x here. */
  allowed_tool_names: string[];

  /** UUID list of other Sub Agents this Sub Agent can call (by id). */
  allowed_sub_agent_ids: string[];

  /** If true, this Sub Agent uses llm_config_override instead of the global Sub Agent config. */
  use_custom_llm_config: boolean;

  /** Per-Sub-Agent LLM config (only used when use_custom_llm_config=true). */
  llm_config_override: TaskAIConfig | null;
}

export type SubAgentCreate = Omit<SubAgentDefinition, 'id'>;

export type SubAgentUpdate = Partial<Omit<SubAgentDefinition, 'id'>>;
