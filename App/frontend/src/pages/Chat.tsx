import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { useChatStore } from '../store/chatStore';
import { useStoryObjectStore } from '../store/storyObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { streamCopilot } from '../llm_request/copilot';
import { type ChatMessage, type FunctionCallMetadata } from '../llm_request/types';
import { ChatPipeline } from '../chat/ChatPipeline';
import type { ProcessedChatMessage, SystemInsertConfig, EditCard } from '../chat/types';
import { EditCardComponent, DefaultDisplayProcessor } from '../chat/processors/DisplayProcessor';
import { FunctionCallApplicator } from '../chat/utils/functionCallApplicator';
import { RuntimeProcessor, type RuntimeProcessingConfig, type RuntimeProcessingCallbacks } from '../chat/processors/RuntimeProcessor';
import '../chat/styles.css';

const Chat: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { getCurrentProject } = useProjectStore();
  const { 
    addMessage, 
    updateMessage, 
 
    getChatHistory, 
    editMessage, 
    deleteMessage,
    updateMessageFunctionCalls,
    updateFunctionCallStatus
  } = useChatStore();
  const storyObjectStore = useStoryObjectStore();
  const { getStoryObjects } = storyObjectStore;
  const { settings } = useSettingsStore();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [systemInsertConfig, setSystemInsertConfig] = useState<SystemInsertConfig>(
    ChatPipeline.createDefaultSystemConfig()
  );
  const [chatPipeline] = useState(() => new ChatPipeline());
  const [messageEditCards, setMessageEditCards] = useState<Record<string, EditCard[]>>({});
  const [functionCallApplicator] = useState(() => new FunctionCallApplicator(storyObjectStore));
  const [displayProcessor] = useState(() => new DefaultDisplayProcessor());
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [activeFunctionCalls, setActiveFunctionCalls] = useState<Record<string, any[]>>({});

  const currentProject = getCurrentProject();
  const chatHistory = getChatHistory(projectId || '');
  const storyObjects = getStoryObjects(projectId || '');

  // Refs 먼저 선언
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const runtimeCallbacks: RuntimeProcessingCallbacks = {
    onNewMessage: (messageId: string, content: string) => {
      updateMessage(projectId || '', messageId, content);
    },
    onNewFunctionCalls: (messageId: string, functionCalls: FunctionCallMetadata[]) => {
      updateMessageFunctionCalls(projectId || '', messageId, functionCalls);
      
      const functionCallCards = functionCalls.map(funcCall => ({
        id: funcCall.id,
        type: mapFunctionToEditType(funcCall.function_name),
        title: getFunctionCallTitle(funcCall.function_name),
        description: generateFunctionCallSummary(funcCall.function_name, funcCall.arguments),
        isApplied: funcCall.isApplied,
        data: funcCall.arguments,
        onApply: createFunctionCallApplyHandler(messageId, funcCall),
        onReject: createFunctionCallRejectHandler(messageId, funcCall)
      }));
      
      setMessageEditCards(prev => ({
        ...prev,
        [messageId]: functionCallCards
      }));
      
      // Clear active function calls as they're now finalized
      setActiveFunctionCalls(prev => {
        const updated = { ...prev };
        delete updated[messageId];
        return updated;
      });
    },
    onAddMessage: (projectId: string, message: ChatMessage) => {
      addMessage(projectId, message);
    },
    onGetChatHistory: (projectId: string) => {
      return getChatHistory(projectId);
    },
    onError: (error: Error) => {
      console.error('Runtime processing error:', error);
      alert('An error occurred during processing. Please try again.');
    },
    onFunctionCallsDetected: (messageId: string, functionCalls: any[]) => {
      setActiveFunctionCalls(prev => ({
        ...prev,
        [messageId]: functionCalls
      }));
    }
  };

  // RuntimeProcessor는 매번 새로운 config로 업데이트
  const runtimeProcessor = useMemo(() => {
    const updatedConfig = {
      projectId: projectId || '',
      getStoryObjects: () => getStoryObjects(projectId || ''), // Use function to get fresh data
      systemInsertConfig,
      chatPipeline,
      isLoading,
      setIsLoading,
      abortControllerRef,
      outputLanguage: settings.outputLanguage,
      aiModel: settings.aiModel
    };
    return new RuntimeProcessor(updatedConfig, runtimeCallbacks);
  }, [projectId, systemInsertConfig, isLoading, getStoryObjects, settings]); // Removed storyObjects from deps since we get it dynamically
  const [editContent, setEditContent] = useState('');

  // Create pipeline context for message display
  const displayContext = ChatPipeline.createContext(
    projectId || '',
    storyObjects, // Keep using storyObjects for display context (this is for message display, not streaming)
    systemInsertConfig
  );

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory]);

  // Restore edit cards from persisted message metadata on initial load
  useEffect(() => {
    if (!projectId) return;
    
    const restoredEditCards: Record<string, EditCard[]> = {};
    
    chatHistory.forEach(message => {
      // Process both user and assistant messages for system cards and edit cards
      // Use DisplayProcessor to properly process all types of cards including system cards
      const processed = displayProcessor.process(message, {
        projectId,
        storyObjects,
        systemInsertConfig
      });
      
      if (processed.editCards.length > 0) {
        // Set up handlers for the edit cards
        const editCardsWithHandlers = processed.editCards.map((card, index) => {
          if (message.role === 'assistant' && message.functionCalls) {
            // Function call cards (only for assistant messages)
            const funcCall = message.functionCalls.find(fc => fc.id === card.id);
            if (funcCall) {
              return {
                ...card,
                onApply: createFunctionCallApplyHandler(message.id, funcCall),
                onReject: createFunctionCallRejectHandler(message.id, funcCall)
              };
            }
          }
          
          // Edit tags are no longer supported
          
          // System cards (from user messages) or other cards without specific handlers
          return card;
        });
        
        restoredEditCards[message.id] = editCardsWithHandlers;
      }
    });
    
    setMessageEditCards(restoredEditCards);
  }, [projectId, chatHistory.length]); // Only re-run when chat history length changes

  // Function call mapping functions
  const mapFunctionToEditType = (functionName: string): any => {
    switch (functionName) {
      case 'initialize_story_objects': return 'init';
      case 'add_story_objects': return 'add';
      case 'edit_story_objects': return 'edit';
      case 'remove_story_objects': return 'remove';
      default: return 'edit';
    }
  };

  const getFunctionCallTitle = (functionName: string): string => {
    switch (functionName) {
      case 'initialize_story_objects': return '🔄 Initialize Story';
      case 'add_story_objects': return '➕ Add Items';
      case 'edit_story_objects': return '✏️ Edit Items';
      case 'remove_story_objects': return '🗑️ Remove Items';
      default: return '📝 Function Call';
    }
  };

  const generateFunctionCallSummary = (functionName: string, args: any): string => {
    if (!args) return getFunctionCallDescription(functionName);
    
    const parts: string[] = [];
    
    switch (functionName) {
      case 'initialize_story_objects':
        if (args.basic_info) parts.push('basic info');
        if (args.characters?.length) parts.push(`${args.characters.length} character${args.characters.length > 1 ? 's' : ''}`);
        if (args.organizations?.length) parts.push(`${args.organizations.length} organization${args.organizations.length > 1 ? 's' : ''}`);
        if (args.locations?.length) parts.push(`${args.locations.length} location${args.locations.length > 1 ? 's' : ''}`);
        if (args.lorebook?.length) parts.push(`${args.lorebook.length} lorebook entr${args.lorebook.length > 1 ? 'ies' : 'y'}`);
        if (args.acts?.length) parts.push(`${args.acts.length} act${args.acts.length > 1 ? 's' : ''}`);
        break;
        
      case 'add_story_objects':
        if (args.characters?.length) parts.push(`${args.characters.length} character${args.characters.length > 1 ? 's' : ''}`);
        if (args.organizations?.length) parts.push(`${args.organizations.length} organization${args.organizations.length > 1 ? 's' : ''}`);
        if (args.locations?.length) parts.push(`${args.locations.length} location${args.locations.length > 1 ? 's' : ''}`);
        if (args.lorebook?.length) parts.push(`${args.lorebook.length} lorebook entr${args.lorebook.length > 1 ? 'ies' : 'y'}`);
        if (args.acts?.length) parts.push(`${args.acts.length} act${args.acts.length > 1 ? 's' : ''}`);
        if (args.chapters?.length) parts.push(`${args.chapters.length} chapter${args.chapters.length > 1 ? 's' : ''}`);
        break;
        
      case 'edit_story_objects':
        if (args.basic_info) parts.push('basic info');
        if (args.objects?.length) parts.push(`${args.objects.length} object${args.objects.length > 1 ? 's' : ''}`);
        break;
        
      case 'remove_story_objects':
        if (args.objects?.length) parts.push(`${args.objects.length} object${args.objects.length > 1 ? 's' : ''}`);
        break;
    }
    
    return parts.length > 0 
      ? `${getFunctionCallDescription(functionName)}: ${parts.join(', ')}`
      : getFunctionCallDescription(functionName);
  };

  const getFunctionCallDescription = (functionName: string): string => {
    switch (functionName) {
      case 'initialize_story_objects': return 'Initialize all story objects for the project';
      case 'add_story_objects': return 'Add new story objects to the project';
      case 'edit_story_objects': return 'Modify existing story objects';
      case 'remove_story_objects': return 'Remove story objects from the project';
      default: return 'Execute function call';
    }
  };

  // Function call handlers
  const createFunctionCallApplyHandler = (messageId: string, functionCall: FunctionCallMetadata) => {
    return async () => {
      if (!projectId) return;

      try {
        const result = await functionCallApplicator.applyFunctionCall(projectId, functionCall);
        
        if (result.success) {
          // Mark as applied in the chat store
          updateFunctionCallStatus(projectId, messageId, functionCall.id, true, result);
          
          // Update the messageEditCards state immediately for real-time UI update
          setMessageEditCards(prev => ({
            ...prev,
            [messageId]: prev[messageId]?.map(card => 
              card.id === functionCall.id 
                ? { ...card, isApplied: true }
                : card
            ) || []
          }));          
          // 자동으로 다음 스트리밍 시작
          await runtimeProcessor.continueAfterFunctionCall(functionCall, true, result.message);
        } else {
          console.error('Failed to apply function call:', result.error || result.message);
          alert(`Failed to apply changes: ${result.error || result.message}`);
          
          // Mark as failed
          updateFunctionCallStatus(projectId, messageId, functionCall.id, false, result, result.error);
        }
      } catch (error) {
        console.error('Error applying function call:', error);
        alert('An error occurred while applying changes. Please try again.');
        
        // Mark as failed
        updateFunctionCallStatus(projectId, messageId, functionCall.id, false, undefined, error instanceof Error ? error.message : 'Unknown error');
      }
    };
  };

  const createFunctionCallRejectHandler = (messageId: string, functionCall: FunctionCallMetadata) => {
    return async () => {
      if (!projectId) return;
      
      // Mark as processed but rejected in the chat store
      updateFunctionCallStatus(projectId, messageId, functionCall.id, true);
      
      // Update the messageEditCards state immediately for real-time UI update
      setMessageEditCards(prev => ({
        ...prev,
        [messageId]: prev[messageId]?.map(card => 
          card.id === functionCall.id 
            ? { ...card, isApplied: true }
            : card
        ) || []
      }));      
      // 자동으로 다음 스트리밍 시작
      await runtimeProcessor.continueAfterFunctionCall(functionCall, false, 'User rejected the function call');
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !projectId || isLoading) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setInput('');

    // RuntimeProcessor를 통해 처리
    await runtimeProcessor.processUserMessage(userMessage);
  };

  const handleStop = () => {
    runtimeProcessor.abort();
  };

  const adjustTextareaHeight = () => {
    if (editTextareaRef.current) {
      editTextareaRef.current.style.height = 'auto';
      editTextareaRef.current.style.height = `${editTextareaRef.current.scrollHeight}px`;
    }
  };

  const handleEditMessage = (messageId: string, content: string | null) => {
    if (!content) return;
    setEditingMessageId(messageId);
    setEditContent(content);
    // Use setTimeout to ensure the textarea is rendered before adjusting height
    setTimeout(() => {
      adjustTextareaHeight();
    }, 0);
  };

  const handleEditContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditContent(e.target.value);
    adjustTextareaHeight();
  };

  const handleSaveEdit = () => {
    if (!projectId || !editingMessageId) return;
    editMessage(projectId, editingMessageId, editContent);
    setEditingMessageId(null);
    setEditContent('');
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditContent('');
  };

  const handleDeleteMessage = (messageId: string) => {
    if (!projectId) return;
    if (confirm('Are you sure you want to delete this message?')) {
      deleteMessage(projectId, messageId);
      // Also remove any edit cards for this message (both function calls and legacy edit tags)
      setMessageEditCards(prev => {
        const updated = { ...prev };
        delete updated[messageId];
        return updated;
      });
    }
  };

  if (!currentProject) {
    return (
      <div className="error-container">
        <h2>Project Not Found</h2>
        <Link to="/">Go back to Home</Link>
      </div>
    );
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div className="breadcrumb">
          <Link to="/" className="breadcrumb-link">Home</Link>
          <span className="breadcrumb-separator"> / </span>
          <Link to={`/project/${projectId}`} className="breadcrumb-link">
            {currentProject.name}
          </Link>
          <span className="breadcrumb-separator"> / </span>
          <span className="breadcrumb-current">AI Chat</span>
        </div>
        <h1>AI Chat</h1>
        <p>Develop your novel ideas by chatting with the AI</p>
      </div>

      <div className="chat-messages">
        {chatHistory.length === 0 && (
          <div className="welcome-message">
            <div className="ai-avatar">🤖</div>
            <div className="message-content">
              <p>Hello! I am an AI assistant to help you with your novel writing.</p>
              <p>What can I help you with for the "{currentProject.name}" project?</p>
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
            isLoading;
          
          // Check if this is a system message (contains system tags and should only show as cards)
          const isSystemMessage = message.content && 
            typeof message.content === 'string' && 
            /<system>[\s\S]*?<\/system>/i.test(message.content) &&
            message.role === 'user';
          
          return (
            <div key={message.id}>
              {/* Only render message bubble if it's not a pure system message */}
              {!isSystemMessage && (
                <div className={`message ${message.role}`}>
                <div className="message-avatar">
                  {message.role === 'user' ? '👤' : '🤖'}
                </div>
                <div className="message-content">
                  {editingMessageId === message.id ? (
                    // Edit mode
                    <div className="message-edit-form">
                      <textarea
                        ref={editTextareaRef}
                        value={editContent}
                        onChange={handleEditContentChange}
                        className="message-edit-textarea"
                        placeholder="Edit your message..."
                      />
                      <div className="message-edit-buttons">
                        <button onClick={handleSaveEdit} className="save-edit-button">
                          Save
                        </button>
                        <button onClick={handleCancelEdit} className="cancel-edit-button">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    // Display mode
                    <>
                      <div className="message-text-container">
                        {message.role === 'assistant' ? (
                          // Process AI messages for display
                          chatPipeline.processForDisplay({ ...message }, displayContext).displayContent
                        ) : (
                          // Show user messages as is
                          <div className="message-text">{message.content}</div>
                        )}
                        
                        {/* 스트리밍 중인 마지막 AI 메시지에 타이핑 애니메이션 추가 */}
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
                        <div className="message-actions">
                          <button 
                            onClick={() => handleEditMessage(message.id, message.content)} 
                            className="message-action-button edit-button"
                            title="Edit message"
                          >
                            ✏️
                          </button>
                          <button 
                            onClick={() => handleDeleteMessage(message.id)} 
                            className="message-action-button delete-button"
                            title="Delete message"
                          >
                            🗑️
                          </button>
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
              
              {/* Edit Cards for this specific message */}
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
        {/* System Insert Toggle */}
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
        </div>
        
        <form onSubmit={handleSubmit} className="chat-form">
          <div className="input-group">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter a message..."
              rows={1}
              className="chat-input"
              disabled={isLoading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e as any);
                }
              }}
            />
            {isLoading ? (
              <button type="button" onClick={handleStop} className="stop-button">
                Stop
              </button>
            ) : (
              <button type="submit" disabled={!input.trim()} className="send-button">
                Send
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default Chat;