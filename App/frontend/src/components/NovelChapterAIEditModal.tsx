import React, { useState, useRef, useEffect } from 'react';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useNovelStore, type ChapterContentData } from '../store/novelStore';
import { useSettingsStore } from '../store/settingsStore';
import type { FunctionCallMetadata, ContentPart } from '../llm_request/types';
import { ChatPipeline } from '../chat/ChatPipeline';
import { NOVEL_EDITOR_FUNCTIONS } from '../chat/types/functionCalling';
import { LLMRequestManager } from '../chat/sessions/LLMRequestManager';

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
}

const NovelChapterAIEditModal: React.FC<NovelChapterAIEditModalProps> = ({
  isOpen,
  onClose,
  projectId,
  chapterId,
  chapterName,
  onResult,
}) => {
  const [userRequest, setUserRequest] = useState('');
  const [contextOptions, setContextOptions] = useState<NovelContextOptions>({
    basicInfo: true,
    characters: true,
    organizations: true,
    locations: true,
    lorebook: true,
    outline: true,
    allNovelContent: true,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const unifiedStore = useUnifiedObjectStore();
  const novelStore = useNovelStore();
  const settingsStore = useSettingsStore();
  const abortControllerRef = useRef<AbortController | null>(null);
  const taskRunnerRef = useRef<LLMRequestManager | null>(null);

  const getActiveLanguageContent = (targetChapterId: string): ChapterContentData | null => {
    const primaryLanguage = settingsStore.settings.primaryLanguage;
    const languageContent = novelStore.getChapterContentForLanguage(
      projectId,
      targetChapterId,
      primaryLanguage
    );
    if (languageContent) {
      return languageContent;
    }

    const chapterContent = novelStore.getChapterContent(projectId, targetChapterId);
    if (!chapterContent) {
      return null;
    }

    const activeVersion = chapterContent.versions.find((version) => version.is_active);
    if (!activeVersion) {
      return null;
    }

    const [fallbackLanguage] = Object.keys(activeVersion.data);
    if (!fallbackLanguage) {
      return null;
    }

    return activeVersion.data[fallbackLanguage] || null;
  };

  useEffect(() => {
    if (!isOpen) {
      setUserRequest('');
      setStreamContent('');
      setError(null);
      setIsProcessing(false);
      taskRunnerRef.current?.abort();
      taskRunnerRef.current = null;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    }
  }, [isOpen, projectId]);

  const generateNovelContext = async (): Promise<Record<string, any>> => {
    const context: Record<string, any> = {};

    try {
      // Basic Info
      if (contextOptions.basicInfo) {
        const basicInfoList = await unifiedStore.listObjects('basic_info', projectId);
        if (basicInfoList.length > 0) {
          const basicInfo = basicInfoList[0];
          context.basicInfo = {
            title: basicInfo.data.title || '',
            logline: basicInfo.data.logline || '',
            genre: basicInfo.data.genre || '',
          };
        }
      }

      // Characters
      if (contextOptions.characters) {
        const characters = await unifiedStore.listObjects('character', projectId);
        if (characters.length > 0) {
          context.characters = characters.map(char => ({
            id: char.id,
            name: char.data.name || '',
            description: char.data.description || '',
          }));
        }
      }

      // Organizations
      if (contextOptions.organizations) {
        const organizations = await unifiedStore.listObjects('organization', projectId);
        if (organizations.length > 0) {
          context.organizations = organizations.map(org => ({
            id: org.id,
            name: org.data.name || '',
            description: org.data.description || '',
          }));
        }
      }

      // Locations
      if (contextOptions.locations) {
        const locations = await unifiedStore.listObjects('location', projectId);
        if (locations.length > 0) {
          context.locations = locations.map(loc => ({
            id: loc.id,
            name: loc.data.name || '',
            description: loc.data.description || '',
          }));
        }
      }

      // Lorebook
      if (contextOptions.lorebook) {
        const lorebook = await unifiedStore.listObjects('lorebook', projectId);
        if (lorebook.length > 0) {
          context.lorebook = lorebook.map(entry => ({
            id: entry.id,
            name: entry.data.name || '',
            description: entry.data.description || '',
          }));
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
              .map(act => ({
                id: act.id,
                name: act.data.name || '',
                description: act.data.description || '',
                chapters: chapters
                  .filter(ch => ch.metadata.act_id === act.id)
                  .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
                  .map(chapter => ({
                    id: chapter.id,
                    name: chapter.data.name || '',
                    description: chapter.data.description || '',
                  })),
              })),
          };
        }
      }

      // All novel content
      if (contextOptions.allNovelContent) {
        const allChapterContents = novelStore.getAllChapterContents(projectId);
        const novelContent: Record<string, any> = {};

        // Get all chapters from unified store for metadata
        const allChapters = await unifiedStore.listObjects('chapter', projectId);
        const chapterMap = new Map(allChapters.map(ch => [ch.id, ch]));

        Object.keys(allChapterContents).forEach((id) => {
          const chapterInfo = chapterMap.get(id);
          if (chapterInfo) {
            const chapterLanguageContent = getActiveLanguageContent(id);
            novelContent[id] = {
              chapterName: chapterInfo.data.name || '',
              chapterDescription: chapterInfo.data.description || '',
              content: chapterLanguageContent?.content || '',
              wordCount: chapterLanguageContent?.wordCount ?? 0,
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
    setStreamContent('');
    setError(null);

    try {
      const chapterGenConfig = settingsStore.getFunctionConfig('chapterGen');
      const providerConfig = settingsStore.getProviderConfig(chapterGenConfig.provider);

      // Get current chapter content
      const currentContent = getActiveLanguageContent(chapterId)?.content || '';

      // Generate context
      const contextData = await generateNovelContext();

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
        },
        promptType: 'chapter_edit' as const,
      };

      const taskRunnerConfig = {
        projectId,
        getStoryObjects,
        getNovelData: () => novelStore.getAllChapterContents(projectId),
        systemInsertConfig,
        chatPipeline: new ChatPipeline(),
        provider: chapterGenConfig.provider,
        providerConfig,
        aiModel: chapterGenConfig.model,
        temperature: chapterGenConfig.temperature,
        providerPreference: chapterGenConfig.providerPreference,
        functions: NOVEL_EDITOR_FUNCTIONS,
        mode: 'novelEditor' as const,
        enablePrefill: chapterGenConfig.advanced.enablePrefill,
        thinkingMode: chapterGenConfig.advanced.thinkingMode as any,
        reasoningConfig: chapterGenConfig.advanced.reasoningConfig,
        abortControllerRef,
      };

      taskRunnerRef.current = new LLMRequestManager(taskRunnerConfig, {
        onStreamUpdate: (contentParts: ContentPart[]) => {
          const textContent = contentParts
            .filter((p) => p.type === 'content')
            .map((p) => p.text)
            .join('');
          setStreamContent(textContent);
        },
        onFunctionCalls: async (functionCalls: FunctionCallMetadata[]) => {
          try {
            const updateCall = functionCalls.find((fc) => fc.function_name === 'update_chapter_content');
            if (!updateCall) {
              setError('AI did not call update_chapter_content function');
              return;
            }

            const args = typeof updateCall.arguments === 'string'
              ? JSON.parse(updateCall.arguments)
              : updateCall.arguments;

            await novelStore.updateChapterContent(projectId, args.chapterId, args.content);

            if (onResult) {
              onResult();
            }
            onClose();
          } catch (err) {
            console.error('Function application error:', err);
            setError(err instanceof Error ? err.message : 'Failed to apply chapter content update');
          }
        },
        onError: (err) => {
          setError(err.message);
        },
      });

      await taskRunnerRef.current.run(
        {
          id: `msg-user-${Date.now()}`,
          role: 'user',
          content: userRequest,
          timestamp: new Date(),
        },
        {
          history: [],
          language: settingsStore.settings.primaryLanguage,
        }
      );

    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          return;
        }
        setError(err.message);
      } else {
        setError('An unknown error occurred.');
      }
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
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
          <button className="modal-close" onClick={handleCancel}>×</button>
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

export default NovelChapterAIEditModal;


