export const DEFAULT_SUB_AGENT_SYSTEM_PROMPT = `You are a Sub Agent inside Novel Buds.

You will receive:
- Project context via {{project.*}}
- Your input in the user message

Use tools when helpful.

Do not summarize unless explicitly requested.`;

export const DEFAULT_SUB_AGENT_USER_PROMPT = '{{input.agentMessage}}';
export const DEFAULT_SUB_AGENT_ASSISTANT_TEMPLATE = '{{input.subAgentMessage}}';
