/**
 * Hook for managing prompt preview state and rendering.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { renderTemplate } from '../../../templateEngine/engine';

import { useProjectStore } from '../../../store/projectStore';
import { useVariableStore } from '../../../store/variableStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useTokenCount } from '../../../hooks/useTokenCount';
import type { ConfigData } from '../../../templateEngine/schema';
import type { PromptCategory, TaskType } from '../../../types/prompts';
import type { PromptVariable } from '../../../types/variables';
import { buildPreviewData } from '../PromptEditor/previewDataBuilder';

export interface UsePromptPreviewOptions {
  templateContent: string;
  taskType: TaskType;
  promptName: string;
  promptCategory: PromptCategory;
}

export interface UsePromptPreviewResult {
  // Rendered output
  renderedPreview: string;
  isLoading: boolean;
  error: string | null;
  characterCount: number;

  // Token counting
  tokenCount: number | null;
  isCountingTokens: boolean;
  tokenCountError: string | null;
  isTokenCountEstimate: boolean;

  // Project context toggle (replaces contextMode)
  showProjectContext: boolean;
  setShowProjectContext: (show: boolean) => void;

  // Filtered IDs toggle
  includeAllFilteredIds: boolean;
  setIncludeAllFilteredIds: (include: boolean) => void;

  // Config overrides
  configOverrides: Partial<ConfigData>;
  setConfigOverride: (key: keyof ConfigData, value: any) => void;

  // Prompt-type specific overrides
  promptTypeOverrides: Record<string, any>;
  setPromptTypeOverride: (path: string, value: any) => void;

  // User variable overrides
  variableOverrides: Record<string, any>;
  setVariableOverride: (name: string, value: any) => void;

  // User variables for controls
  userVariables: PromptVariable[];

  // Actions
  resetOverrides: () => void;
  refresh: () => void;
}

const DEBOUNCE_DELAY = 300;

export function usePromptPreview(options: UsePromptPreviewOptions): UsePromptPreviewResult {
  const { templateContent, taskType, promptName, promptCategory } = options;

  // Store access
  const currentProjectId = useProjectStore(state => state.currentProjectId);
  const userVariables = useVariableStore(state => state.variables);

  // Get task config for token counting
  const task_configs = useSettingsStore((state) => state.getSettings().task_configs);
  const taskConfig = task_configs[taskType as keyof typeof task_configs];

  // State
  const [renderedPreview, setRenderedPreview] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showProjectContext, setShowProjectContext] = useState<boolean>(!!currentProjectId);
  const [includeAllFilteredIds, setIncludeAllFilteredIds] = useState<boolean>(true);
  const [configOverrides, setConfigOverrides] = useState<Partial<ConfigData>>({});
  const [promptTypeOverrides, setPromptTypeOverrides] = useState<Record<string, any>>({});
  const [variableOverrides, setVariableOverrides] = useState<Record<string, any>>({});

  // Debounce timer ref
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Render preview function
  const renderPreview = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // TODO: fragment reload needs reimplementation (PromptManager deleted)

      // Build preview data
      const previewData = buildPreviewData({
        taskType,
        promptName,
        promptCategory,
        showProjectContext,
        includeAllFilteredIds,
        projectId: currentProjectId,
        configOverrides,
        promptTypeOverrides,
        variableOverrides,
      });

      // Render the template
      const rendered = renderTemplate(templateContent, previewData);

      // Check if rendering returned an error
      if (rendered.startsWith('[Template Error:') || rendered.includes('[Fragment Error:')) {
        setError(rendered);
        setRenderedPreview(rendered);
      } else {
        setRenderedPreview(rendered);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setRenderedPreview(`[Preview Error: ${errorMessage}]`);
    } finally {
      setIsLoading(false);
    }
  }, [templateContent, taskType, promptName, promptCategory, showProjectContext, includeAllFilteredIds, currentProjectId, configOverrides, promptTypeOverrides, variableOverrides]);

  // Debounced render effect
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      renderPreview();
    }, DEBOUNCE_DELAY);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [renderPreview]);

  // Initial render (immediate)
  useEffect(() => {
    renderPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Config override setter
  const setConfigOverride = useCallback((key: keyof ConfigData, value: any) => {
    setConfigOverrides(prev => ({ ...prev, [key]: value }));
  }, []);

  // Prompt-type override setter
  const setPromptTypeOverride = useCallback((path: string, value: any) => {
    setPromptTypeOverrides(prev => ({ ...prev, [path]: value }));
  }, []);

  // Variable override setter
  const setVariableOverride = useCallback((name: string, value: any) => {
    setVariableOverrides(prev => ({ ...prev, [name]: value }));
  }, []);

  // Reset all overrides
  const resetOverrides = useCallback(() => {
    setConfigOverrides({});
    setPromptTypeOverrides({});
    setVariableOverrides({});
  }, []);

  // Manual refresh
  const refresh = useCallback(() => {
    renderPreview();
  }, [renderPreview]);

  // Character count
  const characterCount = useMemo(() => {
    return renderedPreview.length;
  }, [renderedPreview]);

  // Token counting
  const {
    tokenCount,
    isLoading: isCountingTokens,
    error: tokenCountError,
    isEstimate: isTokenCountEstimate,
  } = useTokenCount({
    text: renderedPreview,
    provider: taskConfig?.provider || 'openrouter',
    model: taskConfig?.model || '',
    tokenizer_override: taskConfig?.advanced?.tokenizer_override,
    enabled: !isLoading && !error,
  });

  // Auto-switch to no project context if no project selected
  useEffect(() => {
    if (!currentProjectId && showProjectContext) {
      setShowProjectContext(false);
    }
  }, [currentProjectId, showProjectContext]);

  return {
    renderedPreview,
    isLoading,
    error,
    characterCount,
    tokenCount,
    isCountingTokens,
    tokenCountError,
    isTokenCountEstimate,
    showProjectContext,
    setShowProjectContext,
    includeAllFilteredIds,
    setIncludeAllFilteredIds,
    configOverrides,
    setConfigOverride,
    promptTypeOverrides,
    setPromptTypeOverride,
    variableOverrides,
    setVariableOverride,
    userVariables,
    resetOverrides,
    refresh,
  };
}
