import { useEffect, useCallback } from 'react';
import { useSettingsStore } from '../store/settingsStore';

export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Hook for managing application theme
 * Handles theme detection, application, and system preference sync
 */
export function useTheme() {
  const theme = useSettingsStore((state) => state.settings.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);

  /**
   * Get the system's preferred color scheme
   */
  const getSystemTheme = useCallback((): 'light' | 'dark' => {
    if (typeof window === 'undefined') return 'light';

    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }, []);

  /**
   * Get the effective theme (resolving 'system' to actual theme)
   */
  const getEffectiveTheme = useCallback((): 'light' | 'dark' => {
    if (theme === 'system') {
      return getSystemTheme();
    }
    return theme;
  }, [theme, getSystemTheme]);

  /**
   * Apply theme to document
   */
  const applyTheme = useCallback((effectiveTheme: 'light' | 'dark') => {
    const root = document.documentElement;

    // Remove previous theme
    root.removeAttribute('data-theme');

    // Apply new theme (only set attribute for dark mode, light is default)
    if (effectiveTheme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    }
  }, []);

  /**
   * Toggle between light and dark themes
   */
  const toggleTheme = useCallback(() => {
    const currentEffective = getEffectiveTheme();
    const newTheme = currentEffective === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
  }, [getEffectiveTheme, setTheme]);

  /**
   * Set specific theme mode
   */
  const setThemeMode = useCallback((mode: ThemeMode) => {
    setTheme(mode);
  }, [setTheme]);

  // Apply theme on mount and when theme changes
  useEffect(() => {
    const effectiveTheme = getEffectiveTheme();
    applyTheme(effectiveTheme);
  }, [theme, applyTheme, getEffectiveTheme]);

  // Listen for system theme changes when in 'system' mode
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      const newTheme = e.matches ? 'dark' : 'light';
      applyTheme(newTheme);
    };

    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
    // Legacy browsers
    else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, [theme, applyTheme]);

  // Prevent flash of unstyled content on initial load
  useEffect(() => {
    // Remove the no-transitions class after a brief delay
    const timer = setTimeout(() => {
      document.documentElement.classList.remove('no-transitions');
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  return {
    /** Current theme mode setting */
    theme,
    /** The actual applied theme (resolving 'system' to light/dark) */
    effectiveTheme: getEffectiveTheme(),
    /** Whether dark mode is currently active */
    isDark: getEffectiveTheme() === 'dark',
    /** Set a specific theme mode */
    setTheme: setThemeMode,
    /** Toggle between light and dark */
    toggleTheme,
    /** Get system's preferred theme */
    getSystemTheme,
  };
}
