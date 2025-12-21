import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { BaseModal } from './BaseModal';
import { useSettingsStore } from '../store/settingsStore';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import type { ObjectType } from '../types/unifiedObject';
import type { FunctionCallMetadata } from '../llm/requestTypes';
import type { PatchRetryContext } from '../types/patchTypes';
import { UnifiedApplicator, type StoreActions, type ApplicationResult } from '../functionCall';
import { parseJsonOutput, extractRawContent } from '../utils/nativeOutputParser';
import { LLMTask, LLMTaskMode, LLMTaskManager, type EditAssistantStoryObjectPromptContext, type TaskHandle } from '../llm';
import { shouldRetry, buildRetryPrompt, summarizePatchFailures } from '../llm/patchRetryHandler';
import { Expand, Collapse } from './icons';
import { ObjectPicker } from './ObjectPicker';
import { TextButton } from './TextButton';
import './AIEditModal.css';

/**
 * Helper to apply edit function calls using UnifiedApplicator
 */
async function applyEditFunctionCalls(
  projectId: string,
  functionCalls: FunctionCallMetadata[],
  language: string
): Promise<ApplicationResult[]> {
  const store = useUnifiedObjectStore.getState();

  const storeActions: StoreActions = {
    getObject: (id) => store.getObject(id),
    fetchObject: (type, id) => store.fetchObject(type, id),
    listObjects: (type, projectId) => store.listObjects(type, projectId),
    createObject: (type, projectId, data, language, metadata, userRequest) =>
      store.createObject(type, projectId, data, language, metadata, userRequest),
    updateObject: (type, id, request) => store.updateObject(type, id, request),
    deleteObject: (type, id) => store.deleteObject(type, id),
  };

  const applicator = new UnifiedApplicator({ store: storeActions });
  const results: ApplicationResult[] = [];

  for (const fc of functionCalls) {
    const args = typeof fc.arguments === 'string' ? JSON.parse(fc.arguments) : fc.arguments;
    const result = await applicator.apply(
      { id: fc.id, function_name: fc.function_name, arguments: args },
      { projectId, language, mode: 'editAssistant' }
    );
    results.push(result);
  }

  return results;
}

interface AIEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  category: ObjectType;
  projectId: string;
  targetId?: string;
  onResult?: (result?: any) => void | Promise<void>;
  defaultUserRequest?: string;
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
}) => {
  const [userRequest, setUserRequest] = useState(defaultUserRequest ?? '');
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
  const [isContextExpanded, setIsContextExpanded] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(true);

  const settingsStore = useSettingsStore();
  const abortControllerRef = useRef<AbortController | null>(null);
  const taskRef = useRef<LLMTask | null>(null);

  const categoryDisplayName = getCategoryDisplayName(category);
  const editTypeText = targetId ? 'Item' : 'All';

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setUserRequest('');
      setSelectedContextIds([]);
      setPickerLoading(true);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      taskRef.current?.abort();
    };
  }, []);

  // Simple handler for context selection
  const handleContextChange = useCallback((ids: string[] | string) => {
    setSelectedContextIds(Array.isArray(ids) ? ids : [ids]);
  }, []);

  // Exclude target ID from selection
  const excludedIds = useMemo(() => {
    if (!targetId) return [];
    return [targetId];
  }, [targetId]);

  // Build contextIds for LLM (filter out targetId)
  const buildContextIds = useCallback((): string[] => {
    return selectedContextIds.filter(id => id !== targetId);
  }, [selectedContextIds, targetId]);

  // On picker load complete
  const handlePickerLoadComplete = useCallback(() => {
    setPickerLoading(false);
  }, []);

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
        const mainLanguage = useSettingsStore.getState().settings.mainLanguage;
        const results = await applyEditFunctionCalls(projectId, functionCalls, mainLanguage);

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

      // Apply edits using applyEditFunctionCalls for consistency
      try {
        const functionCalls: FunctionCallMetadata[] = parsedItems.map((item, index) => ({
          function_name: item.function || 'replace_story_object',
          arguments: JSON.stringify(item),
          id: `native-${index}`,
          isApplied: false,
        }));

        const mainLanguage = useSettingsStore.getState().settings.mainLanguage;
        const results = await applyEditFunctionCalls(projectId, functionCalls, mainLanguage);
        const failedResults = results.filter(r => !r.success);

        if (failedResults.length > 0) {
          task.error(`Failed to apply some edits: ${failedResults.map(r => r.error || r.message).join(', ')}`);
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
        formState: { userRequest: userRequest.trim(), selectedContextIds },
      },
    });

    onClose();

    try {
      const editAssistantConfig = settingsStore.getFunctionConfig('editAssistant');
      const providerConfig = settingsStore.getProviderConfig(editAssistantConfig.provider);
      const isNativeOutput = settingsStore.settings.nativeOutputMode;

      // Build targetIds and contextIds
      const targetIds = targetId ? [targetId] : [];
      const contextIds = buildContextIds();

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

        const promptContext: EditAssistantStoryObjectPromptContext = {
          userInput: effectiveUserInput,
          projectId,
          targetIds,
          contextIds: contextIds.length > 0 ? contextIds : undefined,
          isNativeOutput,
          outputLanguage: settingsStore.settings.mainLanguage,
          enablePrefill: editAssistantConfig.advanced.enablePrefill,
          enableThinking: editAssistantConfig.advanced.thinkingMode === 'model',
          enableCustomThinking: editAssistantConfig.advanced.thinkingMode === 'custom',
        };

        return new Promise((resolve, reject) => {
          taskRef.current = new LLMTask(
            {
              mode: LLMTaskMode.EDIT_ASSISTANT_STORY_OBJECT,
              projectId,
              promptContext,
              abortControllerRef,
              sessionId: task.sessionId,
              provider: editAssistantConfig.provider,
              providerConfig,
              model: editAssistantConfig.model,
              temperature: editAssistantConfig.temperature,
              thinkingMode: editAssistantConfig.advanced.thinkingMode as any,
              thinkingConfig: editAssistantConfig.advanced.thinkingConfig,
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
            disabled={!userRequest.trim() || pickerLoading}
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
          <div
            className="context-options-header"
            onClick={() => setIsContextExpanded(!isContextExpanded)}
          >
            <span className={`context-options-toggle ${isContextExpanded ? 'expanded' : ''}`}>
              {isContextExpanded ? <Collapse size="xs" /> : <Expand size="xs" />}
            </span>
            <label>Context Inclusion Options</label>
          </div>
          {isContextExpanded && (
            <>
              <div className="context-selector">
                <ObjectPicker
                  mode="story-objects"
                  selectionMode="multi"
                  selectedIds={selectedContextIds}
                  onChange={handleContextChange}
                  projectId={projectId}
                  language={settingsStore.settings.mainLanguage}
                  excludedIds={excludedIds}
                  showSearch={true}
                  maxHeight="300px"
                  emptyMessage="No context objects available"
                  onLoadComplete={handlePickerLoadComplete}
                />
              </div>
              <p className="context-help">
                Select individual objects to include as context for the AI.
              </p>
            </>
          )}
        </div>
      </form>
    </BaseModal>
  );
};

export default AIEditModal;
