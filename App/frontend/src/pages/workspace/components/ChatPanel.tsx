import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useChatStore, type StoredChatMessage } from '../../../store/chatStore';
import { useProjectStore } from '../../../store/projectStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useErrorStore } from '../../../store/errorStore';
import type { SystemInsertConfig, EditCard } from '../../../chat/types';
import { TranslationService } from '../../../services/translationService';
import { streamChat } from '../../../llm_request/llmService';
import { ChatPipeline } from '../../../chat/ChatPipeline';
import { EditCardComponent } from '../../../chat/processors/DisplayProcessor';
import type { WorkspaceUIState, WorkspaceUIActions } from '../hooks/useWorkspaceState';
import type { StoryObjects } from '../../../types/storyObject';
import type { ChatMessage } from '../../../llm_request/types';

interface ChatPanelProps {
  projectId: string;
  uiState: WorkspaceUIState;
  uiActions: WorkspaceUIActions;
  systemInsertConfig: SystemInsertConfig;
  setSystemInsertConfig: (config: SystemInsertConfig | ((prev: SystemInsertConfig) => SystemInsertConfig)) => void;
  chatPipeline: ChatPipeline;
  storyObjects: StoryObjects;
  novelData?: Record<string, unknown>;
  messageEditCards: Record<string, EditCard[]>;
  activeFunctionCalls: Record<string, any[]>;
  onSubmit: (e: React.FormEvent, input: string, isLoading: boolean) => Promise<void>;
  onStop: () => void;
  onEditMessage: (messageId: string, content: string | null, language: string) => void;
  onEditContentChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSaveEdit: (editingMessageId: string | null, editContent: string, language: string) => void;
  onCancelEdit: () => void;
  onDeleteMessage: (messageId: string) => void;
  editTextareaRef: React.RefObject<HTMLTextAreaElement>;
  mode: 'novel-editor' | 'workspace';
}

interface DisplayMessageInfo {
  storedMessage: StoredChatMessage;
  chatMessage: ChatMessage;
  requestedLanguage: string;
  displayLanguage: string;
  hasRequestedLanguage: boolean;
  fallbackLanguage: string | null;
}

const ChatPanel: React.FC<ChatPanelProps> = ({
  projectId,
  uiState,
  uiActions,
  systemInsertConfig,
  setSystemInsertConfig,
  chatPipeline,
  storyObjects,
  novelData,
  messageEditCards,
  activeFunctionCalls,
  onSubmit,
  onStop,
  onEditMessage,
  onEditContentChange,
  onSaveEdit,
  onCancelEdit,
  onDeleteMessage,
  editTextareaRef,
  mode,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { getSelectedChatId, getSelectedChat, convertToDisplayMessage, addTranslatedMessage } = useChatStore();
  const { getCurrentProject } = useProjectStore();
  const { settings } = useSettingsStore();
  const { showError } = useErrorStore();

  const primaryLanguage = settings.primaryLanguage;
  const secondaryLanguage = settings.secondaryLanguage;
  const aiModel = settings.aiModel;

  const selectedChatId = getSelectedChatId(projectId);
  const selectedChat = selectedChatId ? getSelectedChat(projectId) : undefined;
  const storedMessages = useMemo(() => selectedChat?.messages ?? [], [selectedChat]);

  const [messageLanguages, setMessageLanguages] = useState<Record<string, string>>({});
  const [translatingMessages, setTranslatingMessages] = useState<Record<string, boolean>>({});
  const [translationErrors, setTranslationErrors] = useState<Record<string, string | null>>({});

  const currentProject = getCurrentProject();

  const formatTimestamp = useCallback((input: Date | string | number | undefined | null) => {
    if (!input) return '';

    const date = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toLocaleTimeString();
  }, []);

  useEffect(() => {
    setMessageLanguages({});
    setTranslatingMessages({});
    setTranslationErrors({});
  }, [selectedChatId]);

  useEffect(() => {
    setMessageLanguages(prev => {
      const updated = { ...prev };
      storedMessages.forEach(message => {
        if (!updated[message.id]) {
          if (message.data[primaryLanguage]) {
            updated[message.id] = primaryLanguage;
          } else if (secondaryLanguage && message.data[secondaryLanguage]) {
            updated[message.id] = secondaryLanguage;
          } else {
            const availableLanguages = Object.keys(message.data);
            updated[message.id] = availableLanguages[0] || primaryLanguage;
          }
        }
      });
      return updated;
    });
  }, [storedMessages, primaryLanguage, secondaryLanguage]);

  useEffect(() => {
    if (messagesEndRef.current) {
      const chatMessagesContainer = messagesEndRef.current.closest('.chat-messages');
      if (chatMessagesContainer) {
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
      }
    }
  }, [storedMessages, uiState.isLoading]);

  const displayContext = useMemo(() => {
    return ChatPipeline.createContext(
      projectId,
      storyObjects,
      mode,
      systemInsertConfig,
      novelData
    );
  }, [projectId, storyObjects, mode, systemInsertConfig, novelData]);

  const resolveDisplayInfo = useCallback(
    (message: StoredChatMessage): DisplayMessageInfo => {
      const requestedLanguage = messageLanguages[message.id] || primaryLanguage;
      const hasRequestedLanguage = Boolean(requestedLanguage && message.data[requestedLanguage]);

      if (hasRequestedLanguage) {
        return {
          storedMessage: message,
          chatMessage: convertToDisplayMessage(message, requestedLanguage),
          requestedLanguage,
          displayLanguage: requestedLanguage,
          hasRequestedLanguage: true,
          fallbackLanguage: null
        };
      }

      const fallback = TranslationService.getBestLanguageData(message.data, primaryLanguage, secondaryLanguage ?? undefined);

      const displayLanguage = fallback?.language ?? requestedLanguage ?? primaryLanguage;
      const fallbackLanguage = fallback ? fallback.language : null;
      const chatMessage = convertToDisplayMessage(message, displayLanguage);

      return {
        storedMessage: message,
        chatMessage,
        requestedLanguage,
        displayLanguage,
        hasRequestedLanguage: false,
        fallbackLanguage
      };
  },
    [messageLanguages, primaryLanguage, secondaryLanguage, convertToDisplayMessage]
  );

  const displayMessages = useMemo(
    () => storedMessages.map(resolveDisplayInfo),
    [storedMessages, resolveDisplayInfo]
  );

  const setMessageLanguage = (messageId: string, language: string) => {
    setMessageLanguages(prev => ({ ...prev, [messageId]: language }));
    setTranslationErrors(prev => ({ ...prev, [messageId]: null }));
  };

  const translateMessage = async (message: StoredChatMessage, sourceLanguage: string, targetLanguage: string) => {
    if (!selectedChatId) {
      showError('Translation Failed', 'No active chat selected.');
      return;
    }

    const sourceContent = message.data[sourceLanguage]?.content ?? '';
    if (!sourceContent.trim()) {
      showError('Translation Failed', `No ${sourceLanguage} content available to translate.`);
      return;
    }

    try {
      setTranslatingMessages(prev => ({ ...prev, [message.id]: true }));
      TranslationService.setTranslationStatus(message.id, { objectId: message.id, isTranslating: true });

      const translationRequest = TranslationService.prepareTranslationRequest({
        sourceLanguage,
        targetLanguage,
        data: { content: sourceContent },
        dataType: 'chatMessage'
      });

      const provider = settingsStore.settings.activeProvider;
      const providerConfig = settingsStore.settings.providers[provider];

      let response = '';
      for await (const chunk of streamChat(
        translationRequest.messages,
        provider,
        providerConfig,
        {
          model: aiModel,
          temperature: 0.2,
        }
      )) {
        if (typeof chunk === 'string') {
          response += chunk;
        } else if (chunk.content) {
          response += chunk.content;
        }
      }

      const parsed = TranslationService.parseTranslationResponse(response);
      const validation = TranslationService.validateTranslationResult(parsed, 'chatMessage');
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }

      addTranslatedMessage(projectId, selectedChatId, message.id, parsed.content, targetLanguage);
      setMessageLanguage(message.id, targetLanguage);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred during translation.';
      setTranslationErrors(prev => ({ ...prev, [message.id]: errorMessage }));
      showError('Translation Failed', errorMessage);
    } finally {
      setTranslatingMessages(prev => ({ ...prev, [message.id]: false }));
      TranslationService.clearTranslationStatus(message.id);
    }
  };

  const handleLanguageToggle = async (message: DisplayMessageInfo) => {
    if (!secondaryLanguage) return;

    const activeLanguage = messageLanguages[message.storedMessage.id] || primaryLanguage;
    const targetLanguage = activeLanguage === secondaryLanguage ? primaryLanguage : secondaryLanguage;

    if (message.storedMessage.data[targetLanguage]) {
      setMessageLanguage(message.storedMessage.id, targetLanguage);
      return;
    }

    const availableLanguages = Object.keys(message.storedMessage.data);
    if (availableLanguages.length === 0) {
      showError('Translation Failed', 'No available content to translate.');
      return;
    }

    const sourceLanguage = message.storedMessage.data[activeLanguage]
      ? activeLanguage
      : availableLanguages[0];

    await translateMessage(message.storedMessage, sourceLanguage, targetLanguage);
  };

  const ensureLanguageAvailable = async (message: DisplayMessageInfo, targetLanguage: string) => {
    if (message.storedMessage.data[targetLanguage]) {
      setMessageLanguage(message.storedMessage.id, targetLanguage);
      return;
    }

    const availableLanguages = Object.keys(message.storedMessage.data);
    if (availableLanguages.length === 0) {
      showError('Translation Failed', 'No available content to translate.');
      return;
    }

    const sourceLanguage = message.displayLanguage && message.storedMessage.data[message.displayLanguage]
      ? message.displayLanguage
      : availableLanguages[0];

    await translateMessage(message.storedMessage, sourceLanguage, targetLanguage);
  };

  const renderMessageContent = (
    message: DisplayMessageInfo,
    processed: { displayContent: React.ReactNode }
  ) => {
    return (
      <div className="message-content">
        {!message.hasRequestedLanguage && (
          <div className="language-fallback-badge">
            Using {message.fallbackLanguage || message.displayLanguage}
          </div>
        )}
        {processed.displayContent}
        {uiState.isLoading &&
          message.chatMessage.role === 'assistant' &&
          message === displayMessages[displayMessages.length - 1] && (
            <div className="typing-indicator inline">
              <span />
              <span />
              <span />
            </div>
          )}
      </div>
    );
  };

  const canTranslate = Boolean(secondaryLanguage && secondaryLanguage !== primaryLanguage);

  return (
    <div className={`chat-panel ${uiState.isChatVisible ? 'visible' : 'hidden'}`}>
      <div className="chat-header">
        <div className="chat-header-left">
          <button
            className="chat-list-btn"
            onClick={() => {
              if (window.innerWidth <= 768) {
                uiActions.setIsMobileSidebarVisible(true);
              } else {
                uiActions.setIsDesktopChatListVisible(!uiState.isDesktopChatListVisible);
              }
            }}
            title="View chat list"
          >
            Chats
          </button>
          <h2>{selectedChat?.name || 'AI Chat'}</h2>
        </div>
        <button
          className="chat-close-btn mobile-only"
          onClick={() => uiActions.setIsChatVisible(false)}
        >
          Close
        </button>
      </div>

      <div className="chat-messages">
        {displayMessages.length === 0 && (
          <div className="welcome-message">
            <div className="ai-avatar">AI</div>
            <div className="message-content">
              <p>Hello! I am here to help with your novel writing.</p>
              {currentProject && (
                <p>{`What can I help you with for the "${currentProject.name}" project?`}</p>
              )}
            </div>
          </div>
        )}

        {displayMessages.map((message, index) => {
          const isAssistant = message.chatMessage.role === 'assistant';
          const isUser = message.chatMessage.role === 'user';
          const isEditing = uiState.editingMessageId === message.chatMessage.id;
          const processingResult = chatPipeline.processForDisplay(message.chatMessage, displayContext);
          const isLastAssistantLoading = isAssistant && index === displayMessages.length - 1 && uiState.isLoading;
          const activeLanguage = messageLanguages[message.storedMessage.id] || primaryLanguage;

          const translateButtonLabel = !secondaryLanguage
            ? ''
            : activeLanguage === secondaryLanguage
              ? `View ${primaryLanguage}`
              : `View ${secondaryLanguage}`;

          const isTranslating = Boolean(translatingMessages[message.storedMessage.id]);

          return (
            <div
              key={message.chatMessage.id}
              className={`chat-message ${message.chatMessage.role}${isEditing ? ' editing' : ''}`}
            >
              <div className="message-wrapper">
                <div className="message-header">
                  <span className="message-role">{isUser ? 'You' : 'AI'}</span>
                  <span className="message-time">{formatTimestamp(message.chatMessage.timestamp)}</span>
                </div>

                {isEditing ? (
                  <div className="message-edit">
                    <textarea
                      ref={editTextareaRef}
                      value={uiState.editContent}
                      onChange={onEditContentChange}
                      placeholder={`Edit content`}
                    />
                    <div className="edit-actions">
                      <button
                        className="save-button"
                        onClick={() => onSaveEdit(
                          uiState.editingMessageId,
                          uiState.editContent,
                          uiState.editingLanguage || message.displayLanguage
                        )}
                      >
                        Save
                      </button>
                      <button className="cancel-button" onClick={onCancelEdit}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {renderMessageContent(message, processingResult)}

                    <div className="message-actions">
                      {translationErrors[message.storedMessage.id] && (
                        <div className="translation-error">{translationErrors[message.storedMessage.id]}</div>
                      )}
                      <div className="action-buttons">
                        {canTranslate && (
                          <button
                            className="action-btn translate-btn"
                            onClick={() => handleLanguageToggle(message)}
                            disabled={isTranslating}
                            title={translateButtonLabel}
                          >
                            {isTranslating ? '⟳' : '🌐'}
                          </button>
                        )}
                        <button
                          className="action-btn edit-btn"
                          onClick={() => onEditMessage(message.chatMessage.id, message.chatMessage.content, message.displayLanguage)}
                          disabled={isTranslating || !message.hasRequestedLanguage}
                          title="Edit"
                        >
                          ✎
                        </button>
                        <button
                          className="action-btn delete-btn"
                          onClick={() => onDeleteMessage(message.chatMessage.id)}
                          disabled={isTranslating}
                          title="Delete"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {isLastAssistantLoading && (
                <div className="typing-indicator inline">
                  <span />
                  <span />
                  <span />
                </div>
              )}

              {activeFunctionCalls[message.chatMessage.id] && activeFunctionCalls[message.chatMessage.id].length > 0 && (
                <div className="message-edit-cards">
                  <div className="function-call-indicator">
                    <div className="function-call-indicator-header">
                      <div className="function-call-indicator-text">AI is preparing function calls...</div>
                      <div className="function-call-spinner">
                        <div className="spinner" />
                      </div>
                    </div>
                    <div className="function-call-preview">
                      {activeFunctionCalls[message.chatMessage.id].map((call, idx) => (
                        <div key={idx} className="function-call-preview-item">
                          {call.function?.name || 'Function call'}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {messageEditCards[message.chatMessage.id] && (
                <div className="message-edit-cards">
                  {messageEditCards[message.chatMessage.id].map(card => (
                    <EditCardComponent key={card.id} card={card} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-container">
        <div className="chat-controls">
          <label className="system-insert-toggle">
            <input
              type="checkbox"
              checked={systemInsertConfig.enabled}
              onChange={(e) => setSystemInsertConfig(prev => ({
                ...prev,
                enabled: e.target.checked
              }))}
            />
            <span className="toggle-label">Include story context in messages</span>
          </label>
          <label className="system-insert-toggle">
            <input
              type="checkbox"
              checked={systemInsertConfig.includeNovelContent}
              onChange={(e) => setSystemInsertConfig(prev => ({
                ...prev,
                includeNovelContent: e.target.checked
              }))}
            />
            <span className="toggle-label">Include novel content in messages</span>
          </label>
        </div>

        <form onSubmit={(e) => onSubmit(e, uiState.input, uiState.isLoading)} className="chat-form">
          <div className="input-group">
            <textarea
              value={uiState.input}
              onChange={(e) => uiActions.setInput(e.target.value)}
              placeholder={`Enter a message in ${primaryLanguage}...`}
              rows={1}
              className="chat-input"
              disabled={uiState.isLoading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit(e as any, uiState.input, uiState.isLoading);
                }
              }}
            />
            {uiState.isLoading ? (
              <button type="button" onClick={onStop} className="stop-button">
                Stop
              </button>
            ) : (
              <button type="submit" className="send-button">
                Send
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChatPanel;
