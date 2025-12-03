import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import type { ObjectType } from '../types/unifiedObject';
import type { FunctionCallMetadata } from '../llm_request/types';
import type { StoryObjects } from '../types/storyObject';
import { createEmptyStoryObjects } from '../types/storyObject';
import { LLMRequestPipeline } from '../chat/LLMRequestPipeline';
import { getEditFunctionSchema } from '../chat/types/editFunctionSchemas';
import { applyEditFunctionCalls } from '../chat/utils/editFunctionApplicator';
import { LLMRequestManager } from '../chat/sessions/LLMRequestManager';
import { useLLMTaskStore } from '../store/llmTaskStore';
import { generateTempId } from '../utils/tempId';
import { parseJsonOutput, extractRawContent } from '../utils/nativeOutputParser';
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
}

const createSessionId = () => `ai-edit-${generateTempId()}`;

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
    if (!outlineData) {
      return { acts: [] };
    }

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
}) => {
  const [userRequest, setUserRequest] = useState('');
  const [contextOptions, setContextOptions] = useState<ContextOptions>({
    basicInfo: true,
    characters: true,
    organizations: true,
    locations: true,
    lorebook: true,
    outline: true,
  });

  const unifiedStore = useUnifiedObjectStore();
  const settingsStore = useSettingsStore();
  const abortControllerRef = useRef<AbortController | null>(null);
  const taskRunnerRef = useRef<LLMRequestManager | null>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);
  if (!sessionIdRef.current) {
    sessionIdRef.current = createSessionId();
  }
  const sessionId = sessionIdRef.current;

  const session = useLLMTaskStore(useCallback((state) => state.sessions[sessionId], [sessionId]));
  const initializeSession = useLLMTaskStore((state) => state.initializeSession);
  const updateSession = useLLMTaskStore((state) => state.updateSession);
  const setContentParts = useLLMTaskStore((state) => state.setContentParts);
  const setFunctionCallProgress = useLLMTaskStore((state) => state.setFunctionCallProgress);
  const clearSession = useLLMTaskStore((state) => state.clearSession);
  const [storyObjectsPreview, setStoryObjectsPreview] = useState<StoryObjects>(createEmptyStoryObjects());

  const isProcessing = session?.status === 'running';
  const sessionError = session?.error ?? null;
  const streamContent = useMemo(() => {
    if (!session?.contentParts || session.contentParts.length === 0) {
      return '';
    }
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
      return;
    }

    setUserRequest('');
    taskRunnerRef.current?.abort();
    taskRunnerRef.current = null;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    clearSession(sessionId);
    setStoryObjectsPreview(createEmptyStoryObjects());
  }, [isOpen, sessionId, initializeSession, updateSession, clearSession]);

  useEffect(() => {
    return () => {
      taskRunnerRef.current?.abort();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      clearSession(sessionId);
      setStoryObjectsPreview(createEmptyStoryObjects());
    };
  }, [sessionId, clearSession]);

  // Helper to get object data for main language with fallback
  const getObjectData = (obj: any): Record<string, any> => {
    const mainLanguage = settingsStore.settings.mainLanguage;
    const data = obj.data[mainLanguage];
    if (data) return data;
    const availableLanguages = Object.keys(obj.data);
    if (availableLanguages.length > 0) {
      return obj.data[availableLanguages[0]];
    }
    return {};
  };

  const generateContext = async () => {
    const context: Record<string, any> = {};

    try {
      // Basic Info
      if (contextOptions.basicInfo) {
        const basicInfoList = await unifiedStore.listObjects('basic_info', projectId);
        if (basicInfoList.length > 0) {
          const basicInfo = basicInfoList[0];
          const data = getObjectData(basicInfo);
          context.basicInfo = {
            title: data.title || '',
            logline: data.logline || '',
            genre: data.genre || '',
          };
        }
      }

      // Characters
      if (contextOptions.characters) {
        const characters = await unifiedStore.listObjects('character', projectId);
        if (characters.length > 0) {
          context.characters = characters.map(char => {
            const data = getObjectData(char);
            return {
              id: char.id,
              name: data.name || '',
              description: data.description || '',
            };
          });
        }
      }

      // Organizations
      if (contextOptions.organizations) {
        const organizations = await unifiedStore.listObjects('organization', projectId);
        if (organizations.length > 0) {
          context.organizations = organizations.map(org => {
            const data = getObjectData(org);
            return {
              id: org.id,
              name: data.name || '',
              description: data.description || '',
            };
          });
        }
      }

      // Locations
      if (contextOptions.locations) {
        const locations = await unifiedStore.listObjects('location', projectId);
        if (locations.length > 0) {
          context.locations = locations.map(loc => {
            const data = getObjectData(loc);
            return {
              id: loc.id,
              name: data.name || '',
              description: data.description || '',
            };
          });
        }
      }

      // Lorebook
      if (contextOptions.lorebook) {
        const lorebook = await unifiedStore.listObjects('lorebook', projectId);
        if (lorebook.length > 0) {
          context.lorebook = lorebook.map(entry => {
            const data = getObjectData(entry);
            return {
              id: entry.id,
              name: data.name || '',
              description: data.description || '',
            };
          });
        }
      }

      // Outline
      if (contextOptions.outline) {
        const acts = await unifiedStore.listObjects('act', projectId);
        const chapters = await unifiedStore.listObjects('chapter', projectId);

        if (acts.length > 0) {
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
                      return {
                        id: chapter.id,
                        name: chapterData.name || '',
                        description: chapterData.description || '',
                      };
                    }),
                };
              }),
          };
        }
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
        } catch (err) {
          console.error('Failed to fetch target object:', err);
          return null;
        }
      }
      return object;
    } else {
      try {
        const objects = await unifiedStore.listObjects(category, projectId);
        return objects;
      } catch (err) {
        console.error('Failed to list objects:', err);
        return [];
      }
    }
  };

  const handleFunctionCallResults = useCallback(
    async (functionCalls: FunctionCallMetadata[]) => {
      if (!functionCalls || functionCalls.length === 0) {
        updateSession(sessionId, {
          status: 'error',
          error: 'AI response did not include structured edits to apply.',
        });
        return;
      }

      try {
        const results = await applyEditFunctionCalls(projectId, functionCalls);
        const failedResults = results.filter((result) => !result.success);

        if (failedResults.length > 0) {
          updateSession(sessionId, {
            status: 'error',
            error: `Failed to apply some edits: ${failedResults.map(r => r.error || r.message).join(', ')}`,
          });
          return;
        }

        updateSession(sessionId, { status: 'success', error: undefined });
        onResult?.();
        onClose();
      } catch (err) {
        console.error('Function application error:', err);
        updateSession(sessionId, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Failed to apply edits',
        });
      }
    },
    [projectId, sessionId, updateSession, onResult, onClose]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRequest.trim() || isProcessing) return;

    updateSession(sessionId, { status: 'running', error: undefined });
    setContentParts(sessionId, []);

    try {
      const storyEditConfig = settingsStore.getFunctionConfig('storyEdit');
      const providerConfig = settingsStore.getProviderConfig(storyEditConfig.provider);
      const functionSchema = getEditFunctionSchema(category, !!targetId);
      const contextData = await generateContext();
      setStoryObjectsPreview(toStoryObjects(contextData));
      const currentData = await getCurrentData();

      const isNativeOutput = settingsStore.settings.nativeOutputMode;

      const getStoryObjects = () => ({
        basicInfo: null,
        characters: [],
        organizations: [],
        locations: [],
        lorebook: [],
        outline: { acts: [] },
      });

      const systemInsertConfig = {
        enabled: true,
        includeProjectInfo: true,
        includeStoryObjects: true,
        includeNovelContent: false,
        promptContext: {
          category,
          targetId,
          contextData,
          currentData,
          userRequest: userRequest.trim(),
          enablePrefill: storyEditConfig.advanced.enablePrefill,
          enableThinking: storyEditConfig.advanced.thinkingMode !== 'off',
          isNativeOutput,
        },
        promptType: 'story_object_edit' as const,
      };

      // Native output handler for single/batch edits
      const handleNativeOutput = async (text: string) => {
        const cleanedText = extractRawContent(text);

        // Parse JSON array output (used for both single and batch edits)
        const parsedItems = parseJsonOutput(cleanedText);
        if (parsedItems.length === 0) {
          updateSession(sessionId, {
            status: 'error',
            error: 'AI did not return valid JSON output.',
          });
          return;
        }

        // Apply each parsed item
        for (const item of parsedItems) {
          if (!item.id) continue;
          try {
            await unifiedStore.updateObject(category, item.id, {
              data: {
                name: item.name,
                description: item.description,
              },
              language: settingsStore.settings.mainLanguage,
              create_new_version: true,
              user_request: userRequest.trim(),
            });
          } catch (err) {
            console.error(`Failed to update object ${item.id}:`, err);
          }
        }

        updateSession(sessionId, { status: 'success', error: undefined });
        onResult?.();
        onClose();
      };

      taskRunnerRef.current = new LLMRequestManager(
        {
          projectId,
          getStoryObjects,
          systemInsertConfig,
          chatPipeline: new LLMRequestPipeline(),
          provider: storyEditConfig.provider,
          providerConfig,
          aiModel: storyEditConfig.model,
          temperature: storyEditConfig.temperature,
          providerPreference: storyEditConfig.providerPreference,
          functions: isNativeOutput ? undefined : [functionSchema],
          toolChoice: isNativeOutput ? undefined : 'required',
          mode: 'workspace',
          enablePrefill: storyEditConfig.advanced.enablePrefill,
          thinkingMode: storyEditConfig.advanced.thinkingMode as any,
          thinkingConfig: storyEditConfig.advanced.thinkingConfig,
          retryConfig: settingsStore.settings.retryConfig,
          abortControllerRef,
        },
        {
          onStreamUpdate: (contentParts) => setContentParts(sessionId, contentParts),
          onFunctionCallProgress: isNativeOutput ? undefined : (progress) => setFunctionCallProgress(sessionId, progress),
          onFunctionCalls: isNativeOutput ? undefined : handleFunctionCallResults,
          onFinalMessage: async (message) => {
            if (isNativeOutput) {
              // Native mode: extract text and apply directly
              const text = message.contentParts
                ?.filter(part => part.type === 'content')
                .map(part => part.text)
                .join('') || '';
              if (text.trim()) {
                await handleNativeOutput(text.trim());
              } else {
                updateSession(sessionId, {
                  status: 'error',
                  error: 'AI did not generate any output.',
                });
              }
            } else {
              // Function mode: success if no function calls pending
              if (!message.functionCalls || message.functionCalls.length === 0) {
                updateSession(sessionId, { status: 'success', error: undefined });
              }
            }
          },
          onError: (err) => {
            updateSession(sessionId, { status: 'error', error: err.message });
          },
        }
      );

      await taskRunnerRef.current.run(
        null,
        {
          history: [],
          language: settingsStore.settings.mainLanguage,
        }
      );
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        updateSession(sessionId, { status: 'cancelled' });
        return;
      }
      updateSession(sessionId, {
        status: 'error',
        error: err instanceof Error ? err.message : 'An unknown error occurred.',
      });
    } finally {
      taskRunnerRef.current = null;
    }
  };

  const handleCancel = () => {
    taskRunnerRef.current?.abort();
    taskRunnerRef.current = null;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    onClose();
  };

  const toggleContextOption = (option: keyof ContextOptions) => {
    setContextOptions(prev => ({
      ...prev,
      [option]: !prev[option],
    }));
  };

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

  if (!isOpen) return null;

  const categoryDisplayName = getCategoryDisplayName(category);
  const editTypeText = targetId ? 'Item' : 'All';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content ai-edit-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🤖 AI {categoryDisplayName} {editTypeText} Edit</h2>
          <button className="modal-close" onClick={handleCancel}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="ai-edit-form">
          <div className="form-group">
            <label htmlFor="user-request">Edit Request</label>
            <textarea
              id="user-request"
              value={userRequest}
              onChange={(e) => setUserRequest(e.target.value)}
              placeholder={`Enter your edit request for the ${categoryDisplayName} ${editTypeText}.
e.g., "Make the main character's personality more proactive", "Make the atmosphere of all locations darker"`}
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
                  <span className="checkbox-text">
                    {getCategoryDisplayName(key)}
                  </span>
                </label>
              ))}
            </div>
            <p className="context-help">
              Select the context for the AI to refer to. Providing more context will lead to more consistent results.
            </p>
          </div>

          {sessionError && (
            <div className="error-message">
              {sessionError}
            </div>
          )}

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
            <button
              type="button"
              onClick={handleCancel}
              className="cancel-button"
              disabled={isProcessing}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="submit-button"
              disabled={!userRequest.trim() || isProcessing}
            >
              {isProcessing ? 'AI Processing...' : 'Request AI Edit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AIEditModal;
