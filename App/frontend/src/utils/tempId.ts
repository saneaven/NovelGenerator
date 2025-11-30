/**
 * Generate temporary IDs for frontend-only state management.
 * These IDs are NOT sent to the backend - the backend generates its own UUIDs.
 *
 * This utility exists because crypto.randomUUID() only works in secure contexts (HTTPS),
 * which causes errors when accessing via HTTP (e.g., mobile testing on local network).
 */

let counter = 0;

/**
 * Generates a unique temporary ID using timestamp and counter.
 * Format: temp-{timestamp}-{counter}
 */
export const generateTempId = (): string => `temp-${Date.now()}-${++counter}`;
