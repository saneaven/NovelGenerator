import { create } from 'zustand';
import type { StoryObjectTabType } from '../../../types/storyObject';

interface StoryObjectTabStore {
  activeTab: StoryObjectTabType;
  setActiveTab: (tab: StoryObjectTabType) => void;
}

export const useStoryObjectTab = create<StoryObjectTabStore>((set) => ({
  activeTab: 'basicInfo',
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
