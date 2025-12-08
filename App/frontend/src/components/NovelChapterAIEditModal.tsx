import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { useLLMTaskStore } from '../store/llmTaskStore';
import type { FunctionCallMetadata } from '../llm/requestTypes';
import type { ManuscriptObject } from '../types/unifiedObject';
import { extractRawContent } from '../utils/nativeOutputParser';
import { useLLMToast } from '../hooks/useLLMToast';
import { LLMTask, LLMTaskMode, type ChapterEditPromptContext } from '../llm';

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
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedActs, setExpandedActs] = useState<Set<string>>(new Set());
  const [isContextExpanded, setIsContextExpanded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionId = `chapter-edit-${chapterId}`;

  const { startTask, completeSuccess, completeError, completeCancelled } = useLLMToast({
    sessionId,
    taskType: 'chapter-edit',
    label: `AI Edit: ${chapterName}`,
  });

  const session = useLLMTaskStore(useCallback((state) => state.sessions[sessionId], [sessionId]));
  const streamContent = useMemo(() => {
    if (!session?.contentParts?.length) return '';
    return session.contentParts.filter((p) => p.type === 'content').map((p) => p.text).join('');
  }, [session?.contentParts]);

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
      setError(null);
      setIsProcessing(false);
      setAvailableObjects(null);
    }
  }, [isOpen, loadAvailableObjects]);

  useEffect(() => {
    return () => {
      taskRef.current?.abort();
    };
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

  const handleFunctionCallResults = useCallback(
    async (functionCalls: FunctionCallMetadata[]) => {
      const updateCall = functionCalls.find((fc) => fc.function_name === 'update_manuscript');
      if (!updateCall) {
        const errorMsg = 'AI did not call update_manuscript function';
        setError(errorMsg);
        completeError(errorMsg);
        return;
      }

      try {
        const args = typeof updateCall.arguments === 'string' ? JSON.parse(updateCall.arguments) : updateCall.arguments;
        const manuscriptObj = unifiedStore.getManuscriptByChapterId(args.chapterId);
        if (!manuscriptObj) {
          const errorMsg = `Manuscript not found for chapter ${args.chapterId}`;
          setError(errorMsg);
          completeError(errorMsg);
          return;
        }

        const wordCount = args.content.trim().split(/\s+/).filter(Boolean).length;
        await unifiedStore.updateObject('manuscript', manuscriptObj.id, {
          data: { content: args.content, wordCount },
          language: settingsStore.settings.mainLanguage,
          create_new_version: true,
          user_request: 'AI Generated Content',
        });

        completeSuccess();
        onResult?.();
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to apply chapter content update';
        setError(errorMsg);
        completeError(errorMsg);
      }
    },
    [unifiedStore, settingsStore, completeSuccess, completeError, onResult]
  );

  const handleNativeOutput = useCallback(
    async (text: string) => {
      const cleanedContent = extractRawContent(text);
      const manuscriptObj = unifiedStore.getManuscriptByChapterId(chapterId);

      if (!manuscriptObj) {
        const errorMsg = `Manuscript not found for chapter ${chapterId}`;
        setError(errorMsg);
        completeError(errorMsg);
        return;
      }

      const wordCount = cleanedContent.trim().split(/\s+/).filter(Boolean).length;
      await unifiedStore.updateObject('manuscript', manuscriptObj.id, {
        data: { content: cleanedContent, wordCount },
        language: settingsStore.settings.mainLanguage,
        create_new_version: true,
        user_request: 'AI Generated Content',
      });

      completeSuccess();
      onResult?.();
    },
    [chapterId, unifiedStore, settingsStore, completeSuccess, completeError, onResult]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRequest.trim() || isProcessing) return;

    setIsProcessing(true);
    setError(null);

    startTask({
      taskType: 'chapter-edit',
      modalProps: { projectId, chapterId, chapterName, onResult },
      formState: { userRequest, selectedObjects },
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
          sessionId,
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
                await handleNativeOutput(text.trim());
              } else {
                const errorMsg = 'AI did not generate any content.';
                setError(errorMsg);
                completeError(errorMsg);
              }
            } else {
              await handleFunctionCallResults(result.functionCalls);
            }
          },
          onError: (err) => {
            if (err.name === 'AbortError') {
              completeCancelled();
            } else {
              setError(err.message);
              completeError(err.message);
            }
          },
        }
      );

      await taskRef.current.run();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        completeCancelled();
        return;
      }
      const errorMsg = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(errorMsg);
      completeError(errorMsg);
    } finally {
      setIsProcessing(false);
      taskRef.current = null;
    }
  };

  // Toggle individual object selection
  const toggleObjectSelection = (category: keyof Omit<SelectedContextObjects, 'basicInfo'>, id: string) => {
    setSelectedObjects(prev => {
      const newSet = new Set(prev[category]);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return { ...prev, [category]: newSet };
    });
  };

  // Select all objects in a category
  const selectAllInCategory = (category: keyof Omit<SelectedContextObjects, 'basicInfo'>) => {
    if (!availableObjects) return;
    if (category === 'outlineChapters') {
      const allChapterIds = availableObjects.outlines.flatMap(act => act.chapters.map(ch => ch.id));
      setSelectedObjects(prev => ({ ...prev, outlineChapters: new Set(allChapterIds) }));
      return;
    }
    if (category === 'novelContentChapters') {
      const allChapterIds = availableObjects.novelContent.flatMap(act => act.chapters.map(ch => ch.id));
      setSelectedObjects(prev => ({ ...prev, novelContentChapters: new Set(allChapterIds) }));
      return;
    }
    const categoryMap: Record<string, Array<{ id: string }>> = {
      characters: availableObjects.characters,
      organizations: availableObjects.organizations,
      locations: availableObjects.locations,
      lorebook: availableObjects.lorebook,
    };
    const items = categoryMap[category] || [];
    setSelectedObjects(prev => ({
      ...prev,
      [category]: new Set(items.map(item => item.id))
    }));
  };

  // Deselect all objects in a category
  const deselectAllInCategory = (category: keyof Omit<SelectedContextObjects, 'basicInfo'>) => {
    setSelectedObjects(prev => ({
      ...prev,
      [category]: new Set<string>()
    }));
  };

  // Toggle category expansion
  const toggleCategoryExpansion = (category: string) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  };

  // Toggle act expansion
  const toggleActExpansion = (actId: string) => {
    setExpandedActs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(actId)) {
        newSet.delete(actId);
      } else {
        newSet.add(actId);
      }
      return newSet;
    });
  };

  // Render category section
  const renderCategorySection = (
    category: keyof Omit<SelectedContextObjects, 'basicInfo'>,
    title: string,
    items: Array<{ id: string; name: string; [key: string]: any }>
  ) => {
    if (items.length === 0) return null;

    const selectedCount = selectedObjects[category].size;
    const totalCount = items.length;
    const isExpanded = expandedCategories.has(category);

    return (
      <div className="context-category" key={category}>
        <div
          className="context-category-header"
          onClick={() => toggleCategoryExpansion(category)}
        >
          <span className={`context-category-toggle ${isExpanded ? 'expanded' : ''}`}>
            {isExpanded ? '▼' : '▶'}
          </span>
          <span className="context-category-title">{title}</span>
          <span className="context-category-count">({selectedCount}/{totalCount})</span>
          <div className="context-category-actions" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className="context-action-btn"
              onClick={() => selectAllInCategory(category)}
              disabled={isProcessing}
            >
              All
            </button>
            <button
              type="button"
              className="context-action-btn"
              onClick={() => deselectAllInCategory(category)}
              disabled={isProcessing}
            >
              None
            </button>
          </div>
        </div>
        {isExpanded && (
          <div className="context-object-list">
            {items.map(item => (
              <label key={item.id} className={`context-object-item ${item.isCurrent ? 'current-chapter' : ''}`}>
                <input
                  type="checkbox"
                  checked={selectedObjects[category].has(item.id)}
                  onChange={() => toggleObjectSelection(category, item.id)}
                  disabled={isProcessing}
                />
                <span className="context-object-name">
                  {item.name}
                  {item.actName && <span className="context-object-meta"> ({item.actName})</span>}
                  {item.wordCount !== undefined && <span className="context-object-meta"> ({item.wordCount.toLocaleString()} words)</span>}
                  {item.isCurrent && <span className="context-object-badge">current</span>}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Select/deselect all chapters in an act
  const selectAllInAct = (actId: string) => {
    if (!availableObjects) return;
    const act = availableObjects.outlines.find(a => a.id === actId);
    if (!act) return;
    setSelectedObjects(prev => {
      const newSet = new Set(prev.outlineChapters);
      act.chapters.forEach(ch => newSet.add(ch.id));
      return { ...prev, outlineChapters: newSet };
    });
  };

  const deselectAllInAct = (actId: string) => {
    if (!availableObjects) return;
    const act = availableObjects.outlines.find(a => a.id === actId);
    if (!act) return;
    setSelectedObjects(prev => {
      const newSet = new Set(prev.outlineChapters);
      act.chapters.forEach(ch => newSet.delete(ch.id));
      return { ...prev, outlineChapters: newSet };
    });
  };

  // Render outlines section with acts
  const renderOutlinesSection = () => {
    if (!availableObjects || availableObjects.outlines.length === 0) return null;

    const allChapters = availableObjects.outlines.flatMap(act => act.chapters);
    const totalCount = allChapters.length;
    const selectedCount = allChapters.filter(ch => selectedObjects.outlineChapters.has(ch.id)).length;
    const isExpanded = expandedCategories.has('outlineChapters');

    return (
      <div className="context-category">
        <div
          className="context-category-header"
          onClick={() => toggleCategoryExpansion('outlineChapters')}
        >
          <span className={`context-category-toggle ${isExpanded ? 'expanded' : ''}`}>
            {isExpanded ? '▼' : '▶'}
          </span>
          <span className="context-category-title">Outlines</span>
          <span className="context-category-count">({selectedCount}/{totalCount})</span>
          <div className="context-category-actions" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className="context-action-btn"
              onClick={() => selectAllInCategory('outlineChapters')}
              disabled={isProcessing}
            >
              All
            </button>
            <button
              type="button"
              className="context-action-btn"
              onClick={() => deselectAllInCategory('outlineChapters')}
              disabled={isProcessing}
            >
              None
            </button>
          </div>
        </div>
        {isExpanded && (
          <div className="context-outlines-content">
            {availableObjects.outlines.map(act => {
              const actSelectedCount = act.chapters.filter(ch => selectedObjects.outlineChapters.has(ch.id)).length;
              const isActExpanded = expandedActs.has(act.id);
              return (
                <div key={act.id} className="context-act-section">
                  <div className="context-act-header" onClick={() => toggleActExpansion(act.id)}>
                    <span className={`context-act-toggle ${isActExpanded ? 'expanded' : ''}`}>
                      {isActExpanded ? '▼' : '▶'}
                    </span>
                    <span className="context-act-title">{act.name}</span>
                    <span className="context-act-count">({actSelectedCount}/{act.chapters.length})</span>
                    <div className="context-act-actions" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        className="context-action-btn"
                        onClick={() => selectAllInAct(act.id)}
                        disabled={isProcessing}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className="context-action-btn"
                        onClick={() => deselectAllInAct(act.id)}
                        disabled={isProcessing}
                      >
                        None
                      </button>
                    </div>
                  </div>
                  {isActExpanded && (
                    <div className="context-object-list">
                      {act.chapters.map(chapter => (
                        <label key={chapter.id} className="context-object-item">
                          <input
                            type="checkbox"
                            checked={selectedObjects.outlineChapters.has(chapter.id)}
                            onChange={() => toggleObjectSelection('outlineChapters', chapter.id)}
                            disabled={isProcessing}
                          />
                          <span className="context-object-name">{chapter.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // Select/deselect all chapters in a novel content act
  const selectAllInNovelContentAct = (actId: string) => {
    if (!availableObjects) return;
    const act = availableObjects.novelContent.find(a => a.id === actId);
    if (!act) return;
    setSelectedObjects(prev => {
      const newSet = new Set(prev.novelContentChapters);
      act.chapters.forEach(ch => newSet.add(ch.id));
      return { ...prev, novelContentChapters: newSet };
    });
  };

  const deselectAllInNovelContentAct = (actId: string) => {
    if (!availableObjects) return;
    const act = availableObjects.novelContent.find(a => a.id === actId);
    if (!act) return;
    setSelectedObjects(prev => {
      const newSet = new Set(prev.novelContentChapters);
      act.chapters.forEach(ch => newSet.delete(ch.id));
      return { ...prev, novelContentChapters: newSet };
    });
  };

  // Render novel content section with acts
  const renderNovelContentSection = () => {
    if (!availableObjects || availableObjects.novelContent.length === 0) return null;

    const allChapters = availableObjects.novelContent.flatMap(act => act.chapters);
    const totalCount = allChapters.length;
    const selectedCount = allChapters.filter(ch => selectedObjects.novelContentChapters.has(ch.id)).length;
    const isExpanded = expandedCategories.has('novelContentChapters');

    return (
      <div className="context-category">
        <div
          className="context-category-header"
          onClick={() => toggleCategoryExpansion('novelContentChapters')}
        >
          <span className={`context-category-toggle ${isExpanded ? 'expanded' : ''}`}>
            {isExpanded ? '▼' : '▶'}
          </span>
          <span className="context-category-title">Novel Content</span>
          <span className="context-category-count">({selectedCount}/{totalCount})</span>
          <div className="context-category-actions" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className="context-action-btn"
              onClick={() => selectAllInCategory('novelContentChapters')}
              disabled={isProcessing}
            >
              All
            </button>
            <button
              type="button"
              className="context-action-btn"
              onClick={() => deselectAllInCategory('novelContentChapters')}
              disabled={isProcessing}
            >
              None
            </button>
          </div>
        </div>
        {isExpanded && (
          <div className="context-outlines-content">
            {availableObjects.novelContent.map(act => {
              const actSelectedCount = act.chapters.filter(ch => selectedObjects.novelContentChapters.has(ch.id)).length;
              const isActExpanded = expandedActs.has(`novel-${act.id}`);
              return (
                <div key={act.id} className="context-act-section">
                  <div className="context-act-header" onClick={() => toggleActExpansion(`novel-${act.id}`)}>
                    <span className={`context-act-toggle ${isActExpanded ? 'expanded' : ''}`}>
                      {isActExpanded ? '▼' : '▶'}
                    </span>
                    <span className="context-act-title">{act.name}</span>
                    <span className="context-act-count">({actSelectedCount}/{act.chapters.length})</span>
                    <div className="context-act-actions" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        className="context-action-btn"
                        onClick={() => selectAllInNovelContentAct(act.id)}
                        disabled={isProcessing}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className="context-action-btn"
                        onClick={() => deselectAllInNovelContentAct(act.id)}
                        disabled={isProcessing}
                      >
                        None
                      </button>
                    </div>
                  </div>
                  {isActExpanded && (
                    <div className="context-object-list">
                      {act.chapters.map(chapter => (
                        <label key={chapter.id} className={`context-object-item ${chapter.isCurrent ? 'current-chapter' : ''}`}>
                          <input
                            type="checkbox"
                            checked={selectedObjects.novelContentChapters.has(chapter.id)}
                            onChange={() => toggleObjectSelection('novelContentChapters', chapter.id)}
                            disabled={isProcessing}
                          />
                          <span className="context-object-name">
                            {chapter.name}
                            <span className="context-object-meta"> ({chapter.wordCount.toLocaleString()} words)</span>
                            {chapter.isCurrent && <span className="context-object-badge">current</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
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
              disabled={isProcessing}
            />
          </div>

          <div className="form-group context-options">
            <div
              className="context-options-header"
              onClick={() => setIsContextExpanded(!isContextExpanded)}
            >
              <span className={`context-options-toggle ${isContextExpanded ? 'expanded' : ''}`}>
                {isContextExpanded ? '▼' : '▶'}
              </span>
              <label>Context Inclusion Options</label>
            </div>
            {isContextExpanded && (
              <>
                {isLoading ? (
                  <div className="context-loading">Loading available objects...</div>
                ) : availableObjects ? (
                  <div className="context-selector">
                    {/* Basic Info - simple checkbox */}
                    {availableObjects.basicInfo && (
                      <label className="context-basic-info">
                        <input
                          type="checkbox"
                          checked={selectedObjects.basicInfo}
                          onChange={() => setSelectedObjects(prev => ({ ...prev, basicInfo: !prev.basicInfo }))}
                          disabled={isProcessing}
                        />
                        <span>Basic Info ({availableObjects.basicInfo.title})</span>
                      </label>
                    )}

                    {/* Object categories */}
                    {renderCategorySection('characters', 'Characters', availableObjects.characters)}
                    {renderCategorySection('organizations', 'Organizations', availableObjects.organizations)}
                    {renderCategorySection('locations', 'Locations', availableObjects.locations)}
                    {renderCategorySection('lorebook', 'Lorebook', availableObjects.lorebook)}
                    {renderOutlinesSection()}
                    {renderNovelContentSection()}
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

          {error && <div className="error-message">{error}</div>}

          {streamContent && (
            <div className="ai-response">
              <h3>AI Response:</h3>
              <div className="response-content novel-content-preview">{streamContent}</div>
            </div>
          )}

          <div className="form-actions">
            <button type="button" onClick={onClose} className="cancel-button">Cancel</button>
            <button type="submit" className="submit-button" disabled={!userRequest.trim() || isProcessing || isLoading}>
              {isProcessing ? 'AI Processing...' : 'Request AI Edit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default NovelChapterAIEditModal;
