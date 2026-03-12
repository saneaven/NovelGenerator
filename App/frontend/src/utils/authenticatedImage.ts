import { useEffect, useState } from 'react';
import apiClient, { API_BASE_URL } from '../api/client';

interface ProtectedAssetRequest {
  cacheKey: string;
  requestUrl: string;
}

interface CacheEntry {
  objectUrl?: string;
  promise?: Promise<string>;
}

const protectedAssetCache = new Map<string, CacheEntry>();
let cacheGeneration = 0;

function getBaseUrl(): string {
  if (API_BASE_URL) return API_BASE_URL;
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://localhost';
}

function normalizeProtectedAssetRequest(src: string): ProtectedAssetRequest | null {
  const raw = src.trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw, getBaseUrl());
    if (!parsed.pathname.startsWith('/storage/assets/')) {
      return null;
    }

    return {
      cacheKey: `${parsed.pathname}${parsed.search}`,
      requestUrl: parsed.href,
    };
  } catch {
    if (!raw.startsWith('/storage/assets/')) {
      return null;
    }

    return {
      cacheKey: raw,
      requestUrl: `${getBaseUrl()}${raw}`,
    };
  }
}

async function fetchProtectedAssetObjectUrl(src: string): Promise<string> {
  const request = normalizeProtectedAssetRequest(src);
  if (!request) {
    return src;
  }

  const cachedEntry = protectedAssetCache.get(request.cacheKey);
  if (cachedEntry?.objectUrl) {
    return cachedEntry.objectUrl;
  }
  if (cachedEntry?.promise) {
    return cachedEntry.promise;
  }

  const token = apiClient.getAuthToken();
  if (!token) {
    throw new Error('Authentication token is missing');
  }

  const currentGeneration = cacheGeneration;
  let inflightPromise: Promise<string>;
  inflightPromise = fetch(request.requestUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load image (${response.status})`);
      }

      const objectUrl = URL.createObjectURL(await response.blob());
      if (currentGeneration !== cacheGeneration) {
        URL.revokeObjectURL(objectUrl);
        throw new Error('Image cache was cleared');
      }

      protectedAssetCache.set(request.cacheKey, { objectUrl });
      return objectUrl;
    })
    .catch((error) => {
      const currentEntry = protectedAssetCache.get(request.cacheKey);
      if (currentEntry?.promise === inflightPromise) {
        protectedAssetCache.delete(request.cacheKey);
      }
      throw error;
    });

  protectedAssetCache.set(request.cacheKey, { promise: inflightPromise });
  return inflightPromise;
}

export function clearAuthenticatedImageCache(): void {
  cacheGeneration += 1;

  for (const entry of protectedAssetCache.values()) {
    if (entry.objectUrl) {
      URL.revokeObjectURL(entry.objectUrl);
    }
  }

  protectedAssetCache.clear();
}

export function useAuthenticatedImageSrc(src: string | null | undefined): string | null {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(() => {
    if (!src) return null;

    const request = normalizeProtectedAssetRequest(src);
    if (!request) return src;

    return protectedAssetCache.get(request.cacheKey)?.objectUrl ?? null;
  });

  useEffect(() => {
    if (!src) {
      setResolvedSrc(null);
      return;
    }

    const request = normalizeProtectedAssetRequest(src);
    if (!request) {
      setResolvedSrc(src);
      return;
    }

    const cachedObjectUrl = protectedAssetCache.get(request.cacheKey)?.objectUrl;
    if (cachedObjectUrl) {
      setResolvedSrc(cachedObjectUrl);
      return;
    }

    let cancelled = false;
    setResolvedSrc(null);

    void fetchProtectedAssetObjectUrl(src)
      .then((objectUrl) => {
        if (!cancelled) {
          setResolvedSrc(objectUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedSrc(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  return resolvedSrc;
}
