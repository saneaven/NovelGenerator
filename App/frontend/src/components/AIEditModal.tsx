import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import type { ObjectType } from '../types/unifiedObject';
import type { FunctionCallMetadata } from '../llm/requestTypes';
import type { StoryObjects, StoryObjectCategory } from '../types/storyObject';
import { createEmptyStoryObjects } from '../types/storyObject';
import { applyEditFunctionCalls } from '../chat/utils/editFunctionApplicator';
import { useLLMTaskStore } from '../store/llmTaskStore';
import { generateTempId } from '../utils/tempId';
import { parseJsonOutput, extractRawContent } from '../utils/nativeOutputParser';
import { useLLMToast } from '../hooks/useLLMToast';
import { LLMTask, LLMTaskMode, type StoryObjectEditPromptContext } from '../llm';
import GroupedFunctionCallCard from './functionCall/GroupedFunctionCallCard';
import './AIEditModal.css';

interface ContextOptions {
  basicInfo: boolean;
  characters: boolean;
  organizations: boolean;
  locations: boolean;
  lorebook: boolean;
  outline: boolean;
}

interface AIEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  category: ObjectType;
  projectId: string;
  targetId?: string;
  onResult?: (result?: any) => void | Promise<void>;
  defaultUserRequest?: string;
  defaultContextOptions?: ContextOptions;
}

const createSessionId = () => `ai-edit-${generateTempId()}`;

const getCategoryDisplayName = (cat: string): string => {
  const names: Record<string, string> = {
    basic_info: 'Basic Info',
    character: 'Character',
    organization: 'Organization',
    location: 'Location',
    lorebook: 'Lorebook',
    outline: 'Outline',
    act: 'Act',
    chapter: 'Chapter',
  };
  return names[cat] || cat;
};

const toStoryObjects = (contextData: Record<string, any>): StoryObjects => {
  const fallbackId = () => generateTempId();

  const mapItems = (items?: any[]) =>
    Array.isArray(items)
      ? items.map((item) => ({
          id: item?.id ?? item?.metadata?.id ?? fallbackId(),
          name: item?.name ?? item?.title ?? '',
          description: item?.description ?? item?.summary ?? '',
        }))
      : [];

  const mapOutline = (outlineData?: any) => {
    if (!outlineData) return { acts: [] };

    const acts = Array.isArray(outlineData.acts)
      ? outlineData.acts.map((act: any) => ({
          id: act?.id ?? fallbackId(),
          name: act?.name ?? '',
          description: act?.description ?? '',
          chapters: Array.isArray(act?.chapters)
            ? act.chapters.map((chapter: any) => ({
                id: chapter?.id ?? fallbackId(),
                name: chapter?.name ?? '',
                description: chapter?.description ?? '',
              }))
            : [],
        }))
      : [];

    return {
      id: outlineData?.id ?? fallbackId(),
      name: outlineData?.name ?? '',
      description: outlineData?.description ?? '',
      acts,
    };
  };

  return {
    basicInfo: contextData.basicInfo
      ? {
          id: contextData.basicInfo.id ?? fallbackId(),
          title: contextData.basicInfo.title ?? '',
          logline: contextData.basicInfo.logline ?? '',
          genre: contextData.basicInfo.genre ?? '',
        }
      : null,
    characters: mapItems(contextData.characters),
    organizations: mapItems(contextData.organizations),
    locations: mapItems(contextData.locations),
    lorebook: mapItems(contextData.lorebook),
    outline: mapOutline(contextData.outline),
  } as unknown as StoryObjects;
};

const AIEditModal: React.FC<AIEditModalProps> = ({
  isOpen,
  onClose,
  category,
  projectId,
  targetId,
  onResult,
  defaultUserRequest,
  defaultContextOptions,
}) => {
  const [userRequest, setUserRequest] = useState(defaultUserRequest ?? '');
  const [contextOptions, setContextOptions] = useState<ContextOptions>(
    defaultContextOptions ?? {
      basicInfo: true,
      characters: true,
      organizations: true,
      locations: true,
      lorebook: true,
      outline: true,
    }
  );

  const unifiedStore = useUnifiedObjectStore();
  const settingsStore = useSettingsStore();
  const abortControllerRef = useRef<AbortController | null>(null);
  const taskRef = useRef<LLMTask | null>(null);
  const sessionIdRef = useRef<string>(createSessionId());
  const sessionId = sessionIdRef.current;

  const categoryDisplayName = getCategoryDisplayName(category);
  const editTypeText = targetId ? 'Item' : 'All';
  const toastLabel = `AI ${categoryDisplayName} ${editTypeText} Edit`;

  const { startTask, completeSuccess, completeError, completeCancelled } = useLLMToast({
    taskType: 'ai-edit',
    label: toastLabel,
    sessionId,
  });

  const session = useLLMTaskStore(useCallback((state) => state.sessions[sessionId], [sessionId]));
  const initializeSession = useLLMTaskStore((state) => state.initializeSession);
  const updateSession = useLLMTaskStore((state) => state.updateSession);
  const setFunctionCallProgress = useLLMTaskStore((state) => state.setFunctionCallProgress);
  const clearSession = useLLMTaskStore((state) => state.clearSession);
  const [storyObjectsPreview, setStoryObjectsPreview] = useState<StoryObjects>(createEmptyStoryObjects());

  const isProcessing = session?.status === 'running';
  const sessionError = session?.error ?? null;
  const streamContent = useMemo(() => {
    if (!session?.contentParts?.length) return '';
    return session.contentParts
      .filter((part) => part.type === 'content')
      .map((part) => part.text)
      .join('');
  }, [session?.contentParts]);
  const functionCallProgress = session?.functionCallProgress ?? [];
  const showStreamingPlaceholder = isProcessing && !streamContent && functionCallProgress.length === 0;

  useEffect(() => {
    if (isOpen) {
      initializeSession(sessionId);
      updateSession(sessionId, { status: 'idle', error: undefined });
    } else {
      setUserRequest('');
      setStoryObjectsPreview(createEmptyStoryObjects());
    }
  }, [isOpen, sessionId, initializeSession, updateSession]);

  useEffect(() => {
    return () => {
      taskRef.current?.abort();
      clearSession(sessionId);
    };
  }, [sessionId, clearSession]);

  const getObjectData = (obj: any): Record<string, any> => {
    const mainLanguage = settingsStore.settings.mainLanguage;
    const data = obj.data[mainLanguage];
    if (data) return data;
    const availableLanguages = Object.keys(obj.data);
    return availableLanguages.length > 0 ? obj.data[availableLanguages[0]] : {};
  };

  const generateContext = async (): Promise<Record<string, any>> => {
    const context: Record<string, any> = {};

    try {
      if (contextOptions.basicInfo) {
        const basicInfoList = await unifiedStore.listObjects('basic_info', projectId);
        if (basicInfoList.length > 0) {
          const data = getObjectData(basicInfoList[0]);
          context.basicInfo = { title: data.title || '', logline: data.logline || '', genre: data.genre || '' };
        }
      }

      if (contextOptions.characters) {
        const characters = await unifiedStore.listObjects('character', projectId);
        context.characters = characters.map(char => {
          const data = getObjectData(char);
          return { id: char.id, name: data.name || '', description: data.description || '' };
        });
      }

      if (contextOptions.organizations) {
        const organizations = await unifiedStore.listObjects('organization', projectId);
        context.organizations = organizations.map(org => {
          const data = getObjectData(org);
          return { id: org.id, name: data.name || '', description: data.description || '' };
        });
      }

      if (contextOptions.locations) {
        const locations = await unifiedStore.listObjects('location', projectId);
        context.locations = locations.map(loc => {
          const data = getObjectData(loc);
          return { id: loc.id, name: data.name || '', description: data.description || '' };
        });
      }

      if (contextOptions.lorebook) {
        const lorebook = await unifiedStore.listObjects('lorebook', projectId);
        context.lorebook = lorebook.map(entry => {
          const data = getObjectData(entry);
          return { id: entry.id, name: data.name || '', description: data.description || '' };
        });
      }

      if (contextOptions.outline) {
        const acts = await unifiedStore.listObjects('act', projectId);
        const chapters = await unifiedStore.listObjects('chapter', projectId);
        context.outline = {
          acts: acts
            .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
            .map(act => {
              const actData = getObjectData(act);
              return {
                id: act.id,
                name: actData.name || '',
                description: actData.description || '',
                chapters: chapters
                  .filter(ch => ch.metadata.act_id === act.id)
                  .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
                  .map(chapter => {
                    const chapterData = getObjectData(chapter);
                    return { id: chapter.id, name: chapterData.name || '', description: chapterData.description || '' };
                  }),
              };
            }),
        };
      }
    } catch (err) {
      console.error('Error generating context:', err);
    }

    return context;
  };

  const getCurrentData = async () => {
    if (targetId) {
      const object = unifiedStore.objects[targetId];
      if (!object) {
        try {
          await unifiedStore.fetchObject(category, targetId);
          return unifiedStore.objects[targetId];
        } catch {
          return null;
        }
      }
      return object;
    }
    try {
      return await unifiedStore.listObjects(category, projectId);
    } catch {
      return [];
    }
  };

  const handleFunctionCallResults = useCallback(
    async (functionCalls: FunctionCallMetadata[]) => {
      if (!functionCalls?.length) {
        const errorMsg = 'AI response did not include structured edits to apply.';
        updateSession(sessionId, { status: 'error', error: errorMsg });
        completeError(errorMsg);
        return;
      }

      try {
        const results = await applyEditFunctionCalls(projectId, functionCalls);
        const failedResults = results.filter((result) => !result.success);

        if (failedResults.length > 0) {
          const errorMsg = `Failed to apply some edits: ${failedResults.map(r => r.error || r.message).join(', ')}`;
          updateSession(sessionId, { status: 'error', error: errorMsg });
          completeError(errorMsg);
          return;
        }

        updateSession(sessionId, { status: 'success', error: undefined });
        completeSuccess();
        onResult?.();
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to apply edits';
        updateSession(sessionId, { status: 'error', error: errorMsg });
        completeError(errorMsg);
      }
    },
    [projectId, sessionId, updateSession, onResult, completeSuccess, completeError]
  );

  const handleNativeOutput = useCallback(
    async (text: string) => {
      const cleanedText = extractRawContent(text);
      const parsedItems = parseJsonOutput(cleanedText);

      if (parsedItems.length === 0) {
        const errorMsg = 'AI did not return valid JSON output.';
        updateSession(sessionId, { status: 'error', error: errorMsg });
        completeError(errorMsg);
        return;
      }

      for (const item of parsedItems) {
        if (!item.id) continue;
        try {
          await unifiedStore.updateObject(category, item.id, {
            data: { name: item.name, description: item.description },
            language: settingsStore.settings.mainLanguage,
            create_new_version: true,
            user_request: userRequest.trim(),
          });
        } catch (err) {
          console.error(`Failed to update object ${item.id}:`, err);
        }
      }

      updateSession(sessionId, { status: 'success', error: undefined });
      completeSuccess();
      onResult?.();
    },
    [category, sessionId, unifiedStore, settingsStore, userRequest, updateSession, completeSuccess, completeError, onResult]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRequest.trim() || isProcessing) return;

    updateSession(sessionId, { status: 'running', error: undefined });

    startTask({
      taskType: 'ai-edit',
      modalProps: { category, projectId, targetId, onResult },
      formState: { userRequest: userRequest.trim(), contextOptions },
    });

    onClose();

    try {
      const storyObjectEditConfig = settingsStore.getFunctionConfig('storyObjectEdit');
      const providerConfig = settingsStore.getProviderConfig(storyObjectEditConfig.provider);
      const isNativeOutput = settingsStore.settings.nativeOutputMode;

      const contextData = await generateContext();
      setStoryObjectsPreview(toStoryObjects(contextData));
      const currentData = await getCurrentData();

      const promptContext: StoryObjectEditPromptContext = {
        userInput: userRequest.trim(),
        category: category as StoryObjectCategory,
        targetId,
        contextData,
        currentData,
        isNativeOutput,
        outputLanguage: settingsStore.settings.mainLanguage,
        enablePrefill: storyObjectEditConfig.advanced.enablePrefill,
        enableThinking: storyObjectEditConfig.advanced.thinkingMode === 'model',
        enableCustomThinking: storyObjectEditConfig.advanced.thinkingMode === 'custom',
      };

      taskRef.current = new LLMTask(
        {
          mode: LLMTaskMode.STORY_OBJECT_EDIT,
          projectId,
          promptContext,
          abortControllerRef,
          sessionId,
          provider: storyObjectEditConfig.provider,
          providerConfig,
          model: storyObjectEditConfig.model,
          temperature: storyObjectEditConfig.temperature,
          thinkingMode: storyObjectEditConfig.advanced.thinkingMode as any,
          thinkingConfig: storyObjectEditConfig.advanced.thinkingConfig,
          retryConfig: settingsStore.settings.retryConfig,
        },
        {
          onUpdate: () => {},
          onComplete: async (result) => {
            if (isNativeOutput) {
              const text = result.contentParts
                .filter(part => part.type === 'content')
                .map(part => part.text)
                .join('');
              if (text.trim()) {
                await handleNativeOutput(text.trim());
              } else {
                const errorMsg = 'AI did not generate any output.';
                updateSession(sessionId, { status: 'error', error: errorMsg });
                completeError(errorMsg);
              }
            } else {
              await handleFunctionCallResults(result.functionCalls);
            }
          },
          onError: (err) => {
            if (err.name === 'AbortError') {
              updateSession(sessionId, { status: 'cancelled' });
              completeCancelled();
            } else {
              updateSession(sessionId, { status: 'error', error: err.message });
              completeError(err.message);
            }
          },
          onFunctionProgress: isNativeOutput ? undefined : (progress) => setFunctionCallProgress(sessionId, progress),
        }
      );

      await taskRef.current.run();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        updateSession(sessionId, { status: 'cancelled' });
        completeCancelled();
        return;
      }
      const errorMsg = err instanceof Error ? err.message : 'An unknown error occurred.';
      updateSession(sessionId, { status: 'error', error: errorMsg });
      completeError(errorMsg);
    } finally {
      taskRef.current = null;
    }
  };

  const toggleContextOption = (option: keyof ContextOptions) => {
    setContextOptions(prev => ({ ...prev, [option]: !prev[option] }));
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content ai-edit-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>AI {categoryDisplayName} {editTypeText} Edit</h2>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>

        <form onSubmit={handleSubmit} className="ai-edit-form">
          <div className="form-group">
            <label htmlFor="user-request">Edit Request</label>
            <textarea
              id="user-request"
              value={userRequest}
              onChange={(e) => setUserRequest(e.target.value)}
              placeholder={`Enter your edit request for the ${categoryDisplayName} ${editTypeText}.`}
              rows={4}
              required
              disabled={isProcessing}
            />
          </div>

          <div className="form-group context-options">
            <label>Context Inclusion Options</label>
            <div className="checkbox-group">
              {Object.entries(contextOptions).map(([key, checked]) => (
                <label key={key} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleContextOption(key as keyof ContextOptions)}
                    disabled={isProcessing}
                  />
                  <span className="checkbox-text">{getCategoryDisplayName(key)}</span>
                </label>
              ))}
            </div>
            <p className="context-help">
              Select the context for the AI to refer to. Providing more context will lead to more consistent results.
            </p>
          </div>

          {sessionError && <div className="error-message">{sessionError}</div>}

          {showStreamingPlaceholder && (
            <div className="ai-streaming-placeholder">
              <div className="ai-streaming-spinner" />
              <span>AI is composing structured edits...</span>
            </div>
          )}

          {functionCallProgress.length > 0 && (
            <div className="ai-function-preview">
              <GroupedFunctionCallCard
                mode="streaming"
                streamingProgress={functionCallProgress}
                storyObjects={storyObjectsPreview}
              />
            </div>
          )}

          {streamContent && (
            <div className="ai-response">
              <h3>AI Response:</h3>
              <pre className="response-content">{streamContent}</pre>
            </div>
          )}

          <div className="form-actions">
            <button type="button" onClick={onClose} className="cancel-button">Cancel</button>
            <button type="submit" className="submit-button" disabled={!userRequest.trim() || isProcessing}>
              {isProcessing ? 'AI Processing...' : 'Request AI Edit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AIEditModal;
