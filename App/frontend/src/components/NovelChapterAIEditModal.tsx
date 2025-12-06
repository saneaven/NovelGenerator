import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { useLLMTaskStore } from '../store/llmTaskStore';
import type { FunctionCallMetadata } from '../llm/requestTypes';
import type { ManuscriptObject } from '../types/unifiedObject';
import { extractRawContent } from '../utils/nativeOutputParser';
import { useLLMToast } from '../hooks/useLLMToast';
import { LLMTask, LLMTaskMode, type ChapterEditPromptContext } from '../llm';

interface NovelContextOptions {
  basicInfo: boolean;
  characters: boolean;
  organizations: boolean;
  locations: boolean;
  lorebook: boolean;
  outline: boolean;
  allNovelContent: boolean;
}

interface NovelChapterAIEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  chapterId: string;
  chapterName: string;
  onResult?: () => void;
  defaultUserRequest?: string;
  defaultContextOptions?: NovelContextOptions;
}

const NovelChapterAIEditModal: React.FC<NovelChapterAIEditModalProps> = ({
  isOpen,
  onClose,
  projectId,
  chapterId,
  chapterName,
  onResult,
  defaultUserRequest,
  defaultContextOptions,
}) => {
  const [userRequest, setUserRequest] = useState(defaultUserRequest || '');
  const [contextOptions, setContextOptions] = useState<NovelContextOptions>(
    defaultContextOptions || {
      basicInfo: true,
      characters: true,
      organizations: true,
      locations: true,
      lorebook: true,
      outline: true,
      allNovelContent: true,
    }
  );
  const [isProcessing, setIsProcessing] = useState(false);
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

  useEffect(() => {
    if (!isOpen) {
      setUserRequest('');
      setError(null);
      setIsProcessing(false);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      taskRef.current?.abort();
    };
  }, []);

  const generateNovelContext = async (): Promise<Record<string, any>> => {
    const context: Record<string, any> = {};
    const mainLanguage = settingsStore.settings.mainLanguage;

    try {
      if (contextOptions.basicInfo) {
        const basicInfoList = await unifiedStore.listObjects('basic_info', projectId);
        if (basicInfoList.length > 0) {
          const langData = basicInfoList[0].data[mainLanguage] || Object.values(basicInfoList[0].data)[0];
          context.basicInfo = { title: langData?.title || '', logline: langData?.logline || '', genre: langData?.genre || '' };
        }
      }

      if (contextOptions.characters) {
        const characters = await unifiedStore.listObjects('character', projectId);
        context.characters = characters.map(char => {
          const langData = char.data[mainLanguage] || Object.values(char.data)[0];
          return { id: char.id, name: langData?.name || '', description: langData?.description || '' };
        });
      }

      if (contextOptions.organizations) {
        const organizations = await unifiedStore.listObjects('organization', projectId);
        context.organizations = organizations.map(org => {
          const langData = org.data[mainLanguage] || Object.values(org.data)[0];
          return { id: org.id, name: langData?.name || '', description: langData?.description || '' };
        });
      }

      if (contextOptions.locations) {
        const locations = await unifiedStore.listObjects('location', projectId);
        context.locations = locations.map(loc => {
          const langData = loc.data[mainLanguage] || Object.values(loc.data)[0];
          return { id: loc.id, name: langData?.name || '', description: langData?.description || '' };
        });
      }

      if (contextOptions.lorebook) {
        const lorebook = await unifiedStore.listObjects('lorebook', projectId);
        context.lorebook = lorebook.map(entry => {
          const langData = entry.data[mainLanguage] || Object.values(entry.data)[0];
          return { id: entry.id, name: langData?.name || '', description: langData?.description || '' };
        });
      }

      if (contextOptions.outline) {
        const acts = await unifiedStore.listObjects('act', projectId);
        const chapters = await unifiedStore.listObjects('chapter', projectId);
        context.outline = {
          acts: acts
            .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
            .map(act => {
              const actLangData = act.data[mainLanguage] || Object.values(act.data)[0];
              return {
                id: act.id,
                name: actLangData?.name || '',
                description: actLangData?.description || '',
                chapters: chapters
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

      if (contextOptions.allNovelContent) {
        const allManuscripts = await unifiedStore.listObjects('manuscript', projectId);
        const allChapters = await unifiedStore.listObjects('chapter', projectId);
        const chapterMap = new Map(allChapters.map(ch => [ch.id, ch]));
        const novelContent: Record<string, any> = {};

        allManuscripts.forEach((manuscriptObj) => {
          const contentChapterId = manuscriptObj.metadata?.chapter_id as string | undefined;
          if (!contentChapterId) return;
          const chapterInfo = chapterMap.get(contentChapterId);
          if (chapterInfo) {
            const chapterLangData = chapterInfo.data[mainLanguage] || Object.values(chapterInfo.data)[0];
            const manuscriptLangData = manuscriptObj.data[mainLanguage] || Object.values(manuscriptObj.data)[0];
            novelContent[contentChapterId] = {
              chapterName: chapterLangData?.name || '',
              chapterDescription: chapterLangData?.description || '',
              content: manuscriptLangData?.content || '',
              wordCount: manuscriptLangData?.wordCount ?? 0,
            };
          }
        });

        if (Object.keys(novelContent).length > 0) {
          context.existingNovelContent = novelContent;
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
      formState: { userRequest, contextOptions },
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

  const toggleContextOption = (option: keyof NovelContextOptions) => {
    setContextOptions(prev => ({ ...prev, [option]: !prev[option] }));
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
            <label>Context Inclusion Options</label>
            <div className="checkbox-group">
              {(['basicInfo', 'characters', 'organizations', 'locations', 'lorebook', 'outline', 'allNovelContent'] as const).map(option => (
                <label key={option} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={contextOptions[option]}
                    onChange={() => toggleContextOption(option)}
                    disabled={isProcessing}
                  />
                  <span className="checkbox-text">
                    {option === 'basicInfo' ? 'Basic Info' :
                     option === 'allNovelContent' ? 'All Novel Content' :
                     option.charAt(0).toUpperCase() + option.slice(1)}
                  </span>
                </label>
              ))}
            </div>
            <p className="context-help">
              Select the context for the AI to refer to. Including "All Novel Content" provides context from all written chapters.
            </p>
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
            <button type="submit" className="submit-button" disabled={!userRequest.trim() || isProcessing}>
              {isProcessing ? 'AI Processing...' : 'Request AI Edit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default NovelChapterAIEditModal;
