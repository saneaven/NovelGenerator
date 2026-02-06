import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface DisplayLanguageStore {
  /**
   * Browser-only preferred display language for content UI.
   *
   * - null means: follow mainLanguage (default behavior)
   * - string means: attempt to display that language when available
   */
  preferredDisplayLanguage: string | null;
  setPreferredDisplayLanguage: (language: string | null) => void;
}

export const useDisplayLanguageStore = create<DisplayLanguageStore>()(
  persist(
    (set) => ({
      preferredDisplayLanguage: null,
      setPreferredDisplayLanguage: (language) => set({ preferredDisplayLanguage: language }),
    }),
    { name: 'display-language-storage' }
  )
);

