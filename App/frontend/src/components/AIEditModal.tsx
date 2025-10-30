import React, { useState, useRef, useEffect } from 'react';
import { useStoryObjectStore } from '../store/storyObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { useChatStore } from '../store/chatStore';
import type { StoryObjectCategory } from '../types/storyObject';
import type { FunctionCallMetadata, ContentPart } from '../llm_request/types';
import { ChatManager, type ChatManagerConfig, type ChatManagerCallbacks } from '../chat/processors/ChatManager';
import { ChatPipeline } from '../chat/ChatPipeline';
import { getEditFunctionSchema } from '../chat/types/editFunctionSchemas';
import { applyEditFunctionCalls } from '../chat/utils/editFunctionApplicator';

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
  category: StoryObjectCategory;
  projectId: string;
  targetId?: string;
  onResult?: () => void;
}

const AIEditModal: React.FC<AIEditModalProps> = ({
  isOpen,
  onClose,
  category,
  projectId,
  targetId,
  onResult,
}) => {
  const [userRequest, setUserRequest] = useState('');
  const [contextOptions, setContextOptions] = useState<ContextOptions>({
    basicInfo: true,
    characters: true,
    organizations: true,
    locations: true,
    lorebook: true,
    outline: true,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const storyObjectStore = useStoryObjectStore();
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

  const generateContext = () => {
    const storyObjects = storyObjectStore.getStoryObjects(projectId);
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

    return context;
  };

  const getCurrentData = () => {
    const storyObjects = storyObjectStore.getStoryObjects(projectId);

    if (targetId) {
      // Get specific item
      switch (category) {
        case 'character':
          return storyObjects.characters.find(c => c.id === targetId);
        case 'organization':
          return storyObjects.organizations.find(o => o.id === targetId);
        case 'location':
          return storyObjects.locations.find(l => l.id === targetId);
        case 'lorebook':
          return storyObjects.lorebook.find(e => e.id === targetId);
        case 'basicInfo':
          return storyObjects.basicInfo;
        case 'outline':
          return storyObjects.outline;
        case 'act':
          return storyObjects.outline?.acts.find(a => a.id === targetId);
        case 'chapter':
          for (const act of storyObjects.outline?.acts || []) {
            const chapter = act.chapters.find(c => c.id === targetId);
            if (chapter) return chapter;
          }
          return null;
        default:
          return null;
      }
    } else {
      // Get entire category
      switch (category) {
        case 'character':
          return storyObjects.characters;
        case 'organization':
          return storyObjects.organizations;
        case 'location':
          return storyObjects.locations;
        case 'lorebook':
          return storyObjects.lorebook;
        case 'basicInfo':
          return storyObjects.basicInfo;
        case 'outline':
          return storyObjects.outline;
        case 'act':
          return storyObjects.outline?.acts || [];
        case 'chapter':
          const allChapters = [];
          for (const act of storyObjects.outline?.acts || []) {
            allChapters.push(...act.chapters);
          }
          return allChapters;
        default:
          return null;
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRequest.trim() || isProcessing) return;

    setIsProcessing(true);
    setStreamContent('');
    setError(null);

    try {
      const storyEditConfig = settingsStore.getFunctionConfig('storyEdit');
      const providerConfig = settingsStore.getProviderConfig(storyEditConfig.provider);

      // Create temporary chat for this edit session
      const tempChatId = `temp-edit-${Date.now()}`;
      tempChatIdRef.current = tempChatId;

      // Get function schema for this edit operation
      const functionSchema = getEditFunctionSchema(category, !!targetId);

      // Generate context
      const contextData = generateContext();
      const currentData = getCurrentData();

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
          // Apply function calls
          try {
            const results = await applyEditFunctionCalls(projectId, functionCalls);

            const failedResults = results.filter(r => !r.success);
            if (failedResults.length > 0) {
              setError(`Failed to apply some edits: ${failedResults.map(r => r.error).join(', ')}`);
            } else {
              // Success! Close modal
              if (onResult) {
                onResult();
              }
              onClose();
            }
          } catch (err) {
            console.error('Function application error:', err);
            setError(err instanceof Error ? err.message : 'Failed to apply edits');
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
        systemInsertConfig: {
          promptContext: {
            category,
            targetId,
            contextData,
            currentData,
            enablePrefill: storyEditConfig.advanced.enablePrefill,
            enableThinking: storyEditConfig.advanced.thinkingMode !== 'off',
          },
          promptType: 'story_object_edit',
        },
        chatPipeline: new ChatPipeline(),
        getIsLoading: () => isProcessing,
        setIsLoading: (loading) => setIsProcessing(loading),
        abortControllerRef,
        getActiveChatId: () => tempChatId,
        getConversationLanguage: () => settingsStore.settings.primaryLanguage,
        provider: storyEditConfig.provider,
        providerConfig,
        aiModel: storyEditConfig.model,
        temperature: storyEditConfig.temperature,
        providerPreference: storyEditConfig.providerPreference,
        functions: [functionSchema],
        mode: 'workspace',
        enablePrefill: storyEditConfig.advanced.enablePrefill,
        thinkingMode: storyEditConfig.advanced.thinkingMode as any,
        reasoningConfig: storyEditConfig.advanced.reasoningConfig,
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

  const toggleContextOption = (option: keyof ContextOptions) => {
    setContextOptions(prev => ({
      ...prev,
      [option]: !prev[option],
    }));
  };

  const getCategoryDisplayName = (cat: string): string => {
    const names: Record<string, string> = {
      basicInfo: 'Basic Info',
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

  if (!isOpen) return null;

  const categoryDisplayName = getCategoryDisplayName(category);
  const editTypeText = targetId ? 'Item' : 'All';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content ai-edit-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🤖 AI {categoryDisplayName} {editTypeText} Edit</h2>
          <button className="modal-close" onClick={handleCancel}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="ai-edit-form">
          <div className="form-group">
            <label htmlFor="user-request">Edit Request</label>
            <textarea
              id="user-request"
              value={userRequest}
              onChange={(e) => setUserRequest(e.target.value)}
              placeholder={`Enter your edit request for the ${categoryDisplayName} ${editTypeText}.
e.g., "Make the main character's personality more proactive", "Make the atmosphere of all locations darker"`}
              rows={4}
              required
              disabled={isProcessing}
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
                    disabled={isProcessing}
                  />
                  <span className="checkbox-text">
                    {getCategoryDisplayName(key)}
                  </span>
                </label>
              ))}
            </div>
            <p className="context-help">
              Select the context for the AI to refer to. Providing more context will lead to more consistent results.
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
              <pre className="response-content">{streamContent}</pre>
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

export default AIEditModal;
