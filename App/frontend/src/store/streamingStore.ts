import { create } from 'zustand';
import { type ContentPart } from '../llm/requestTypes';

interface StreamingContent {
  contentParts: ContentPart[];
  thinkingDetails?: any[];
}

interface StreamingState {
  // messageId -> streaming content
  streamingContent: Map<string, StreamingContent>;

  setStreamingContent: (messageId: string, contentParts: ContentPart[], thinkingDetails?: any[]) => void;
  clearStreamingContent: (messageId: string) => void;
  getStreamingContent: (messageId: string) => StreamingContent | undefined;
}

export const useStreamingStore = create<StreamingState>()((set, get) => ({
  streamingContent: new Map(),

  setStreamingContent: (messageId, contentParts, thinkingDetails) => {
    set((state) => {
      const newMap = new Map(state.streamingContent);
      newMap.set(messageId, { contentParts, thinkingDetails });
      return { streamingContent: newMap };
    });
  },

  clearStreamingContent: (messageId) => {
    set((state) => {
      const newMap = new Map(state.streamingContent);
      newMap.delete(messageId);
      return { streamingContent: newMap };
    });
  },

  getStreamingContent: (messageId) => get().streamingContent.get(messageId),
}));
