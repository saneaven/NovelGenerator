import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useModalHistory } from '../hooks/useModalHistory';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import type { FunctionCallMetadata } from '../llm/requestTypes';
import type { ManuscriptObject } from '../types/unifiedObject';
import { extractRawContent } from '../utils/nativeOutputParser';
import { LLMTask, LLMTaskMode, LLMTaskManager, type ChapterEditPromptContext, type TaskHandle } from '../llm';
import { Expand, Collapse } from './icons';
import { ObjectPicker } from './ObjectPicker';
import CollapsibleSection from './ui/CollapsibleSection';
import type { ObjectPickerGroup } from './ObjectPicker/types';

// Available objects fetched on modal open
interface OutlineAct {
  id: string;
  name: string;
  chapters: Array<{ id: string; name: string }>;
}

interface NovelContentAct {
  id: string;
  name: string;
  chapters: Array<{ id: string; name: string; wordCount: number; isCurrent: boolean }>;
}

interface AvailableContextObjects {
  basicInfo: { id: string; title: string } | null;
  characters: Array<{ id: string; name: string }>;
  organizations: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  lorebook: Array<{ id: string; name: string }>;
  outlines: Array<OutlineAct>;
  novelContent: Array<NovelContentAct>;
}

// User's selection state
interface SelectedContextObjects {
  basicInfo: boolean;
  characters: Set<string>;
  organizations: Set<string>;
  locations: Set<string>;
  lorebook: Set<string>;
  outlineChapters: Set<string>;
  novelContentChapters: Set<string>;
}

interface NovelChapterAIEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  chapterId: string;
  chapterName: string;
  onResult?: () => void;
  defaultUserRequest?: string;
}

const NovelChapterAIEditModal: React.FC<NovelChapterAIEditModalProps> = ({
  isOpen,
  onClose,
  projectId,
  chapterId,
  chapterName,
  onResult,
  defaultUserRequest,
}) => {
  useModalHistory(isOpen, onClose);
  const [userRequest, setUserRequest] = useState(defaultUserRequest || '');
  const [availableObjects, setAvailableObjects] = useState<AvailableContextObjects | null>(null);
  const [selectedObjects, setSelectedObjects] = useState<SelectedContextObjects>({
    basicInfo: true,
    characters: new Set<string>(),
    organizations: new Set<string>(),
    locations: new Set<string>(),
    lorebook: new Set<string>(),
    outlineChapters: new Set<string>(),
    novelContentChapters: new Set<string>(),
  });
  const [isContextExpanded, setIsContextExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Section collapse state
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    storyObjects: true,
    outlines: true,
    novelContent: true,
  });

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

  // Load available objects when modal opens
  const loadAvailableObjects = useCallback(async () => {
    setIsLoading(true);
    const mainLanguage = settingsStore.settings.mainLanguage;

    try {
      const [basicInfoList, characters, organizations, locations, lorebook, acts, chapters, manuscripts] = await Promise.all([
        unifiedStore.listObjects('basic_info', projectId),
        unifiedStore.listObjects('character', projectId),
        unifiedStore.listObjects('organization', projectId),
        unifiedStore.listObjects('location', projectId),
        unifiedStore.listObjects('lorebook', projectId),
        unifiedStore.listObjects('act', projectId),
        unifiedStore.listObjects('chapter', projectId),
        unifiedStore.listObjects('manuscript', projectId),
      ]);

      // Build act order map
      const actOrderMap = new Map(acts.map(a => [a.id, { order: a.metadata.order || 0, name: (a.data[mainLanguage] || Object.values(a.data)[0])?.name || '' }]));

      // Build chapter order map and sorted chapters
      const sortedChapters = [...chapters].sort((a, b) => {
        const actOrderA = actOrderMap.get(a.metadata.act_id as string)?.order || 0;
        const actOrderB = actOrderMap.get(b.metadata.act_id as string)?.order || 0;
        if (actOrderA !== actOrderB) return actOrderA - actOrderB;
        return (a.metadata.order || 0) - (b.metadata.order || 0);
      });

      // Build manuscript map (chapterId -> manuscript)
      const manuscriptMap = new Map(manuscripts.map(m => [m.metadata.chapter_id as string, m]));

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
        novelContent: [...acts]
          .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
          .map(act => ({
            id: act.id,
            name: (act.data[mainLanguage] || Object.values(act.data)[0])?.name || 'Unnamed Act',
            chapters: sortedChapters
              .filter(ch => ch.metadata.act_id === act.id)
              .map(ch => {
                const manuscript = manuscriptMap.get(ch.id);
                const manuscriptLangData = manuscript ? (manuscript.data[mainLanguage] || Object.values(manuscript.data)[0]) : null;
                return {
                  id: ch.id,
                  name: (ch.data[mainLanguage] || Object.values(ch.data)[0])?.name || 'Unnamed',
                  wordCount: manuscriptLangData?.wordCount ?? 0,
                  isCurrent: ch.id === chapterId
                };
              })
          }))
      };

      setAvailableObjects(available);

      // Select all objects by default
      const allOutlineChapterIds = available.outlines.flatMap(act => act.chapters.map(ch => ch.id));
      const allNovelContentChapterIds = available.novelContent.flatMap(act => act.chapters.map(ch => ch.id));
      setSelectedObjects({
        basicInfo: available.basicInfo !== null,
        characters: new Set(available.characters.map(c => c.id)),
        organizations: new Set(available.organizations.map(o => o.id)),
        locations: new Set(available.locations.map(l => l.id)),
        lorebook: new Set(available.lorebook.map(l => l.id)),
        outlineChapters: new Set(allOutlineChapterIds),
        novelContentChapters: new Set(allNovelContentChapterIds),
      });
    } catch (err) {
      console.error('Error loading available objects:', err);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, chapterId, settingsStore.settings.mainLanguage, unifiedStore]);

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

    // Basic Info as first group
    if (availableObjects.basicInfo) {
      groups.push({
        id: 'basic_info',
        label: 'Basic Info',
        type: 'basic_info',
        items: [{
          id: 'basic_info:main',
          name: availableObjects.basicInfo.title,
          type: 'basic_info',
        }],
      });
    }

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

  // Build ObjectPicker groups for novel content
  const novelContentGroups = useMemo((): ObjectPickerGroup[] => {
    if (!availableObjects || availableObjects.novelContent.length === 0) return [];

    return availableObjects.novelContent.map(act => ({
      id: `novel-act-${act.id}`,
      label: act.name,
      type: 'act' as any,
      items: act.chapters.map(ch => ({
        id: ch.id,
        name: ch.name,
        type: 'manuscript' as any,
        wordCount: ch.wordCount,
      })),
    }));
  }, [availableObjects]);

  // Convert selected story objects to ObjectPicker format (with prefixes)
  const selectedStoryObjectIds = useMemo((): string[] => {
    const ids: string[] = [];
    if (selectedObjects.basicInfo) ids.push('basic_info:main');
    selectedObjects.characters.forEach(id => ids.push(`character:${id}`));
    selectedObjects.organizations.forEach(id => ids.push(`organization:${id}`));
    selectedObjects.locations.forEach(id => ids.push(`location:${id}`));
    selectedObjects.lorebook.forEach(id => ids.push(`lorebook:${id}`));
    return ids;
  }, [selectedObjects.basicInfo, selectedObjects.characters, selectedObjects.organizations, selectedObjects.locations, selectedObjects.lorebook]);

  // Handle story objects selection change
  const handleStoryObjectsChange = useCallback((ids: string[] | string) => {
    const idArray = Array.isArray(ids) ? ids : [ids];

    let basicInfo = false;
    const characters = new Set<string>();
    const organizations = new Set<string>();
    const locations = new Set<string>();
    const lorebook = new Set<string>();

    idArray.forEach(prefixedId => {
      const [category, id] = prefixedId.split(':');
      switch (category) {
        case 'basic_info': basicInfo = true; break;
        case 'character': characters.add(id); break;
        case 'organization': organizations.add(id); break;
        case 'location': locations.add(id); break;
        case 'lorebook': lorebook.add(id); break;
      }
    });

    setSelectedObjects(prev => ({
      ...prev,
      basicInfo,
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

  // Handle novel content chapters selection change
  const handleNovelContentChaptersChange = useCallback((ids: string[] | string) => {
    const idArray = Array.isArray(ids) ? ids : [ids];
    setSelectedObjects(prev => ({
      ...prev,
      novelContentChapters: new Set(idArray),
    }));
  }, []);

  const generateNovelContext = async (): Promise<Record<string, any>> => {
    const context: Record<string, any> = {};
    const mainLanguage = settingsStore.settings.mainLanguage;

    try {
      if (selectedObjects.basicInfo) {
        const basicInfoList = await unifiedStore.listObjects('basic_info', projectId);
        if (basicInfoList.length > 0) {
          const langData = basicInfoList[0].data[mainLanguage] || Object.values(basicInfoList[0].data)[0];
          context.basicInfo = { title: langData?.title || '', logline: langData?.logline || '', genre: langData?.genre || '' };
        }
      }

      if (selectedObjects.characters.size > 0) {
        const characters = await unifiedStore.listObjects('character', projectId);
        context.characters = characters
          .filter(char => selectedObjects.characters.has(char.id))
          .map(char => {
            const langData = char.data[mainLanguage] || Object.values(char.data)[0];
            return { id: char.id, name: langData?.name || '', description: langData?.description || '' };
          });
      }

      if (selectedObjects.organizations.size > 0) {
        const organizations = await unifiedStore.listObjects('organization', projectId);
        context.organizations = organizations
          .filter(org => selectedObjects.organizations.has(org.id))
          .map(org => {
            const langData = org.data[mainLanguage] || Object.values(org.data)[0];
            return { id: org.id, name: langData?.name || '', description: langData?.description || '' };
          });
      }

      if (selectedObjects.locations.size > 0) {
        const locations = await unifiedStore.listObjects('location', projectId);
        context.locations = locations
          .filter(loc => selectedObjects.locations.has(loc.id))
          .map(loc => {
            const langData = loc.data[mainLanguage] || Object.values(loc.data)[0];
            return { id: loc.id, name: langData?.name || '', description: langData?.description || '' };
          });
      }

      if (selectedObjects.lorebook.size > 0) {
        const lorebook = await unifiedStore.listObjects('lorebook', projectId);
        context.lorebook = lorebook
          .filter(entry => selectedObjects.lorebook.has(entry.id))
          .map(entry => {
            const langData = entry.data[mainLanguage] || Object.values(entry.data)[0];
            return { id: entry.id, name: langData?.name || '', description: langData?.description || '' };
          });
      }

      if (selectedObjects.outlineChapters.size > 0) {
        const acts = await unifiedStore.listObjects('act', projectId);
        const chapters = await unifiedStore.listObjects('chapter', projectId);

        // Filter chapters by selection
        const selectedChapters = chapters.filter(ch => selectedObjects.outlineChapters.has(ch.id));
        const relevantActIds = new Set(selectedChapters.map(ch => ch.metadata.act_id as string));

        context.outline = {
          acts: acts
            .filter(act => relevantActIds.has(act.id))
            .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
            .map(act => {
              const actLangData = act.data[mainLanguage] || Object.values(act.data)[0];
              return {
                id: act.id,
                name: actLangData?.name || '',
                description: actLangData?.description || '',
                chapters: selectedChapters
                  .filter(ch => ch.metadata.act_id === act.id)
                  .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
                  .map(chapter => {
                    const chapterLangData = chapter.data[mainLanguage] || Object.values(chapter.data)[0];
                    return { id: chapter.id, name: chapterLangData?.name || '', description: chapterLangData?.description || '' };
                  }),
              };
            }),
        };
      }

      if (selectedObjects.novelContentChapters.size > 0) {
        const allManuscripts = await unifiedStore.listObjects('manuscript', projectId);
        const allChapters = await unifiedStore.listObjects('chapter', projectId);
        const acts = await unifiedStore.listObjects('act', projectId);

        // Build order map for sorting
        const actOrderMap = new Map(acts.map(a => [a.id, a.metadata.order || 0]));
        const chapterOrderMap = new Map<string, { actOrder: number; order: number }>();
        allChapters.forEach(ch => {
          chapterOrderMap.set(ch.id, {
            actOrder: actOrderMap.get(ch.metadata.act_id as string) || 0,
            order: ch.metadata.order || 0
          });
        });

        const novelContentArray: Array<{
          chapterId: string;
          chapterName: string;
          chapterDescription: string;
          content: string;
          wordCount: number;
        }> = [];

        const chapterMap = new Map(allChapters.map(ch => [ch.id, ch]));
        allManuscripts.forEach((manuscriptObj) => {
          const contentChapterId = manuscriptObj.metadata?.chapter_id as string | undefined;
          if (!contentChapterId) return;

          // Only include selected chapters
          if (!selectedObjects.novelContentChapters.has(contentChapterId)) return;

          const chapterInfo = chapterMap.get(contentChapterId);

          if (chapterInfo) {
            const chapterLangData = chapterInfo.data[mainLanguage] || Object.values(chapterInfo.data)[0];
            const manuscriptLangData = manuscriptObj.data[mainLanguage] || Object.values(manuscriptObj.data)[0];

            novelContentArray.push({
              chapterId: contentChapterId,
              chapterName: chapterLangData?.name || '',
              chapterDescription: chapterLangData?.description || '',
              content: manuscriptLangData?.content || '',
              wordCount: manuscriptLangData?.wordCount ?? 0,
            });
          }
        });

        // Sort by act order, then chapter order
        novelContentArray.sort((a, b) => {
          const orderA = chapterOrderMap.get(a.chapterId);
          const orderB = chapterOrderMap.get(b.chapterId);
          if (!orderA || !orderB) return 0;
          if (orderA.actOrder !== orderB.actOrder) return orderA.actOrder - orderB.actOrder;
          return orderA.order - orderB.order;
        });
        if (novelContentArray.length > 0) {
          context.existingNovelContent = novelContentArray;
        }
      }
    } catch (err) {
      console.error('Error generating novel context:', err);
    }

    return context;
  };

  // These handlers now accept a task handle for proper completion tracking
  const handleFunctionCallResults = useCallback(
    async (functionCalls: FunctionCallMetadata[], task: TaskHandle) => {
      const updateCall = functionCalls.find((fc) => fc.function_name === 'update_manuscript');
      if (!updateCall) {
        task.error('AI did not call update_manuscript function');
        return;
      }

      try {
        const args = typeof updateCall.arguments === 'string' ? JSON.parse(updateCall.arguments) : updateCall.arguments;
        const manuscriptObj = unifiedStore.getManuscriptByChapterId(args.chapterId);
        if (!manuscriptObj) {
          task.error(`Manuscript not found for chapter ${args.chapterId}`);
          return;
        }

        const wordCount = args.content.trim().split(/\s+/).filter(Boolean).length;
        await unifiedStore.updateObject('manuscript', manuscriptObj.id, {
          data: { content: args.content, wordCount },
          language: settingsStore.settings.mainLanguage,
          create_new_version: true,
          user_request: 'AI Generated Content',
        });

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
      const cleanedContent = extractRawContent(text);
      const manuscriptObj = unifiedStore.getManuscriptByChapterId(chapterId);

      if (!manuscriptObj) {
        task.error(`Manuscript not found for chapter ${chapterId}`);
        return;
      }

      const wordCount = cleanedContent.trim().split(/\s+/).filter(Boolean).length;
      await unifiedStore.updateObject('manuscript', manuscriptObj.id, {
        data: { content: cleanedContent, wordCount },
        language: settingsStore.settings.mainLanguage,
        create_new_version: true,
        user_request: 'AI Generated Content',
      });

      task.complete();
      onResult?.();
    },
    [chapterId, unifiedStore, settingsStore, onResult]
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
        formState: { userRequest, selectedObjects },
      },
    });

    onClose();

    try {
      const chapterGenConfig = settingsStore.getFunctionConfig('chapterGen');
      const providerConfig = settingsStore.getProviderConfig(chapterGenConfig.provider);
      const isNativeOutput = settingsStore.settings.nativeOutputMode;

      const currentContent = getActiveLanguageContent(chapterId);
      const contextData = await generateNovelContext();

      const promptContext: ChapterEditPromptContext = {
        userInput: userRequest.trim(),
        chapterName,
        currentContent,
        contextData,
        isNativeOutput,
        outputLanguage: settingsStore.settings.mainLanguage,
        enablePrefill: chapterGenConfig.advanced.enablePrefill,
        enableThinking: chapterGenConfig.advanced.thinkingMode === 'model',
        enableCustomThinking: chapterGenConfig.advanced.thinkingMode === 'custom',
      };

      taskRef.current = new LLMTask(
        {
          mode: LLMTaskMode.CHAPTER_EDIT,
          projectId,
          promptContext,
          abortControllerRef,
          sessionId: task.sessionId,
          provider: chapterGenConfig.provider,
          providerConfig,
          model: chapterGenConfig.model,
          temperature: chapterGenConfig.temperature,
          thinkingMode: chapterGenConfig.advanced.thinkingMode as any,
          thinkingConfig: chapterGenConfig.advanced.thinkingConfig,
          retryConfig: settingsStore.settings.retryConfig,
        },
        {
          onUpdate: () => {},
          onComplete: async (result) => {
            if (isNativeOutput) {
              const text = result.contentParts.filter(part => part.type === 'content').map(part => part.text).join('');
              if (text.trim()) {
                await handleNativeOutput(text.trim(), task);
              } else {
                task.error('AI did not generate any content.');
              }
            } else {
              await handleFunctionCallResults(result.functionCalls, task);
            }
          },
          onError: (err) => {
            if (err.name === 'AbortError') {
              task.cancel();
            } else {
              task.error(err.message);
            }
          },
        }
      );

      await taskRef.current.run();
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

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content ai-edit-modal novel-chapter-ai-edit-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>AI Chapter Edit</h2>
          <div className="chapter-info">
            <span className="chapter-name">{chapterName}</span>
          </div>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>

        <form onSubmit={handleSubmit} className="ai-edit-form">
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
                {isContextExpanded ? <Collapse size={10} /> : <Expand size={10} />}
              </span>
              <label>Context Inclusion Options</label>
            </div>
            {isContextExpanded && (
              <>
                {isLoading ? (
                  <div className="context-loading">Loading available objects...</div>
                ) : availableObjects ? (
                  <div className="context-selector">
                    {/* Story Objects (Basic Info, Characters, Organizations, Locations, Lorebook) */}
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

                    {/* Novel Content (Manuscript content) */}
                    {novelContentGroups.length > 0 && (
                      <CollapsibleSection
                        label="Novel Content"
                        expanded={!collapsedSections.novelContent}
                        onExpandChange={(expanded) => setCollapsedSections(prev => ({ ...prev, novelContent: !expanded }))}
                        selectedCount={selectedObjects.novelContentChapters.size}
                        totalCount={novelContentGroups.reduce((sum, g) => sum + g.items.length, 0)}
                        onToggleAll={(selectAll) => {
                          const allIds = novelContentGroups.flatMap(g => g.items.map(i => i.id));
                          handleNovelContentChaptersChange(selectAll ? allIds : []);
                        }}
                      >
                        <ObjectPicker
                          mode="manuscript"
                          selectionMode="multi"
                          selectedIds={Array.from(selectedObjects.novelContentChapters)}
                          onChange={handleNovelContentChaptersChange}
                          projectId={projectId}
                          language={settingsStore.settings.mainLanguage}
                          customGroups={novelContentGroups}
                          highlightIds={[chapterId]}
                          showSearch={false}
                          maxHeight="200px"
                          emptyMessage="No novel content available"
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

          <div className="form-actions">
            <button type="button" onClick={onClose} className="cancel-button">Cancel</button>
            <button type="submit" className="submit-button" disabled={!userRequest.trim() || isLoading}>
              Request AI Edit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default NovelChapterAIEditModal;
