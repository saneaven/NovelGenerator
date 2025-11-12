import React, { useState, useRef, useEffect } from 'react';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { useChatStore } from '../store/chatStore';
import type { ObjectType } from '../types/unifiedObject';
import type { FunctionCallMetadata, ContentPart } from '../llm_request/types';
import { ChatManager, type ChatManagerConfig, type ChatManagerCallbacks } from '../chat/processors/ChatManager';
import { ChatPipeline } from '../chat/ChatPipeline';
import { getEditFunctionSchema } from '../chat/types/editFunctionSchemas';
import { applyEditFunctionCalls } from '../chat/utils/editFunctionApplicator';
import './AIEditModal.css';

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
  category: ObjectType;
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

  const unifiedStore = useUnifiedObjectStore();
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

  const generateContext = async () => {
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
    } catch (err) {
      console.error('Error generating context:', err);
    }

    return context;
  };

  const getCurrentData = async () => {
    if (targetId) {
      // Get specific item
      const object = unifiedStore.objects[targetId];
      if (!object) {
        // Try to fetch it
        try {
          await unifiedStore.fetchObject(category, targetId);
          return unifiedStore.objects[targetId];
        } catch (err) {
          console.error('Failed to fetch target object:', err);
          return null;
        }
      }
      return object;
    } else {
      // Get entire category
      try {
        const objects = await unifiedStore.listObjects(category, projectId);
        return objects;
      } catch (err) {
        console.error('Failed to list objects:', err);
        return [];
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
      const contextData = await generateContext();
      const currentData = await getCurrentData();

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

      // Create a mock getStoryObjects function for ChatManager
      // ChatManager still expects this for system prompt generation
      const getStoryObjects = () => {
        // Return empty structure - ChatManager will use what we provide in promptContext
        return {
          basicInfo: null,
          characters: [],
          organizations: [],
          locations: [],
          lorebook: [],
          outline: { acts: [] },
        };
      };

      // Create ChatManager config
      const chatManagerConfig: ChatManagerConfig = {
        projectId,
        getStoryObjects,
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
