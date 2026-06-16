/**
 * TanStack Query client singleton.
 *
 * Server state (objects, collections, versions, translations, assets, threads,
 * settings, presets, …) lives here. Freshness is driven by the SSE layer
 * (`src/runtime/*` → `src/data/sse/*`), so on-focus/on-reconnect refetch is
 * disabled to avoid double-fetching against `runtimeStream`'s own rehydration.
 */

import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // SSE is the freshness source → modest stale window kills refetch storms
      gcTime: 5 * 60_000,
      retry: (count, error) => {
        const status = error instanceof ApiError ? error.status : undefined;
        if (status === 404 || status === 401) return false;
        return count < 2;
      },
      refetchOnWindowFocus: false, // runtimeStream already force-reconnects + rehydrates on focus
      refetchOnReconnect: false, // SSE owns reconnect/rehydrate
    },
    mutations: { retry: 0 },
  },
});
