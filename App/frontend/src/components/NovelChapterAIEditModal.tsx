import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { useLLMTaskStore } from '../store/llmTaskStore';
import type { FunctionCallMetadata } from '../llm_request/types';
import { LLMRequestPipeline } from '../chat/LLMRequestPipeline';
import { NOVEL_EDITOR_FUNCTIONS } from '../chat/types/functionCalling';
import { LLMRequestManager } from '../chat/sessions/LLMRequestManager';
import type { ManuscriptObject } from '../types/unifiedObject';
import { extractRawContent } from '../utils/nativeOutputParser';
import { useLLMToast } from '../hooks/useLLMToast';

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

  // Session ID for toast and streaming
  const sessionId = `chapter-edit-${chapterId}`;

  // Toast notification for LLM requests
  const { startTask, completeSuccess, completeError, completeCancelled } = useLLMToast({
    sessionId,
    taskType: 'chapter-edit',
    label: `AI Edit: ${chapterName}`,
  });

  // Get streaming content from store
  const getSessionById = useLLMTaskStore((state) => state.getSessionById);
  const setContentParts = useLLMTaskStore((state) => state.setContentParts);
  const session = getSessionById(sessionId);
  const streamContent = useMemo(() => {
    if (!session?.contentParts || session.contentParts.length === 0) return '';
    return session.contentParts
      .filter((p) => p.type === 'content')
      .map((p) => p.text)
      .join('');
  }, [session?.contentParts]);

  const unifiedStore = useUnifiedObjectStore();
  const settingsStore = useSettingsStore();
  const abortControllerRef = useRef<AbortController | null>(null);
  const taskRunnerRef = useRef<LLMRequestManager | null>(null);

  // Get manuscript data from unified store
  const getActiveLanguageContent = (targetChapterId: string): { content: string; wordCount: number } | null => {
    const manuscriptObj = unifiedStore.getManuscriptByChapterId(targetChapterId) as ManuscriptObject | null;
    if (!manuscriptObj || !manuscriptObj.data) {
      return null;
    }
    // Access data for the main language, with fallback to first available
    const mainLanguage = settingsStore.settings.mainLanguage;
    const langData = manuscriptObj.data[mainLanguage] || Object.values(manuscriptObj.data)[0];
    if (!langData) {
      return null;
    }
    return {
      content: langData.content || '',
      wordCount: langData.wordCount || 0,
    };
  };

  useEffect(() => {
    if (!isOpen) {
      // Reset form state but DON'T abort running requests
      // Request continues in background, toast shows progress
      setUserRequest('');
      setError(null);
      setIsProcessing(false);
    }
  }, [isOpen, projectId]);

  const generateNovelContext = async (): Promise<Record<string, any>> => {
    const context: Record<string, any> = {};
    const mainLanguage = settingsStore.settings.mainLanguage;

    try {
      // Basic Info
      if (contextOptions.basicInfo) {
        const basicInfoList = await unifiedStore.listObjects('basic_info', projectId);
        if (basicInfoList.length > 0) {
          const basicInfo = basicInfoList[0];
          const langData = basicInfo.data[mainLanguage] || Object.values(basicInfo.data)[0];
          context.basicInfo = {
            title: langData?.title || '',
            logline: langData?.logline || '',
            genre: langData?.genre || '',
          };
        }
      }

      // Characters
      if (contextOptions.characters) {
        const characters = await unifiedStore.listObjects('character', projectId);
        if (characters.length > 0) {
          context.characters = characters.map(char => {
            const langData = char.data[mainLanguage] || Object.values(char.data)[0];
            return {
              id: char.id,
              name: langData?.name || '',
              description: langData?.description || '',
            };
          });
        }
      }

      // Organizations
      if (contextOptions.organizations) {
        const organizations = await unifiedStore.listObjects('organization', projectId);
        if (organizations.length > 0) {
          context.organizations = organizations.map(org => {
            const langData = org.data[mainLanguage] || Object.values(org.data)[0];
            return {
              id: org.id,
              name: langData?.name || '',
              description: langData?.description || '',
            };
          });
        }
      }

      // Locations
      if (contextOptions.locations) {
        const locations = await unifiedStore.listObjects('location', projectId);
        if (locations.length > 0) {
          context.locations = locations.map(loc => {
            const langData = loc.data[mainLanguage] || Object.values(loc.data)[0];
            return {
              id: loc.id,
              name: langData?.name || '',
              description: langData?.description || '',
            };
          });
        }
      }

      // Lorebook
      if (contextOptions.lorebook) {
        const lorebook = await unifiedStore.listObjects('lorebook', projectId);
        if (lorebook.length > 0) {
          context.lorebook = lorebook.map(entry => {
            const langData = entry.data[mainLanguage] || Object.values(entry.data)[0];
            return {
              id: entry.id,
              name: langData?.name || '',
              description: langData?.description || '',
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
                      return {
                        id: chapter.id,
                        name: chapterLangData?.name || '',
                        description: chapterLangData?.description || '',
                      };
                    }),
                };
              }),
          };
        }
      }

      // All novel content
      if (contextOptions.allNovelContent) {
        const allManuscripts = await unifiedStore.listObjects('manuscript', projectId);
        const novelContent: Record<string, any> = {};

        // Get all chapters from unified store for metadata
        const allChapters = await unifiedStore.listObjects('chapter', projectId);
        const chapterMap = new Map(allChapters.map(ch => [ch.id, ch]));

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRequest.trim() || isProcessing) return;

    setIsProcessing(true);
    setContentParts(sessionId, []);
    setError(null);

    // Start toast notification with retry context
    startTask({
      taskType: 'chapter-edit',
      modalProps: {
        projectId,
        chapterId,
        chapterName,
        onResult,
      },
      formState: {
        userRequest,
        contextOptions,
      },
    });

    // Auto-close modal - request continues in background, toast shows progress
    onClose();

    try {
      const chapterGenConfig = settingsStore.getFunctionConfig('chapterGen');
      const providerConfig = settingsStore.getProviderConfig(chapterGenConfig.provider);

      // Get current chapter content
      const currentContent = getActiveLanguageContent(chapterId)?.content || '';

      // Generate context
      const contextData = await generateNovelContext();

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
        includeNovelContent: true,
        promptContext: {
          chapterName,
          currentContent,
          contextData,
          enablePrefill: chapterGenConfig.advanced.enablePrefill,
          enableThinking: chapterGenConfig.advanced.thinkingMode !== 'off',
          userRequest,
          isNativeOutput,
        },
        promptType: 'chapter_edit' as const,
      };

      // Get novel data from unified store - convert to expected format
      const getNovelData = () => {
        const allContent: Record<string, any> = {};
        Object.values(unifiedStore.objects).forEach(obj => {
          if (obj.type === 'manuscript' && obj.metadata?.project_id === projectId) {
            const contentChapterId = obj.metadata?.chapter_id as string;
            if (contentChapterId) {
              allContent[contentChapterId] = obj;
            }
          }
        });
        return allContent;
      };

      // Native output handler
      const handleNativeOutput = async (text: string) => {
        const cleanedContent = extractRawContent(text);

        // Find the manuscript object and update via unified store
        const manuscriptObj = unifiedStore.getManuscriptByChapterId(chapterId);
        if (!manuscriptObj) {
          const errorMsg = `Manuscript not found for chapter ${chapterId}`;
          setError(errorMsg);
          completeError(errorMsg);
          return;
        }

        const wordCount = cleanedContent.trim().split(/\s+/).filter(Boolean).length;
        await unifiedStore.updateObject('manuscript', manuscriptObj.id, {
          data: {
            content: cleanedContent,
            wordCount,
          },
          language: settingsStore.settings.mainLanguage,
          create_new_version: true,
          user_request: 'AI Generated Content',
        });

        completeSuccess();
        if (onResult) {
          onResult();
        }
        // Modal already closed - no need to call onClose()
      };

      const taskRunnerConfig = {
        projectId,
        getStoryObjects,
        getNovelData,
        systemInsertConfig,
        chatPipeline: new LLMRequestPipeline(),
        provider: chapterGenConfig.provider,
        providerConfig,
        aiModel: chapterGenConfig.model,
        temperature: chapterGenConfig.temperature,
        providerPreference: chapterGenConfig.providerPreference,
        functions: isNativeOutput ? undefined : NOVEL_EDITOR_FUNCTIONS,
        toolChoice: isNativeOutput ? undefined : undefined, // NOVEL_EDITOR_FUNCTIONS doesn't require toolChoice
        mode: 'novelEditor' as const,
        enablePrefill: chapterGenConfig.advanced.enablePrefill,
        thinkingMode: chapterGenConfig.advanced.thinkingMode as any,
        thinkingConfig: chapterGenConfig.advanced.thinkingConfig as any,
        abortControllerRef,
        sessionId,
      };

      taskRunnerRef.current = new LLMRequestManager(taskRunnerConfig, {
        onStreamUpdate: () => {}, // Store is now updated by LLMRequestManager internally
        onFunctionCalls: isNativeOutput ? undefined : async (functionCalls: FunctionCallMetadata[]) => {
          try {
            const updateCall = functionCalls.find((fc) => fc.function_name === 'update_manuscript');
            if (!updateCall) {
              const errorMsg = 'AI did not call update_manuscript function';
              setError(errorMsg);
              completeError(errorMsg);
              return;
            }

            const args = typeof updateCall.arguments === 'string'
              ? JSON.parse(updateCall.arguments)
              : updateCall.arguments;

            // Find the manuscript object and update via unified store
            const manuscriptObj = unifiedStore.getManuscriptByChapterId(args.chapterId);
            if (!manuscriptObj) {
              const errorMsg = `Manuscript not found for chapter ${args.chapterId}`;
              setError(errorMsg);
              completeError(errorMsg);
              return;
            }

            const wordCount = args.content.trim().split(/\s+/).filter(Boolean).length;
            await unifiedStore.updateObject('manuscript', manuscriptObj.id, {
              data: {
                content: args.content,
                wordCount,
              },
              language: settingsStore.settings.mainLanguage,
              create_new_version: true,
              user_request: 'AI Generated Content',
            });

            completeSuccess();
            if (onResult) {
              onResult();
            }
            // Modal already closed - no need to call onClose()
          } catch (err) {
            console.error('Function application error:', err);
            const errorMsg = err instanceof Error ? err.message : 'Failed to apply chapter content update';
            setError(errorMsg);
            completeError(errorMsg);
          }
        },
        onFinalMessage: isNativeOutput ? async (message) => {
          const text = message.contentParts
            ?.filter(part => part.type === 'content')
            .map(part => part.text)
            .join('') || '';
          if (text.trim()) {
            await handleNativeOutput(text.trim());
          } else {
            const errorMsg = 'AI did not generate any content.';
            setError(errorMsg);
            completeError(errorMsg);
          }
        } : undefined,
        onError: (err) => {
          setError(err.message);
          completeError(err.message);
        },
      });

      await taskRunnerRef.current.run(
        null,
        {
          history: [],
          language: settingsStore.settings.mainLanguage,
        }
      );

    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          completeCancelled();
          return;
        }
        setError(err.message);
        completeError(err.message);
      } else {
        const errorMsg = 'An unknown error occurred.';
        setError(errorMsg);
        completeError(errorMsg);
      }
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
      taskRunnerRef.current = null;
    }
  };

  // Just close modal - don't abort (request continues in background)
  const handleClose = () => {
    onClose();
  };

  const toggleContextOption = (option: keyof NovelContextOptions) => {
    setContextOptions(prev => ({
      ...prev,
      [option]: !prev[option],
    }));
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content ai-edit-modal novel-chapter-ai-edit-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🤖 AI Chapter Edit</h2>
          <div className="chapter-info">
            <span className="chapter-name">{chapterName}</span>
          </div>
          <button className="modal-close" onClick={handleClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="ai-edit-form">
          <div className="form-group">
            <label htmlFor="user-request">Edit Request</label>
            <textarea
              id="user-request"
              value={userRequest}
              onChange={(e) => setUserRequest(e.target.value)}
              placeholder={`Enter your edit request for "${chapterName}".
e.g., "Make the dialogue more natural and add more emotional depth to the conversation", "Add more descriptive details to the action scene", "Improve the pacing and tension in this chapter"`}
              rows={4}
              required
              disabled={isProcessing}
            />
          </div>

          <div className="form-group context-options">
            <label>Context Inclusion Options</label>
            <div className="checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={contextOptions.basicInfo}
                  onChange={() => toggleContextOption('basicInfo')}
                  disabled={isProcessing}
                />
                <span className="checkbox-text">Basic Info</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={contextOptions.characters}
                  onChange={() => toggleContextOption('characters')}
                  disabled={isProcessing}
                />
                <span className="checkbox-text">Characters</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={contextOptions.organizations}
                  onChange={() => toggleContextOption('organizations')}
                  disabled={isProcessing}
                />
                <span className="checkbox-text">Organizations</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={contextOptions.locations}
                  onChange={() => toggleContextOption('locations')}
                  disabled={isProcessing}
                />
                <span className="checkbox-text">Locations</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={contextOptions.lorebook}
                  onChange={() => toggleContextOption('lorebook')}
                  disabled={isProcessing}
                />
                <span className="checkbox-text">Lorebook</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={contextOptions.outline}
                  onChange={() => toggleContextOption('outline')}
                  disabled={isProcessing}
                />
                <span className="checkbox-text">Outline</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={contextOptions.allNovelContent}
                  onChange={() => toggleContextOption('allNovelContent')}
                  disabled={isProcessing}
                />
                <span className="checkbox-text">All Novel Content</span>
              </label>
            </div>
            <p className="context-help">
              Select the context for the AI to refer to. Including "All Novel Content" provides context from all written chapters for better consistency.
            </p>
          </div>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          {streamContent && (
            <div className="ai-response">
              <h3>AI Response:</h3>
              <div className="response-content novel-content-preview">
                {streamContent}
              </div>
            </div>
          )}

          <div className="form-actions">
            <button
              type="button"
              onClick={handleClose}
              className="cancel-button"
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

export default NovelChapterAIEditModal;


