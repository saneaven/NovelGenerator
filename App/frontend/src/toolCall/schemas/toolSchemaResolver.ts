import type { ToolSchema } from '../types';
import { schemaRegistry } from './schemaRegistry';
import { useSubAgentStore } from '../../store/subAgentStore';
import { agentNameFromCallToolName, buildCallToolSchema, isCallToolName } from '../../subAgent/tools/SubAgentCallTools';

function buildDynamicCallToolSchema(agentName: string): ToolSchema | undefined {
  const store = useSubAgentStore.getState();
  const def = store.getByAgentName(agentName);
  if (!def) return undefined;

  const llmSchema = buildCallToolSchema(def);
  return {
    name: llmSchema.name,
    description: llmSchema.description,
    parameters: llmSchema.parameters as any,
    category: 'read',
    target: 'sub_agent',
  };
}

export const toolSchemaResolver = {
  get(name: string): ToolSchema | undefined {
    const staticSchema = schemaRegistry.get(name);
    if (staticSchema) return staticSchema;

    if (!isCallToolName(name)) return undefined;
    const agentName = agentNameFromCallToolName(name);
    if (!agentName) return undefined;
    return buildDynamicCallToolSchema(agentName);
  },

  has(name: string): boolean {
    return this.get(name) != null;
  },
};

