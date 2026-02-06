import { create } from 'zustand';
import type { ContentPart, ToolCallMetadata, ConversationBlock } from '../llm/requestTypes';
import type { ProviderType } from './settingsStore';
import type { LLMTaskModeType, OutputMode } from '../llm/types';

export interface LLMLogRequest {
  mode: LLMTaskModeType;
  provider: ProviderType;
  model: string;
  temperature: number;
  thinkingMode: 'off' | 'model' | 'custom';
  outputMode?: OutputMode;
  tools?: any[];
  messages: ConversationBlock[];
}

export interface LLMLogResponse {
  contentParts: ContentPart[];
  toolCalls: ToolCallMetadata[];
  thinkingDetails?: any[];
}

export type LLMLogStatus = 'pending' | 'streaming' | 'success' | 'error';

export interface LLMLogEntry {
  id: string;
  timestamp: Date;
  status: LLMLogStatus;
  durationMs?: number;
  request: LLMLogRequest;
  response?: LLMLogResponse;
  error?: string;
}

const MAX_LOG_ENTRIES = 50;

interface LLMLogStore {
  logs: LLMLogEntry[];
  maxLogEntries: number;

  // Actions
  addLogEntry: (entry: Omit<LLMLogEntry, 'id' | 'timestamp'>) => string;
  updateLogEntry: (id: string, updates: Partial<LLMLogEntry>) => void;
  clearLogs: () => void;
  getLogById: (id: string) => LLMLogEntry | undefined;
}

// Note: isLoggingEnabled is now in settingsStore (llmLoggingEnabled)
// Use `useSettingsStore((s) => s.getSettings().llmLoggingEnabled)` (or `useSettings()`) to check if logging is enabled.

export const useLLMLogStore = create<LLMLogStore>((set, get) => ({
  logs: [],
  maxLogEntries: MAX_LOG_ENTRIES,

  addLogEntry: (entry) => {
    const id = `llm-log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newEntry: LLMLogEntry = {
      ...entry,
      id,
      timestamp: new Date(),
    };

    set((state) => {
      const newLogs = [newEntry, ...state.logs].slice(0, state.maxLogEntries);
      return { logs: newLogs };
    });

    return id;
  },

  updateLogEntry: (id, updates) => {
    set((state) => ({
      logs: state.logs.map((log) =>
        log.id === id ? { ...log, ...updates } : log
      ),
    }));
  },

  clearLogs: () => set({ logs: [] }),

  getLogById: (id) => get().logs.find((log) => log.id === id),
}));
