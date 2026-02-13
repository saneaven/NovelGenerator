import { createContext, useContext } from 'react';

export type SettingsToastKind = 'success' | 'error';

export type SettingsToastApi = {
  show: (kind: SettingsToastKind, message: string, durationMs?: number) => void;
  success: (message: string, durationMs?: number) => void;
  error: (message: string, durationMs?: number) => void;
};

const SettingsToastContext = createContext<SettingsToastApi | null>(null);

export const SettingsToastProvider = SettingsToastContext.Provider;

export function useSettingsToast(): SettingsToastApi {
  const ctx = useContext(SettingsToastContext);
  if (ctx) return ctx;

  // SettingsToast is intended for use within SettingsModal; no-op outside.
  return {
    show: () => undefined,
    success: () => undefined,
    error: () => undefined,
  };
}

