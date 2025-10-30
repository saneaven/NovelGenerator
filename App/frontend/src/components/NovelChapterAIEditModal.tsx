import React, { useState, useRef, useEffect } from 'react';
import { useStoryObjectStore } from '../store/storyObjectStore';
import { useNovelStore } from '../store/novelStore';
import { useSettingsStore } from '../store/settingsStore';
import { useChatStore } from '../store/chatStore';
import type { StoryObjects } from '../types/storyObject';
import type { FunctionCallMetadata, ContentPart } from '../llm_request/types';
import { ChatManager, type ChatManagerConfig, type ChatManagerCallbacks } from '../chat/processors/ChatManager';
import { ChatPipeline } from '../chat/ChatPipeline';
import { NOVEL_EDITOR_FUNCTIONS } from '../chat/types/functionCalling';

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

  const storyObjectStore = useStoryObjectStore();
  const novelStore = useNovelStore();
  const settingsStore = useSettingsStore();
  const chatStore = useChatStore();
  const abortControllerRef = useRef<AbortController | null>(null);
  const chatManagerRef = useRef<ChatManager | null>(null);
  const tempChatIdRef = useRef<string>('');

  useEffect(() => {
    if (!isOpen) {
      setUserRequest('');
      setStreamContent('');
      setError(null);
      setIsProcessing(false);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      // Clean up temporary chat
      if (tempChatIdRef.current) {
        chatStore.deleteChat(projectId, tempChatIdRef.current);
        tempChatIdRef.current = '';
      }
    }
  }, [isOpen, projectId, chatStore]);

  const generateNovelContext = (storyObjects: StoryObjects): Record<string, any> => {
    const context: Record<string, any> = {};

    if (contextOptions.basicInfo && storyObjects.basicInfo) {
      context.basicInfo = {
        title: storyObjects.basicInfo.title,
        logline: storyObjects.basicInfo.logline,
        genre: storyObjects.basicInfo.genre,
      };
    }

    if (contextOptions.characters && storyObjects.characters.length > 0) {
      context.characters = storyObjects.characters.map(char => ({
        id: char.id,
        name: char.name,
        description: char.description,
      }));
    }

    if (contextOptions.organizations && storyObjects.organizations.length > 0) {
      context.organizations = storyObjects.organizations.map(org => ({
        id: org.id,
        name: org.name,
        description: org.description,
      }));
    }

    if (contextOptions.locations && storyObjects.locations.length > 0) {
      context.locations = storyObjects.locations.map(loc => ({
        id: loc.id,
        name: loc.name,
        description: loc.description,
      }));
    }

    if (contextOptions.lorebook && storyObjects.lorebook.length > 0) {
      context.lorebook = storyObjects.lorebook.map(entry => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
      }));
    }

    if (contextOptions.outline && storyObjects.outline) {
      context.outline = {
        acts: storyObjects.outline.acts.map(act => ({
          id: act.id,
          name: act.name,
          description: act.description,
          chapters: act.chapters.map(chapter => ({
            id: chapter.id,
            name: chapter.name,
            description: chapter.description,
          })),
        })),
      };
    }

    if (contextOptions.allNovelContent) {
      const allChapterContents = novelStore.getAllChapterContents(projectId);
      const novelContent: Record<string, any> = {};

      Object.entries(allChapterContents).forEach(([id, content]) => {
        const chapterInfo = storyObjectStore.getChapterById(projectId, id);
        if (chapterInfo) {
          novelContent[id] = {
            chapterName: chapterInfo.name,
            chapterDescription: chapterInfo.description,
            content: content.content,
            wordCount: content.wordCount,
          };
        }
      });

      if (Object.keys(novelContent).length > 0) {
        context.existingNovelContent = novelContent;
      }
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

      // Create temporary chat for this edit session
      const tempChatId = `temp-chapter-edit-${Date.now()}`;
      tempChatIdRef.current = tempChatId;

      // Get current chapter content and story objects
      const storyObjects = storyObjectStore.getStoryObjects(projectId);
      const currentChapterContent = novelStore.getChapterContent(projectId, chapterId);
      const currentContent = currentChapterContent?.content || '';

      // Generate context
      const contextData = generateNovelContext(storyObjects);

      // Setup ChatManager callbacks
      const callbacks: ChatManagerCallbacks = {
        onUpdateMessage: (projId, chatId, messageId, contentParts: ContentPart[]) => {
          // Update stream content display
          const textContent = contentParts
            .filter(p => p.type === 'content')
            .map(p => p.text)
            .join('');
          setStreamContent(textContent);
        },
        onSyncMessageToBackend: async () => {
          // No-op for temporary edit session
        },
        onFunctionCalls: async (projId, chatId, messageId, functionCalls: FunctionCallMetadata[]) => {
          // Handle update_chapter_content function call
          try {
            const updateCall = functionCalls.find(fc => fc.name === 'update_chapter_content');
            if (!updateCall) {
              setError('AI did not call update_chapter_content function');
              return;
            }

            const args = typeof updateCall.arguments === 'string'
              ? JSON.parse(updateCall.arguments)
              : updateCall.arguments;

            // Apply the chapter content update
            await novelStore.updateChapterContent(projectId, args.chapterId, args.content);

            // Success! Close modal
            if (onResult) {
              onResult();
            }
            onClose();
          } catch (err) {
            console.error('Function application error:', err);
            setError(err instanceof Error ? err.message : 'Failed to apply chapter content update');
          }
        },
        onAddMessage: async (projId, chatId, message, language) => {
          return `msg-${Date.now()}`;
        },
        onGetChatHistory: () => {
          return [];
        },
        onError: (err) => {
          setError(err.message);
        },
      };

      // Create ChatManager config
      const chatManagerConfig: ChatManagerConfig = {
        projectId,
        getStoryObjects: () => storyObjectStore.getStoryObjects(projectId),
        getNovelData: () => novelStore.getAllChapterContents(projectId),
        systemInsertConfig: {
          promptContext: {
            chapterName,
            currentContent,
            contextData,
            enablePrefill: chapterGenConfig.advanced.enablePrefill,
            enableThinking: chapterGenConfig.advanced.thinkingMode !== 'off',
            userRequest,
          },
          promptType: 'chapter_edit',
        },
        chatPipeline: new ChatPipeline(),
        getIsLoading: () => isProcessing,
        setIsLoading: (loading) => setIsProcessing(loading),
        abortControllerRef,
        getActiveChatId: () => tempChatId,
        getConversationLanguage: () => settingsStore.settings.primaryLanguage,
        provider: chapterGenConfig.provider,
        providerConfig,
        aiModel: chapterGenConfig.model,
        temperature: chapterGenConfig.temperature,
        providerPreference: chapterGenConfig.providerPreference,
        functions: NOVEL_EDITOR_FUNCTIONS,
        mode: 'novelEditor',
        enablePrefill: chapterGenConfig.advanced.enablePrefill,
        thinkingMode: chapterGenConfig.advanced.thinkingMode as any,
        reasoningConfig: chapterGenConfig.advanced.reasoningConfig,
      };

      // Create ChatManager
      chatManagerRef.current = new ChatManager(chatManagerConfig, callbacks);

      // Process user message
      await chatManagerRef.current.processUserMessage({
        id: `msg-user-${Date.now()}`,
        role: 'user',
        content: userRequest,
        timestamp: new Date(),
      });

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
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
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
