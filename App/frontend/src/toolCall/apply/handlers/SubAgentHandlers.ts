/**
 * Apply Handlers - Sub Agent
 *
 * call_sub_agent: Runs a configured Sub Agent and returns its full output.
 */

import type { ApplicationResult } from '../../types';
import type { Handler, HandlerContext } from '../types';
import { SubAgentManager } from '../../../subAgent/runtime/SubAgentManager';

function ok(message: string, data?: Record<string, unknown>): ApplicationResult {
  return { success: true, message, data };
}

function error(message: string): ApplicationResult {
  return { success: false, message, error: message };
}

export async function callSubAgent(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const subAgentId = args.subAgentId as string | undefined;
  const input = (args as any).input;

  if (!subAgentId || typeof subAgentId !== 'string' || !subAgentId.trim()) {
    return error('Missing subAgentId for call_sub_agent');
  }

  const callerMode = context.executionMode;
  if (!callerMode) {
    return error('Missing executionMode for call_sub_agent');
  }

  const output = await SubAgentManager.invoke({
    projectId: context.projectId,
    language: context.language,
    parentToolCallId: context.callId,
    callerMode,
    subAgentId,
    input,
    handlerOptions: { ...context.options, userRequest: 'SubAgent' },
  });

  return ok(output, { subAgentId });
}

export const SUB_AGENT_HANDLERS: Record<string, Handler> = {
  call_sub_agent: callSubAgent,
};

