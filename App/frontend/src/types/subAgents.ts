import type { TaskAIConfig } from '../store/settingsStore';

export type SubAgentAllowedMode = 'storyObject' | 'outlineManager' | 'novelEditor' | 'subAgent';

export interface SubAgentDefinition {
  sub_agent_id: string;
  display_name: string;
  description?: string | null;
  enabled: boolean;
  allowed_agent_modes: SubAgentAllowedMode[];
  allowed_tool_names: string[];
  llm_config: TaskAIConfig;
}

export type SubAgentCreate = SubAgentDefinition;

export type SubAgentUpdate = Partial<Omit<SubAgentDefinition, 'sub_agent_id'>>;
