/**
 * Function Call Hooks
 *
 * Common hooks for function call handling across Agent and AI Edit flows.
 */

export {
  useFunctionCallHandlers,
  processFunctionCallsForSession,
  batchConfirmSession,
  type ProcessFunctionCallsConfig,
} from './useFunctionCallHandlers';
export type {
  UseFunctionCallHandlersConfig,
  UseFunctionCallHandlersReturn,
  FunctionCallHandlersState,
  FunctionCallHandlersActions,
} from './types';
