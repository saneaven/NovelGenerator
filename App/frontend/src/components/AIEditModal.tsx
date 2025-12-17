import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { BaseModal } from './BaseModal';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import type { ObjectType } from '../types/unifiedObject';
import type { FunctionCallMetadata } from '../llm/requestTypes';
import type { PatchRetryContext } from '../types/patchTypes';
import { applyEditFunctionCalls } from '../chat/utils/editFunctionApplicator';
import { parseJsonOutput, extractRawContent } from '../utils/nativeOutputParser';
import { LLMTask, LLMTaskMode, LLMTaskManager, type StoryObjectEditPromptContext, type TaskHandle } from '../llm';
import { shouldRetry, buildRetryPrompt, summarizePatchFailures } from '../llm/patchRetryHandler';
import { Expand, Collapse } from './icons';
import { ObjectPicker } from './ObjectPicker';
import { TextButton } from './TextButton';
import CollapsibleSection from './ui/CollapsibleSection';
import type { ObjectPickerGroup } from './ObjectPicker/types';
import './AIEditModal.css';

// Available objects fetched on modal open
interface OutlineAct {
  id: string;
  name: string;
  chapters: Array<{ id: string; name: string }>;
}

interface AvailableContextObjects {
  basicInfo: { id: string; title: string } | null;
  characters: Array<{ id: string; name: string }>;
  organizations: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  lorebook: Array<{ id: string; name: string }>;
  outlines: Array<OutlineAct>;
}

// User's selection state
interface SelectedContextObjects {
  basicInfo: boolean;
  characters: Set<string>;
  organizations: Set<string>;
  locations: Set<string>;
  lorebook: Set<string>;
  outlineChapters: Set<string>;
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
  const [availableObjects, setAvailableObjects] = useState<AvailableContextObjects | null>(null);
  const [selectedObjects, setSelectedObjects] = useState<SelectedContextObjects>({
    basicInfo: true,
    characters: new Set<string>(),
    organizations: new Set<string>(),
    locations: new Set<string>(),
    lorebook: new Set<string>(),
    outlineChapters: new Set<string>(),
  });
  const [isContextExpanded, setIsContextExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Section collapse state
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    storyObjects: true,
    outlines: true,
  });

  const unifiedStore = useUnifiedObjectStore();
  const settingsStore = useSettingsStore();
  const abortControllerRef = useRef<AbortController | null>(null);
  const taskRef = useRef<LLMTask | null>(null);

  const categoryDisplayName = getCategoryDisplayName(category);
  const editTypeText = targetId ? 'Item' : 'All';

  // Load available objects when modal opens
  const loadAvailableObjects = useCallback(async () => {
    setIsLoading(true);
    const mainLanguage = settingsStore.settings.mainLanguage;

    try {
      const [basicInfoList, characters, organizations, locations, lorebook, acts, chapters] = await Promise.all([
        unifiedStore.listObjects('basic_info', projectId),
        unifiedStore.listObjects('character', projectId),
        unifiedStore.listObjects('organization', projectId),
        unifiedStore.listObjects('location', projectId),
        unifiedStore.listObjects('lorebook', projectId),
        unifiedStore.listObjects('act', projectId),
        unifiedStore.listObjects('chapter', projectId),
      ]);

      // Build sorted chapters
      const sortedChapters = [...chapters].sort((a, b) => {
        const actOrderA = acts.find(act => act.id === a.metadata.act_id)?.metadata.order || 0;
        const actOrderB = acts.find(act => act.id === b.metadata.act_id)?.metadata.order || 0;
        if (actOrderA !== actOrderB) return actOrderA - actOrderB;
        return (a.metadata.order || 0) - (b.metadata.order || 0);
      });

      const available: AvailableContextObjects = {
        basicInfo: basicInfoList.length > 0 ? {
          id: basicInfoList[0].id,
          title: (basicInfoList[0].data[mainLanguage] || Object.values(basicInfoList[0].data)[0])?.title || 'Basic Info'
        } : null,
        characters: characters.map(c => ({
          id: c.id,
          name: (c.data[mainLanguage] || Object.values(c.data)[0])?.name || 'Unnamed'
        })),
        organizations: organizations.map(o => ({
          id: o.id,
          name: (o.data[mainLanguage] || Object.values(o.data)[0])?.name || 'Unnamed'
        })),
        locations: locations.map(l => ({
          id: l.id,
          name: (l.data[mainLanguage] || Object.values(l.data)[0])?.name || 'Unnamed'
        })),
        lorebook: lorebook.map(l => ({
          id: l.id,
          name: (l.data[mainLanguage] || Object.values(l.data)[0])?.name || 'Unnamed'
        })),
        outlines: [...acts]
          .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
          .map(act => ({
            id: act.id,
            name: (act.data[mainLanguage] || Object.values(act.data)[0])?.name || 'Unnamed Act',
            chapters: sortedChapters
              .filter(ch => ch.metadata.act_id === act.id)
              .map(ch => ({
                id: ch.id,
                name: (ch.data[mainLanguage] || Object.values(ch.data)[0])?.name || 'Unnamed'
              }))
          })),
      };

      setAvailableObjects(available);

      // Select all objects by default
      const allOutlineChapterIds = available.outlines.flatMap(act => act.chapters.map(ch => ch.id));
      setSelectedObjects({
        basicInfo: available.basicInfo !== null,
        characters: new Set(available.characters.map(c => c.id)),
        organizations: new Set(available.organizations.map(o => o.id)),
        locations: new Set(available.locations.map(l => l.id)),
        lorebook: new Set(available.lorebook.map(l => l.id)),
        outlineChapters: new Set(allOutlineChapterIds),
      });
    } catch (err) {
      console.error('Error loading available objects:', err);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, settingsStore.settings.mainLanguage, unifiedStore]);

  useEffect(() => {
    if (isOpen) {
      loadAvailableObjects();
    } else {
      setUserRequest('');
      setAvailableObjects(null);
    }
  }, [isOpen, loadAvailableObjects]);

  useEffect(() => {
    return () => {
      taskRef.current?.abort();
    };
  }, []);

  // Build ObjectPicker groups for story objects
  const storyObjectGroups = useMemo((): ObjectPickerGroup[] => {
    if (!availableObjects) return [];

    const groups: ObjectPickerGroup[] = [];

    if (availableObjects.characters.length > 0) {
      groups.push({
        id: 'characters',
        label: 'Characters',
        type: 'character',
        items: availableObjects.characters.map(c => ({
          id: `character:${c.id}`,
          name: c.name,
          type: 'character',
        })),
      });
    }

    if (availableObjects.organizations.length > 0) {
      groups.push({
        id: 'organizations',
        label: 'Organizations',
        type: 'organization',
        items: availableObjects.organizations.map(o => ({
          id: `organization:${o.id}`,
          name: o.name,
          type: 'organization',
        })),
      });
    }

    if (availableObjects.locations.length > 0) {
      groups.push({
        id: 'locations',
        label: 'Locations',
        type: 'location',
        items: availableObjects.locations.map(l => ({
          id: `location:${l.id}`,
          name: l.name,
          type: 'location',
        })),
      });
    }

    if (availableObjects.lorebook.length > 0) {
      groups.push({
        id: 'lorebook',
        label: 'Lorebook',
        type: 'lorebook',
        items: availableObjects.lorebook.map(l => ({
          id: `lorebook:${l.id}`,
          name: l.name,
          type: 'lorebook',
        })),
      });
    }

    return groups;
  }, [availableObjects]);

  // Build ObjectPicker groups for outlines
  const outlineGroups = useMemo((): ObjectPickerGroup[] => {
    if (!availableObjects || availableObjects.outlines.length === 0) return [];

    return availableObjects.outlines.map(act => ({
      id: `outline-act-${act.id}`,
      label: act.name,
      type: 'act' as any,
      items: act.chapters.map(ch => ({
        id: ch.id,
        name: ch.name,
        type: 'chapter' as any,
      })),
    }));
  }, [availableObjects]);

  // Convert selected story objects to ObjectPicker format (with prefixes)
  const selectedStoryObjectIds = useMemo((): string[] => {
    const ids: string[] = [];
    selectedObjects.characters.forEach(id => ids.push(`character:${id}`));
    selectedObjects.organizations.forEach(id => ids.push(`organization:${id}`));
    selectedObjects.locations.forEach(id => ids.push(`location:${id}`));
    selectedObjects.lorebook.forEach(id => ids.push(`lorebook:${id}`));
    return ids;
  }, [selectedObjects.characters, selectedObjects.organizations, selectedObjects.locations, selectedObjects.lorebook]);

  // Handle story objects selection change
  const handleStoryObjectsChange = useCallback((ids: string[] | string) => {
    const idArray = Array.isArray(ids) ? ids : [ids];

    const characters = new Set<string>();
    const organizations = new Set<string>();
    const locations = new Set<string>();
    const lorebook = new Set<string>();

    idArray.forEach(prefixedId => {
      const [category, id] = prefixedId.split(':');
      switch (category) {
        case 'character': characters.add(id); break;
        case 'organization': organizations.add(id); break;
        case 'location': locations.add(id); break;
        case 'lorebook': lorebook.add(id); break;
      }
    });

    setSelectedObjects(prev => ({
      ...prev,
      characters,
      organizations,
      locations,
      lorebook,
    }));
  }, []);

  // Handle outline chapters selection change
  const handleOutlineChaptersChange = useCallback((ids: string[] | string) => {
    const idArray = Array.isArray(ids) ? ids : [ids];
    setSelectedObjects(prev => ({
      ...prev,
      outlineChapters: new Set(idArray),
    }));
  }, []);

  // Build contextIds from selected objects
  const buildContextIds = useCallback((): string[] => {
    const ids: string[] = [];
    selectedObjects.characters.forEach(id => ids.push(id));
    selectedObjects.organizations.forEach(id => ids.push(id));
    selectedObjects.locations.forEach(id => ids.push(id));
    selectedObjects.lorebook.forEach(id => ids.push(id));
    selectedObjects.outlineChapters.forEach(id => ids.push(id));
    return ids;
  }, [selectedObjects]);

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

      // Apply edits using applyEditFunctionCalls for consistency
      try {
        const functionCalls: FunctionCallMetadata[] = parsedItems.map((item, index) => ({
          function_name: item.function || 'replace_story_object',
          arguments: JSON.stringify(item),
          id: `native-${index}`,
          isApplied: false,
        }));

        const results = await applyEditFunctionCalls(projectId, functionCalls);
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
        formState: { userRequest: userRequest.trim(), selectedObjects },
      },
    });

    onClose();

    try {
      const storyObjectEditConfig = settingsStore.getFunctionConfig('storyObjectEdit');
      const providerConfig = settingsStore.getProviderConfig(storyObjectEditConfig.provider);
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

        const promptContext: StoryObjectEditPromptContext = {
          userInput: effectiveUserInput,
          projectId,
          targetIds,
          contextIds: contextIds.length > 0 ? contextIds : undefined,
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
            disabled={!userRequest.trim() || isLoading}
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
              {isLoading ? (
                <div className="context-loading">Loading available objects...</div>
              ) : availableObjects ? (
                <div className="context-selector">
                  {/* Story Objects (Characters, Organizations, Locations, Lorebook) */}
                  {storyObjectGroups.length > 0 && (
                    <CollapsibleSection
                      label="Story Objects"
                      expanded={!collapsedSections.storyObjects}
                      onExpandChange={(expanded) => setCollapsedSections(prev => ({ ...prev, storyObjects: !expanded }))}
                      selectedCount={selectedStoryObjectIds.length}
                      totalCount={storyObjectGroups.reduce((sum, g) => sum + g.items.length, 0)}
                      onToggleAll={(selectAll) => {
                        const allIds = storyObjectGroups.flatMap(g => g.items.map(i => i.id));
                        handleStoryObjectsChange(selectAll ? allIds : []);
                      }}
                    >
                      <ObjectPicker
                        mode="story-objects"
                        selectionMode="multi"
                        selectedIds={selectedStoryObjectIds}
                        onChange={handleStoryObjectsChange}
                        projectId={projectId}
                        language={settingsStore.settings.mainLanguage}
                        customGroups={storyObjectGroups}
                        showSearch={false}
                        maxHeight="200px"
                        emptyMessage="No story objects available"
                      />
                    </CollapsibleSection>
                  )}

                  {/* Outlines (Chapter descriptions) */}
                  {outlineGroups.length > 0 && (
                    <CollapsibleSection
                      label="Outlines"
                      expanded={!collapsedSections.outlines}
                      onExpandChange={(expanded) => setCollapsedSections(prev => ({ ...prev, outlines: !expanded }))}
                      selectedCount={selectedObjects.outlineChapters.size}
                      totalCount={outlineGroups.reduce((sum, g) => sum + g.items.length, 0)}
                      onToggleAll={(selectAll) => {
                        const allIds = outlineGroups.flatMap(g => g.items.map(i => i.id));
                        handleOutlineChaptersChange(selectAll ? allIds : []);
                      }}
                    >
                      <ObjectPicker
                        mode="manuscript"
                        selectionMode="multi"
                        selectedIds={Array.from(selectedObjects.outlineChapters)}
                        onChange={handleOutlineChaptersChange}
                        projectId={projectId}
                        language={settingsStore.settings.mainLanguage}
                        customGroups={outlineGroups}
                        showSearch={false}
                        maxHeight="200px"
                        emptyMessage="No outlines available"
                      />
                    </CollapsibleSection>
                  )}
                </div>
              ) : (
                <div className="context-error">Failed to load objects</div>
              )}
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
