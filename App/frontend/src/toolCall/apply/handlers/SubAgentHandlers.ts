/**
 * Apply Handlers - Sub Agent
 */

import type { ApplicationResult } from '../../types';
import type { Handler, HandlerContext } from '../types';

function ok(message: string): ApplicationResult {
  return { success: true, message };
}

function error(message: string): ApplicationResult {
  return { success: false, message, error: message };
}

export async function returnSubAgentResult(
  args: Record<string, unknown>,
  _context: HandlerContext
): Promise<ApplicationResult> {
  const result = args.result;
  if (typeof result !== 'string' || !result.trim()) {
    return error('Invalid result for return_sub_agent_result');
  }
  return ok(result);
}

export const SUB_AGENT_HANDLERS: Record<string, Handler> = {
  return_sub_agent_result: returnSubAgentResult,
};
