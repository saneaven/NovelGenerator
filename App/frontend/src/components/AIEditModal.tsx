import React, { useState, useRef, useEffect, useCallback } from 'react';
import { BaseModal } from './BaseModal';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import type { ObjectType } from '../types/unifiedObject';
import type { FunctionCallMetadata } from '../llm/requestTypes';
import type { StoryObjectCategory } from '../types/storyObject';
import type { PatchRetryContext } from '../types/patchTypes';
import { applyEditFunctionCalls } from '../chat/utils/editFunctionApplicator';
import { parseJsonOutput, extractRawContent } from '../utils/nativeOutputParser';
import { LLMTask, LLMTaskMode, LLMTaskManager, type StoryObjectEditPromptContext, type TaskHandle } from '../llm';
import { shouldRetry, buildRetryPrompt, summarizePatchFailures } from '../llm/patchRetryHandler';
import { Lightbulb } from './icons';
import { TextButton } from './TextButton';
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

  const categoryDisplayName = getCategoryDisplayName(category);
  const editTypeText = targetId ? 'Item' : 'All';

  useEffect(() => {
    if (!isOpen) {
      setUserRequest('');
    }
  }, [isOpen]);

  // Note: abort is handled by LLMTaskManager.cancelTask() via toast dismiss
  // No cleanup abort needed here as task continues in background after modal closes

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
    async (
      functionCalls: FunctionCallMetadata[],
      task: TaskHandle,
      attemptCount: number = 0,
      retryCallback?: (retryContexts: PatchRetryContext[], attemptCount: number) => Promise<void>
    ) => {
      if (!functionCalls?.length) {
        task.error('AI response did not include structured edits to apply.');
        return;
      }

      try {
        const results = await applyEditFunctionCalls(projectId, functionCalls);

        // Collect all retry contexts from results
        const allRetryContexts: PatchRetryContext[] = [];
        for (const result of results) {
          if (result.retryContexts?.length) {
            allRetryContexts.push(...result.retryContexts);
          }
        }

        // Check if we should retry with replace mode
        if (allRetryContexts.length > 0 && shouldRetry(allRetryContexts, attemptCount)) {
          console.log('Patch failures detected, retrying with replace mode:', summarizePatchFailures(allRetryContexts));
          if (retryCallback) {
            await retryCallback(allRetryContexts, attemptCount + 1);
            return;
          }
        }

        // Check for other failures (non-retry)
        const failedResults = results.filter((result) => !result.success && !result.retryContexts?.length);
        if (failedResults.length > 0) {
          task.error(`Failed to apply some edits: ${failedResults.map(r => r.error || r.message).join(', ')}`);
          return;
        }

        // If there were retry contexts but retry was not possible, report them
        if (allRetryContexts.length > 0) {
          task.error(`Patch application failed: ${summarizePatchFailures(allRetryContexts)}`);
          return;
        }

        task.complete();
        onResult?.();
      } catch (err) {
        task.error(err instanceof Error ? err.message : 'Failed to apply edits');
      }
    },
    [projectId, onResult]
  );

  const handleNativeOutput = useCallback(
    async (text: string, task: TaskHandle) => {
      const cleanedText = extractRawContent(text);
      const parsedItems = parseJsonOutput(cleanedText);

      if (parsedItems.length === 0) {
        task.error('AI did not return valid JSON output.');
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

      task.complete();
      onResult?.();
    },
    [category, unifiedStore, settingsStore, userRequest, onResult]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRequest.trim()) return;

    const toastLabel = `AI ${categoryDisplayName} ${editTypeText} Edit`;

    // Start task via LLMTaskManager - returns a handle with bound completion functions
    const task = LLMTaskManager.startTask({
      taskType: 'ai-edit',
      label: toastLabel,
      retryContext: {
        taskType: 'ai-edit',
        modalProps: { category, projectId, targetId, onResult },
        formState: { userRequest: userRequest.trim(), contextOptions },
      },
    });

    onClose();

    try {
      const storyObjectEditConfig = settingsStore.getFunctionConfig('storyObjectEdit');
      const providerConfig = settingsStore.getProviderConfig(storyObjectEditConfig.provider);
      const isNativeOutput = settingsStore.settings.nativeOutputMode;

      const contextData = await generateContext();
      const currentData = await getCurrentData();

      // Function to run the LLM task with optional retry prompt
      const runLLMTask = async (
        attemptCount: number = 0,
        retryContexts?: PatchRetryContext[]
      ): Promise<void> => {
        // Build user input with retry instructions if needed
        let effectiveUserInput = userRequest.trim();
        if (retryContexts?.length) {
          effectiveUserInput = buildRetryPrompt(effectiveUserInput, retryContexts);
        }

        const promptContext: StoryObjectEditPromptContext = {
          userInput: effectiveUserInput,
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

        return new Promise((resolve, reject) => {
          taskRef.current = new LLMTask(
            {
              mode: LLMTaskMode.STORY_OBJECT_EDIT,
              projectId,
              promptContext,
              abortControllerRef,
              sessionId: task.sessionId,
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
                try {
                  if (isNativeOutput) {
                    const text = result.contentParts
                      .filter(part => part.type === 'content')
                      .map(part => part.text)
                      .join('');
                    if (text.trim()) {
                      await handleNativeOutput(text.trim(), task);
                    } else {
                      task.error('AI did not generate any output.');
                    }
                  } else {
                    // Pass retry callback for patch failure retry
                    await handleFunctionCallResults(
                      result.functionCalls,
                      task,
                      attemptCount,
                      async (newRetryContexts, newAttemptCount) => {
                        console.log(`Retrying with replace mode (attempt ${newAttemptCount})...`);
                        await runLLMTask(newAttemptCount, newRetryContexts);
                      }
                    );
                  }
                  resolve();
                } catch (err) {
                  reject(err);
                }
              },
              onError: (err) => {
                if (err.name === 'AbortError') {
                  task.cancel();
                } else {
                  task.error(err.message);
                }
                reject(err);
              },
            }
          );

          taskRef.current.run().catch(reject);
        });
      };

      await runLLMTask();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        task.cancel();
        return;
      }
      task.error(err instanceof Error ? err.message : 'An unknown error occurred.');
    } finally {
      taskRef.current = null;
    }
  };

  const toggleContextOption = (option: keyof ContextOptions) => {
    setContextOptions(prev => ({ ...prev, [option]: !prev[option] }));
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      size="large"
      title={`AI ${categoryDisplayName} ${editTypeText} Edit`}
      className="ai-edit-modal"
      footer={
        <>
          <TextButton variant="secondary" onClick={onClose}>
            Cancel
          </TextButton>
          <TextButton
            variant="primary"
            type="submit"
            form="ai-edit-form"
            disabled={!userRequest.trim()}
          >
            Request AI Edit
          </TextButton>
        </>
      }
    >
      <form id="ai-edit-form" onSubmit={handleSubmit} className="ai-edit-form">
        <div className="form-group">
          <label htmlFor="user-request">Edit Request</label>
          <textarea
            id="user-request"
            value={userRequest}
            onChange={(e) => setUserRequest(e.target.value)}
            placeholder={`Enter your edit request for the ${categoryDisplayName} ${editTypeText}.`}
            rows={4}
            required
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
                />
                <span className="checkbox-text">{getCategoryDisplayName(key)}</span>
              </label>
            ))}
          </div>
          <p className="context-help">
            <Lightbulb size="sm" />
            Select the context for the AI to refer to. Providing more context will lead to more consistent results.
          </p>
        </div>
      </form>
    </BaseModal>
  );
};

export default AIEditModal;
