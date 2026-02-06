import { useEffect } from 'react';

export function applySystemThemeOnce(): void {
  if (typeof window === 'undefined') return;
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const isDark = Boolean(media?.matches);

  if (isDark) {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.removeAttribute('data-theme');
  }
}

export function useSystemTheme(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof document === 'undefined') return;

    const root = document.documentElement;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;

    const apply = (isDark: boolean) => {
      if (isDark) {
        root.setAttribute('data-theme', 'dark');
      } else {
        root.removeAttribute('data-theme');
      }
    };

    apply(media.matches);

    const onChange = (e: MediaQueryListEvent) => apply(e.matches);

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }

    // Safari < 14
    // eslint-disable-next-line deprecation/deprecation
    media.addListener(onChange);
    // eslint-disable-next-line deprecation/deprecation
    return () => media.removeListener(onChange);
  }, []);
}

