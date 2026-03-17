import { create } from 'zustand';
import type { StoryEntityTabType } from '../../../types/objectTypeConfig';

interface StoryEntityTabStore {
  activeTab: StoryEntityTabType;
  setActiveTab: (tab: StoryEntityTabType) => void;
}

export const useStoryEntityTab = create<StoryEntityTabStore>((set) => ({
  activeTab: 'basicInfo',
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
