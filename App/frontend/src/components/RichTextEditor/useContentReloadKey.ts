import { useCallback, useEffect, useRef, useState } from 'react';

// Remount only on an external content change: a version bump the host didn't mark via markSaved.
export function useContentReloadKey(identity: string, version: number | null) {
  const [nonce, setNonce] = useState(0);
  const baseRef = useRef<{ identity: string; version: number | null }>({ identity, version });
  const selfSavedRef = useRef<number | null>(null);

  useEffect(() => {
    const base = baseRef.current;
    if (base.identity !== identity) {
      baseRef.current = { identity, version };
      return;
    }
    if (version === null || version === base.version) return;
    const prev = base.version;
    baseRef.current = { identity, version };
    if (prev === null) return; // first version for this object → baseline, not an external change
    if (version === selfSavedRef.current) {
      selfSavedRef.current = null;
      return;
    }
    setNonce((n) => n + 1);
  }, [identity, version]);

  const markSaved = useCallback((v: number | null) => {
    selfSavedRef.current = v;
  }, []);

  return { reloadKey: `${identity}#${nonce}`, markSaved };
}
