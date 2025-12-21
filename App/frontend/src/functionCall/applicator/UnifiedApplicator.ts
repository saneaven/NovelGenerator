/**
 * Unified Applicator
 *
 * Single class-based applicator for all function call operations.
 * Uses dependency injection for store and translation service access.
 */

import type {
  ApplicationResult,
  ExecutionContext,
  RawFunctionCall,
  NormalizedFunctionCall,
} from '../types';
import type { ApplicatorConfig, HandlerContext, Handler, StoreActions, TranslationActions } from './types';
import { normalizeFunctionCall, validateFunctionCall, isKnownFunction } from '../normalizer';
import { ALL_HANDLERS } from './handlers';

/**
 * Unified applicator for all function call operations
 */
export class UnifiedApplicator {
  private store: StoreActions;
  private translationService?: TranslationActions;

  constructor(config: ApplicatorConfig) {
    this.store = config.store;
    this.translationService = config.translationService;
  }

  /**
   * Apply a single function call
   *
   * @param functionCall - Raw or normalized function call
   * @param context - Execution context (projectId, language, mode)
   */
  async apply(
    functionCall: RawFunctionCall | NormalizedFunctionCall,
    context: ExecutionContext
  ): Promise<ApplicationResult> {
    // Normalize the function call
    const normalized = this.normalize(functionCall);

    // Validate the function call
    const validation = validateFunctionCall(normalized.functionName, normalized.arguments);
    if (!validation.valid) {
      return {
        success: false,
        message: 'Validation failed',
        error: validation.errors?.join(', ') ?? 'Unknown validation error',
      };
    }

    // Get the handler
    const handler = this.getHandler(normalized.functionName);
    if (!handler) {
      return {
        success: false,
        message: 'Unknown function',
        error: `Unsupported function: ${normalized.functionName}`,
      };
    }

    // Build handler context
    const handlerContext: HandlerContext = {
      ...context,
      store: this.store,
      translationService: this.translationService,
    };

    // Execute the handler
    try {
      return await handler(normalized.arguments, handlerContext);
    } catch (error) {
      console.error(`Error executing ${normalized.functionName}:`, error);
      return {
        success: false,
        message: `Error executing ${normalized.functionName}`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Apply multiple function calls
   *
   * @param functionCalls - Array of raw or normalized function calls
   * @param context - Execution context
   */
  async applyAll(
    functionCalls: Array<RawFunctionCall | NormalizedFunctionCall>,
    context: ExecutionContext
  ): Promise<ApplicationResult[]> {
    const results: ApplicationResult[] = [];

    for (const functionCall of functionCalls) {
      const result = await this.apply(functionCall, context);
      results.push(result);
    }

    return results;
  }

  /**
   * Check if a function name is supported
   */
  isSupported(functionName: string): boolean {
    return isKnownFunction(functionName) && functionName in ALL_HANDLERS;
  }

  /**
   * Normalize a function call (handles both raw and already normalized)
   */
  private normalize(
    functionCall: RawFunctionCall | NormalizedFunctionCall
  ): NormalizedFunctionCall {
    // Check if already normalized
    if ('functionName' in functionCall && typeof functionCall.arguments === 'object') {
      return functionCall as NormalizedFunctionCall;
    }

    // Normalize raw function call
    return normalizeFunctionCall(functionCall as RawFunctionCall);
  }

  /**
   * Get the handler for a function name
   */
  private getHandler(functionName: string): Handler | undefined {
    return ALL_HANDLERS[functionName];
  }
}

/**
 * Create a UnifiedApplicator with store from Zustand
 *
 * This is a convenience function for common usage patterns.
 */
export function createApplicator(config: ApplicatorConfig): UnifiedApplicator {
  return new UnifiedApplicator(config);
}
