import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { BaseModal } from './BaseModal';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import type { FunctionCallMetadata } from '../llm/requestTypes';
import type { ManuscriptObject } from '../types/unifiedObject';
import type { PatchRetryContext } from '../types/patchTypes';
import { applyPatch } from '../utils/patchUtils';
import { extractRawContent, parseSingleJsonOutput, isReplacementOperation } from '../utils/nativeOutputParser';
import { LLMTask, LLMTaskMode, LLMTaskManager, type EditAssistantManuscriptPromptContext, type TaskHandle } from '../llm';
import { shouldRetry, buildRetryPrompt, summarizePatchFailures } from '../llm/patchRetryHandler';
import { Expand, Collapse } from './icons';
import { ObjectPicker } from './ObjectPicker';
import { TextButton } from './TextButton';

interface ManuscriptAIEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  chapterId: string;
  chapterName: string;
  onResult?: () => void;
  defaultUserRequest?: string;
  defaultSelectedContextIds?: string[];
}

const ManuscriptAIEditModal: React.FC<ManuscriptAIEditModalProps> = ({
  isOpen,
  onClose,
  projectId,
  chapterId,
  chapterName,
  onResult,
  defaultUserRequest,
  defaultSelectedContextIds,
}) => {
  const [userRequest, setUserRequest] = useState(defaultUserRequest || '');
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>(
    defaultSelectedContextIds ?? []
  );
  const [isContextExpanded, setIsContextExpanded] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(true);

  const unifiedStore = useUnifiedObjectStore();
  const settingsStore = useSettingsStore();
  const abortControllerRef = useRef<AbortController | null>(null);
  const taskRef = useRef<LLMTask | null>(null);

  const getActiveLanguageContent = (targetChapterId: string): string => {
    const manuscriptObj = unifiedStore.getManuscriptByChapterId(targetChapterId) as ManuscriptObject | null;
    if (!manuscriptObj?.data) return '';
    const mainLanguage = settingsStore.settings.mainLanguage;
    const langData = manuscriptObj.data[mainLanguage] || Object.values(manuscriptObj.data)[0];
    return langData?.content || '';
  };

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setUserRequest(defaultUserRequest || '');
      setSelectedContextIds(defaultSelectedContextIds ?? []);
      setPickerLoading(true);
    }
  }, [isOpen, defaultUserRequest, defaultSelectedContextIds]);

  useEffect(() => {
    return () => {
      taskRef.current?.abort();
    };
  }, []);

  // Simple handler for context selection
  const handleContextChange = useCallback((ids: string[] | string) => {
    setSelectedContextIds(Array.isArray(ids) ? ids : [ids]);
  }, []);

  // Exclude current chapter from selection (will show the manuscript for this chapter as excluded)
  const excludedIds = useMemo(() => {
    // Get the manuscript ID for the current chapter
    const manuscriptObj = unifiedStore.getManuscriptByChapterId(chapterId);
    if (manuscriptObj) {
      return [manuscriptObj.id];
    }
    return [];
  }, [chapterId, unifiedStore]);

  // On picker load complete
  const handlePickerLoadComplete = useCallback(() => {
    setPickerLoading(false);
  }, []);

  // These handlers now accept a task handle for proper completion tracking
  const handleFunctionCallResults = useCallback(
    async (
      functionCalls: FunctionCallMetadata[],
      task: TaskHandle,
      attemptCount: number = 0,
      retryCallback?: (retryContexts: PatchRetryContext[], attemptCount: number) => Promise<void>
    ) => {
      // Look for new function names first, fall back to legacy
      const replaceCall = functionCalls.find((fc) => fc.function_name === 'replace_manuscript');
      const patchCall = functionCalls.find((fc) => fc.function_name === 'patch_manuscript');
      const legacyCall = functionCalls.find((fc) => fc.function_name === 'update_manuscript');

      const functionCall = replaceCall || patchCall || legacyCall;
      if (!functionCall) {
        task.error('AI did not call a manuscript update function');
        return;
      }

      try {
        const args = typeof functionCall.arguments === 'string' ? JSON.parse(functionCall.arguments) : functionCall.arguments;
        const manuscriptObj = unifiedStore.getObject(args.id);
        if (!manuscriptObj) {
          task.error(`Manuscript not found: ${args.id}`);
          return;
        }

        // Get current content for patch resolution
        const mainLanguage = settingsStore.settings.mainLanguage;
        const currentData = manuscriptObj.data[mainLanguage] || Object.values(manuscriptObj.data)[0] || {};
        const currentContent = currentData.content || '';

        const retryContexts: PatchRetryContext[] = [];
        let resolvedContent: string;

        if (functionCall.function_name === 'replace_manuscript') {
          // Full replacement
          resolvedContent = args.content;
        } else if (functionCall.function_name === 'patch_manuscript') {
          // Search and replace patches
          const result = applyPatch(currentContent, args.replacements || []);
          resolvedContent = result.value;

          if (!result.success && result.needsRetry) {
            retryContexts.push({
              objectId: manuscriptObj.id,
              fieldName: 'content',
              currentValue: currentContent,
              error: result.error || 'Patch application failed',
            });
          }
        } else {
          // Legacy update_manuscript - treat content as full replacement
          resolvedContent = typeof args.content === 'string' ? args.content : currentContent;
        }

        // ALWAYS save the resolved content first (even if some patches failed)
        // This ensures successful patches are applied before retry/error handling
        const wordCount = resolvedContent.trim().split(/\s+/).filter(Boolean).length;
        await unifiedStore.updateObject('manuscript', manuscriptObj.id, {
          data: { content: resolvedContent, wordCount },
          language: mainLanguage,
          create_new_version: true,
          user_request: 'AI Generated Content',
        });

        // Check if we should retry with replace mode
        if (retryContexts.length > 0 && shouldRetry(retryContexts, attemptCount)) {
          console.log('Patch failures detected, retrying with replace mode:', summarizePatchFailures(retryContexts));
          if (retryCallback) {
            await retryCallback(retryContexts, attemptCount + 1);
            return;
          }
        }

        // If there were retry contexts but retry was not possible, report them
        if (retryContexts.length > 0) {
          task.error(`Patch application failed: ${summarizePatchFailures(retryContexts)}`);
          return;
        }

        task.complete();
        onResult?.();
      } catch (err) {
        task.error(err instanceof Error ? err.message : 'Failed to apply chapter content update');
      }
    },
    [unifiedStore, settingsStore, onResult]
  );

  const handleNativeOutput = useCallback(
    async (text: string, task: TaskHandle) => {
      const cleanedText = extractRawContent(text);
      const parsed = parseSingleJsonOutput(cleanedText);

      const manuscriptObj = unifiedStore.getObject(parsed.id as string);
      if (!manuscriptObj) {
        task.error(`Manuscript not found: ${parsed.id}`);
        return;
      }

      const mainLanguage = settingsStore.settings.mainLanguage;
      const currentData = manuscriptObj.data[mainLanguage] || Object.values(manuscriptObj.data)[0] || {};
      const currentContent = currentData.content || '';
      let finalContent: string;

      // Check for different output formats:
      // 1. Direct string content (full replacement)
      // 2. { content: "..." } (full replacement)
      // 3. { replacements: [{old, new}] } (search-replace patches)
      // 4. { content: { replacements: [...] } } (nested patch format)
      if (typeof parsed === 'string') {
        finalContent = parsed;
      } else if (parsed?.replacements && Array.isArray(parsed.replacements)) {
        // Root level replacements
        const result = applyPatch(currentContent, parsed.replacements);
        if (!result.success) {
          task.error(result.error || 'Failed to apply content changes.');
          return;
        }
        finalContent = result.value;
      } else if (typeof parsed?.content === 'string') {
        // Direct content string
        finalContent = parsed.content;
      } else if (isReplacementOperation(parsed?.content)) {
        // Content with replacements
        const result = applyPatch(currentContent, parsed.content.replacements);
        if (!result.success) {
          task.error(result.error || 'Failed to apply content changes.');
          return;
        }
        finalContent = result.value;
      } else {
        task.error('AI did not return valid JSON output.');
        return;
      }

      const wordCount = finalContent.trim().split(/\s+/).filter(Boolean).length;

      await unifiedStore.updateObject('manuscript', manuscriptObj.id, {
        data: { content: finalContent, wordCount },
        language: settingsStore.settings.mainLanguage,
        create_new_version: true,
        user_request: 'AI Generated Content',
      });

      task.complete();
      onResult?.();
    },
    [unifiedStore, settingsStore, onResult]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRequest.trim()) return;

    // Start task via LLMTaskManager - returns a handle with bound completion functions
    const task = LLMTaskManager.startTask({
      taskType: 'chapter-edit',
      label: `AI Edit: ${chapterName}`,
      retryContext: {
        taskType: 'chapter-edit',
        modalProps: { projectId, chapterId, chapterName, onResult },
        formState: { userRequest, selectedContextIds },
      },
    });

    onClose();

    try {
      const editAssistantConfig = settingsStore.getFunctionConfig('editAssistant');
      const providerConfig = settingsStore.getProviderConfig(editAssistantConfig.provider);
      const isNativeOutput = settingsStore.settings.nativeOutputMode;

      const currentContent = getActiveLanguageContent(chapterId);
      const manuscriptObj = unifiedStore.getManuscriptByChapterId(chapterId);
      if (!manuscriptObj) {
        task.error(`Manuscript not found for chapter ${chapterId}`);
        return;
      }

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

        // Filter out the current manuscript from context IDs
        const contextIds = selectedContextIds.filter(id => id !== manuscriptObj.id);

        const promptContext: EditAssistantManuscriptPromptContext = {
          userInput: effectiveUserInput,
          projectId,
          currentId: manuscriptObj.id,
          currentChapterId: chapterId,
          currentChapterName: chapterName,
          currentChapterContent: currentContent,
          objectIds: contextIds.length > 0 ? contextIds : undefined,
          isNativeOutput,
          outputLanguage: settingsStore.settings.mainLanguage,
          enablePrefill: editAssistantConfig.advanced.enablePrefill,
          enableThinking: editAssistantConfig.advanced.thinkingMode === 'model',
          enableCustomThinking: editAssistantConfig.advanced.thinkingMode === 'custom',
        };

        return new Promise((resolve, reject) => {
          taskRef.current = new LLMTask(
            {
              mode: LLMTaskMode.EDIT_ASSISTANT_MANUSCRIPT,
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
                    const text = result.contentParts.filter(part => part.type === 'content').map(part => part.text).join('');
                    if (text.trim()) {
                      await handleNativeOutput(text.trim(), task);
                    } else {
                      task.error('AI did not generate any content.');
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
      title={<>AI Chapter Edit <span className="chapter-name-badge">{chapterName}</span></>}
      className="novel-chapter-ai-edit-modal"
      footer={
        <>
          <TextButton variant="secondary" type="button" onClick={onClose}>Cancel</TextButton>
          <TextButton
            variant="primary"
            type="submit"
            form="novel-chapter-ai-edit-form"
            disabled={!userRequest.trim() || pickerLoading}
          >
            Request AI Edit
          </TextButton>
        </>
      }
    >
      <form id="novel-chapter-ai-edit-form" onSubmit={handleSubmit} className="ai-edit-form">
        <div className="form-group">
          <label htmlFor="user-request">Edit Request</label>
          <textarea
            id="user-request"
            value={userRequest}
            onChange={(e) => setUserRequest(e.target.value)}
            placeholder={`Enter your edit request for "${chapterName}".`}
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
                  mode="all"
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
                  selectAllOnLoad={!defaultSelectedContextIds?.length}
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

export default ManuscriptAIEditModal;
