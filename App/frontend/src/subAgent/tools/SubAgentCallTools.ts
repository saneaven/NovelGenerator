import type { ToolSchema } from '../../toolCall';
import type { SubAgentDefinition } from '../../types/subAgents';

type CallToolSchema = Pick<ToolSchema, 'name' | 'description' | 'parameters'>;

export const SUB_AGENT_CALL_PREFIX = 'call_';

const AGENT_NAME_RE = /^[a-z][a-z0-9_]{0,49}$/;

export function toCallToolName(agentName: string): string {
  return `${SUB_AGENT_CALL_PREFIX}${agentName}`;
}

export function isValidAgentName(agentName: string): boolean {
  return AGENT_NAME_RE.test(agentName);
}

export function isCallToolName(toolName: string): boolean {
  return toolName.startsWith(SUB_AGENT_CALL_PREFIX);
}

export function agentNameFromCallToolName(toolName: string): string | null {
  if (!isCallToolName(toolName)) return null;
  const suffix = toolName.slice(SUB_AGENT_CALL_PREFIX.length);
  if (!AGENT_NAME_RE.test(suffix)) return null;
  return suffix;
}

export function buildCallToolSchema(def: SubAgentDefinition): CallToolSchema {
  const toolName = toCallToolName(def.agent_name);
  const displayName = def.display_name?.trim() ? def.display_name.trim() : def.agent_name;
  const description = def.description?.trim() ? def.description.trim() : null;

  return {
    name: toolName,
    description: description
      ? `Call Sub Agent "${displayName}". ${description}`
      : `Call Sub Agent "${displayName}".`,
    parameters: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'Input string for the Sub Agent. Include all context and instructions here.',
        },
      },
      required: ['input'],
    },
  };
}
