import React, { useRef, useEffect } from 'react';
import { useChatStore } from '../../../store/chatStore';
import { useProjectStore } from '../../../store/projectStore';
import { ChatPipeline } from '../../../chat/ChatPipeline';
import { EditCardComponent } from '../../../chat/processors/DisplayProcessor';
import type { SystemInsertConfig, EditCard } from '../../../chat/types';
import type { WorkspaceUIState, WorkspaceUIActions } from '../hooks/useWorkspaceState';

interface ChatPanelProps {
  projectId: string;
  uiState: WorkspaceUIState;
  uiActions: WorkspaceUIActions;
  systemInsertConfig: SystemInsertConfig;
  setSystemInsertConfig: (config: SystemInsertConfig | ((prev: SystemInsertConfig) => SystemInsertConfig)) => void;
  chatPipeline: ChatPipeline;
  storyObjects: any;
  novelData?: any; // Novel content data for NovelEditor context
  messageEditCards: Record<string, EditCard[]>;
  activeFunctionCalls: Record<string, any[]>;
  onSubmit: (e: React.FormEvent, input: string, isLoading: boolean) => Promise<void>;
  onStop: () => void;
  onEditMessage: (messageId: string, content: string | null) => void;
  onEditContentChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSaveEdit: (editingMessageId: string | null, editContent: string) => void;
  onCancelEdit: () => void;
  onDeleteMessage: (messageId: string) => void;
  editTextareaRef: React.RefObject<HTMLTextAreaElement>;
  mode: 'novel-editor' | 'workspace'; // Add mode prop
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
  const { getChats, getChatHistory } = useChatStore();
  const { getCurrentProject } = useProjectStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const currentProject = getCurrentProject();
  const chatHistory = getChatHistory(projectId);

  const displayContext = ChatPipeline.createContext(
    projectId,
    storyObjects,
    mode,
    systemInsertConfig,
    novelData
  );

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      const chatMessagesContainer = messagesEndRef.current.closest('.chat-messages');
      if (chatMessagesContainer) {
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
      }
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory]);

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
            📋
          </button>
          <h2>💬 {uiState.selectedChatId ? getChats(projectId).find(chat => chat.id === uiState.selectedChatId)?.name || 'AI Chat' : 'AI Chat'}</h2>
        </div>
        <button 
          className="chat-close-btn mobile-only"
          onClick={() => uiActions.setIsChatVisible(false)}
        >
          ✕
        </button>
      </div>

      <div className="chat-messages">
        {chatHistory.length === 0 && (
          <div className="welcome-message">
            <div className="ai-avatar">🤖</div>
            <div className="message-content">
              <p>Hello! I am an AI assistant to help you with your novel writing.</p>
              <p>What can I help you with for the "{currentProject?.name}" project?</p>
              <ul>
                <li>📖 Brainstorming story ideas</li>
                <li>👥 Character development and setup</li>
                <li>🏛️ Building backgrounds and worldviews</li>
                <li>📝 Advice on writing style or genre</li>
                <li>🎯 Plot construction and development</li>
              </ul>
            </div>
          </div>
        )}

        {chatHistory.map((message, index) => {
          const isLastAssistantMessage = message.role === 'assistant' && 
            index === chatHistory.length - 1 &&
            uiState.isLoading;
          
          return (
            <div key={message.id}>
              {(
                <div className={`message ${message.role}`}>
                  <div className="message-wrapper">
                    {uiState.editingMessageId === message.id ? (
                      <div className="message-content-edit">
                        <div className="message-edit-form">
                          <textarea
                            ref={editTextareaRef}
                            value={uiState.editContent}
                            onChange={onEditContentChange}
                            className="message-edit-textarea"
                            placeholder="Edit your message..."
                          />
                          <div className="message-edit-buttons">
                            <button onClick={() => onSaveEdit(uiState.editingMessageId, uiState.editContent)} className="save-edit-button">
                              Save
                            </button>
                            <button onClick={onCancelEdit} className="cancel-edit-button">
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="message-actions-top">
                          <button 
                            onClick={() => onEditMessage(message.id, message.content)} 
                            className="message-action-button edit-button"
                            title="Edit message"
                          >
                            ✏️
                          </button>
                          <button 
                            onClick={() => onDeleteMessage(message.id)} 
                            className="message-action-button delete-button"
                            title="Delete message"
                          >
                            🗑️
                          </button>
                        </div>
                        
                        <div className="message-content">
                          {message.role === 'assistant' ? (
                            chatPipeline.processForDisplay({ ...message }, displayContext).displayContent
                          ) : (
                            chatPipeline.processForDisplay({ ...message }, displayContext).displayContent
                          )}
                          
                          {isLastAssistantMessage && (
                            <div className="typing-indicator inline">
                              <span></span>
                              <span></span>
                              <span></span>
                            </div>
                          )}
                        </div>
                        
                        <div className="message-footer">
                          <div className="message-time">
                            {message.timestamp.toLocaleTimeString()}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
              
              {/* Function Call Indicator during streaming */}
              {activeFunctionCalls[message.id] && activeFunctionCalls[message.id].length > 0 && (
                <div className="message-edit-cards">
                  <div className="function-call-indicator">
                    <div className="function-call-indicator-header">
                      <div className="function-call-indicator-icon">⚡</div>
                      <div className="function-call-indicator-text">
                        AI is preparing function calls...
                      </div>
                      <div className="function-call-spinner">
                        <div className="spinner"></div>
                      </div>
                    </div>
                    <div className="function-call-preview">
                      {activeFunctionCalls[message.id].map((call, index) => (
                        <div key={index} className="function-call-preview-item">
                          📝 {call.function?.name || 'Function call'}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              
              {messageEditCards[message.id] && (
                <div className="message-edit-cards">
                  {messageEditCards[message.id].map(card => (
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
            <span className="toggle-label">
              📋 Include story context in messages
            </span>
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
            <span className="toggle-label">
              📖 Include novel content in messages
            </span>
          </label>
        </div>
        
        <form onSubmit={(e) => onSubmit(e, uiState.input, uiState.isLoading)} className="chat-form">
          <div className="input-group">
            <textarea
              value={uiState.input}
              onChange={(e) => uiActions.setInput(e.target.value)}
              placeholder="Enter a message..."
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