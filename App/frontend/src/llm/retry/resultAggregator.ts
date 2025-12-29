/**
 * Result Aggregator
 *
 * Categorizes and aggregates function call results for retry functionality.
 * Determines failure types and builds summary data for display.
 */

import type { FunctionCallMetadata } from '../requestTypes';
import type {
  CategorizedFunctionCallResult,
  AggregatedFunctionCallResults,
  FunctionCallFailureType,
  PatchFailureDetail,
} from './types';

/**
 * Application result from function call handlers
 */
export interface ApplicationResult {
  success: boolean;
  message: string;
  error?: string;
  /** For patch operations - details of failed patches */
  patchFailures?: PatchFailureDetail[];
  /** Whether this was a parsing error (invalid JSON) */
  isParsingError?: boolean;
  /** Whether this was a validation error (schema mismatch) */
  isValidationError?: boolean;
}

/**
 * Categorize a single function call result
 */
export function categorizeFunctionCall(
  fc: FunctionCallMetadata,
  applicationResult?: ApplicationResult
): CategorizedFunctionCallResult {
  // Determine failure type
  let failureType: FunctionCallFailureType | 'success' = 'success';
  let error: string | undefined;
  let patchFailures: PatchFailureDetail[] | undefined;

  if (fc.isRejected) {
    failureType = 'user_rejected';
    error = 'User rejected this function call';
  } else if (fc.error) {
    // Check error message patterns to determine type
    if (fc.error.includes('JSON') || fc.error.includes('parse') || fc.error.includes('syntax')) {
      failureType = 'parsing_failed';
    } else if (fc.error.includes('validation') || fc.error.includes('schema') || fc.error.includes('required')) {
      failureType = 'validation_failed';
    } else {
      failureType = 'application_failed';
    }
    error = fc.error;
  } else if (applicationResult && !applicationResult.success) {
    // Use application result to determine failure type
    if (applicationResult.isParsingError) {
      failureType = 'parsing_failed';
    } else if (applicationResult.isValidationError) {
      failureType = 'validation_failed';
    } else {
      failureType = 'application_failed';
    }
    error = applicationResult.error || applicationResult.message;
    patchFailures = applicationResult.patchFailures;
  }

  const success = failureType === 'success';

  return {
    functionCallId: fc.id,
    functionName: fc.function_name,
    arguments: fc.arguments || {},
    failureType,
    success,
    isRejected: fc.isRejected || false,
    resultMessage: fc.resultMessage || applicationResult?.message || (success ? 'Applied successfully' : 'Failed'),
    error,
    patchFailures,
  };
}

/**
 * Aggregate all function call results for a session
 */
export function aggregateFunctionCallResults(
  sessionId: string,
  results: CategorizedFunctionCallResult[]
): AggregatedFunctionCallResults {
  const successResults: CategorizedFunctionCallResult[] = [];
  const parsingFailures: CategorizedFunctionCallResult[] = [];
  const validationFailures: CategorizedFunctionCallResult[] = [];
  const applicationFailures: CategorizedFunctionCallResult[] = [];

  let successCount = 0;
  let failureCount = 0;
  let rejectedCount = 0;

  for (const result of results) {
    if (result.success) {
      successCount++;
      successResults.push(result);
    } else if (result.isRejected) {
      rejectedCount++;
      // Rejected items go to application failures for display
      applicationFailures.push(result);
    } else {
      failureCount++;
      switch (result.failureType) {
        case 'parsing_failed':
          parsingFailures.push(result);
          break;
        case 'validation_failed':
          validationFailures.push(result);
          break;
        case 'application_failed':
        default:
          applicationFailures.push(result);
          break;
      }
    }
  }

  // Build summary text
  const parts: string[] = [];
  if (successCount > 0) {
    parts.push(`${successCount} succeeded`);
  }
  if (failureCount > 0) {
    parts.push(`${failureCount} failed`);
  }
  if (rejectedCount > 0) {
    parts.push(`${rejectedCount} rejected`);
  }
  const summaryText = parts.length > 0 ? parts.join(', ') : 'No function calls';

  return {
    sessionId,
    total: results.length,
    successCount,
    failureCount,
    rejectedCount,
    results,
    successResults,
    parsingFailures,
    validationFailures,
    applicationFailures,
    summaryText,
  };
}

/**
 * Check if retry should be offered based on results
 */
export function shouldOfferRetry(aggregated: AggregatedFunctionCallResults): boolean {
  // Offer retry if there are any failures (excluding user rejections)
  return aggregated.failureCount > 0;
}

/**
 * Get counts by failure type for display
 */
export function getFailureCounts(aggregated: AggregatedFunctionCallResults): {
  parsing: number;
  validation: number;
  application: number;
  rejected: number;
} {
  return {
    parsing: aggregated.parsingFailures.length,
    validation: aggregated.validationFailures.length,
    application: aggregated.applicationFailures.length,
    rejected: aggregated.rejectedCount,
  };
}

/**
 * Build template data for retry prompt rendering
 */
export function buildRetryTemplateData(
  aggregated: AggregatedFunctionCallResults
): { retry: AggregatedFunctionCallResults } {
  return {
    retry: aggregated,
  };
}

/**
 * Extended application result that includes retryContexts from patch handlers
 */
export interface ExtendedApplicationResult extends ApplicationResult {
  objectId?: string;
  objectType?: string;
  data?: Record<string, unknown>;
  retryContexts?: Array<{
    objectId: string;
    objectType?: string;
    fieldName: string;
    currentValue: string;
    error: string;
  }>;
}

/**
 * Convert UnifiedApplicator results to CategorizedFunctionCallResults
 *
 * This function bridges the gap between the applicator's ApplicationResult
 * and the retry system's CategorizedFunctionCallResult format.
 */
export function convertApplicationResults(
  sessionId: string,
  functionCalls: FunctionCallMetadata[],
  applicationResults: ExtendedApplicationResult[]
): AggregatedFunctionCallResults {
  const categorizedResults: CategorizedFunctionCallResult[] = [];

  for (let i = 0; i < functionCalls.length; i++) {
    const fc = functionCalls[i];
    const appResult = applicationResults[i];

    // Determine failure type based on application result
    let failureType: FunctionCallFailureType | 'success' = 'success';
    let error: string | undefined;
    let patchFailures: PatchFailureDetail[] | undefined;

    if (fc.isRejected) {
      failureType = 'user_rejected';
      error = 'User rejected this function call';
    } else if (appResult && !appResult.success) {
      // Check for retryContexts from patch handlers
      if (appResult.retryContexts && appResult.retryContexts.length > 0) {
        failureType = 'application_failed';
        error = `${appResult.retryContexts.length} patch(es) failed`;
        patchFailures = appResult.retryContexts.map(ctx => ({
          objectId: ctx.objectId,
          objectType: ctx.objectType,
          fieldName: ctx.fieldName,
          error: ctx.error,
        }));
      } else if (appResult.isParsingError) {
        failureType = 'parsing_failed';
        error = appResult.error || appResult.message;
      } else if (appResult.isValidationError || appResult.error?.includes('Validation')) {
        failureType = 'validation_failed';
        error = appResult.error || appResult.message;
      } else {
        failureType = 'application_failed';
        error = appResult.error || appResult.message;
      }
    } else if (fc.error) {
      // Fallback to function call error
      if (fc.error.includes('JSON') || fc.error.includes('parse')) {
        failureType = 'parsing_failed';
      } else if (fc.error.includes('validation') || fc.error.includes('schema')) {
        failureType = 'validation_failed';
      } else {
        failureType = 'application_failed';
      }
      error = fc.error;
    }

    const success = failureType === 'success';
    const resultMessage = appResult?.message || (success ? 'Applied successfully' : 'Failed');

    categorizedResults.push({
      functionCallId: fc.id,
      functionName: fc.function_name,
      arguments: typeof fc.arguments === 'string' ? JSON.parse(fc.arguments) : (fc.arguments || {}),
      failureType,
      success,
      isRejected: fc.isRejected || false,
      resultMessage,
      error,
      patchFailures,
    });
  }

  return aggregateFunctionCallResults(sessionId, categorizedResults);
}
