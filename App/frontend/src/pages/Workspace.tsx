
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { useChatStore } from '../store/chatStore';
import { useStoryObjectStore } from '../store/storyObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { useErrorStore } from '../store/errorStore';
import { streamCopilot } from '../llm_request/copilot';
import { type ChatMessage, type FunctionCallMetadata } from '../llm_request/types';
import { ChatPipeline } from '../chat/ChatPipeline';
import type { ProcessedChatMessage, SystemInsertConfig, EditCard } from '../chat/types';
import { EditCardComponent, DefaultDisplayProcessor } from '../chat/processors/DisplayProcessor';
import { FunctionCallApplicator } from '../chat/utils/functionCallApplicator';
import { RuntimeProcessor, type RuntimeProcessingConfig, type RuntimeProcessingCallbacks } from '../chat/processors/RuntimeProcessor';

// Story Object Components
import BasicInfoManager from '../components/BasicInfoManager';
import NameDescriptionManager from '../components/NameDescriptionManager';
import OutlineManager from '../components/OutlineManager';
import ChatSidebar from '../components/ChatSidebar';
import ErrorModal from '../components/ErrorModal';

import '../chat/styles.css';
import './Workspace.css';

type TabType = 'basicInfo' | 'characters' | 'organizations' | 'locations' | 'lorebook' | 'outline';

const Workspace: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { getCurrentProject } = useProjectStore();
  const { 
    // Multi-chat methods
    getChats,
    getSelectedChatId,
    selectChat,
    createChat,
    getChatMessages,
    // Legacy methods (work with selected chat)
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
  const { currentError, showError, hideError } = useErrorStore();

  // UI State
  const [isChatVisible, setIsChatVisible] = useState(true);
  const [activeStoryTab, setActiveStoryTab] = useState<TabType>('basicInfo');
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [isMobileSidebarVisible, setIsMobileSidebarVisible] = useState(false);
  const [isDesktopChatListVisible, setIsDesktopChatListVisible] = useState(false);

  // Chat State
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
  const [editContent, setEditContent] = useState('');
  const [activeFunctionCalls, setActiveFunctionCalls] = useState<Record<string, any[]>>({});

  const currentProject = getCurrentProject();
  const chatHistory = getChatHistory(projectId || '');
  const storyObjects = getStoryObjects(projectId || '');

  // Initialize chat selection
  useEffect(() => {
    if (!projectId) return;
    
    const chats = getChats(projectId);
    const currentSelectedId = getSelectedChatId(projectId);
    
    if (chats.length === 0) {
      // No chats exist, create the first one
      const newChatId = createChat(projectId, 'Main Chat');
      setSelectedChatId(newChatId);
    } else if (!currentSelectedId) {
      // Chats exist but none selected, select the first one
      selectChat(projectId, chats[0].id);
      setSelectedChatId(chats[0].id);
    } else {
      // Use the currently selected chat
      setSelectedChatId(currentSelectedId);
    }
  }, [projectId]);

  const handleSelectChat = (chatId: string) => {
    if (!projectId) return;
    selectChat(projectId, chatId);
    setSelectedChatId(chatId);
    // Close sidebar when chat is selected
    setIsMobileSidebarVisible(false);
    setIsDesktopChatListVisible(false);
  };

  // Refs
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
    onNewEditTags: (messageId: string, editCards: any[]) => {
      const editTagsMetadata = editCards.map(card => ({
        id: card.id,
        type: card.type,
        content: card.data,
        summary: card.description,
        isApplied: card.isApplied,
        appliedAt: undefined
      }));
      
      // Edit tags are no longer supported
      
      const editCardsWithHandlers = editCards.map((card, index) => {
        const editTag = editTagsMetadata[index];
        return {
          ...card,
          onApply: createApplyHandler(messageId, editTag),
          onReject: createRejectHandler(messageId, card.id)
        };
      });
      
      setMessageEditCards(prev => ({
        ...prev,
        [messageId]: editCardsWithHandlers
      }));
    },
    onAddMessage: (projectId: string, message: ChatMessage) => {
      addMessage(projectId, message);
    },
    onGetChatHistory: (projectId: string) => {
      return getChatHistory(projectId);
    },
    onError: (error: Error) => {
      console.error('Runtime processing error:', error);
      showError('Chat Error', 'An error occurred during processing. Please try again.');
    },
    onFunctionCallsDetected: (messageId: string, functionCalls: any[]) => {
      setActiveFunctionCalls(prev => ({
        ...prev,
        [messageId]: functionCalls
      }));
    }
  };

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

  const displayContext = ChatPipeline.createContext(
    projectId || '',
    storyObjects,
    systemInsertConfig
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

  // Restore edit cards from persisted message metadata on initial load
  useEffect(() => {
    if (!projectId) return;
    
    const restoredEditCards: Record<string, EditCard[]> = {};
    
    chatHistory.forEach(message => {
      const processed = displayProcessor.process(message, {
        projectId,
        storyObjects,
        systemInsertConfig
      });
      
      if (processed.editCards.length > 0) {
        const editCardsWithHandlers = processed.editCards.map((card, index) => {
          if (message.role === 'assistant' && message.functionCalls) {
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
          
          return card;
        });
        
        restoredEditCards[message.id] = editCardsWithHandlers;
      }
    });
    
    setMessageEditCards(restoredEditCards);
  }, [projectId, chatHistory.length]);

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

  // Edit tags are no longer used - this function is kept for compatibility
  const createApplyHandler = (messageId: string, editTag: any) => {
    return async () => {
      console.log('Edit tags are no longer supported');
    };
  };

  const createRejectHandler = (messageId: string, tagId: string) => {
    return () => {
      if (!projectId) return;
      
      // Edit tags are no longer supported
      
      setMessageEditCards(prev => ({
        ...prev,
        [messageId]: prev[messageId]?.map(card => 
          card.id === tagId 
            ? { ...card, isApplied: true }
            : card
        ) || []
      }));
    };
  };

  const createFunctionCallApplyHandler = (messageId: string, functionCall: FunctionCallMetadata) => {
    return async () => {
      if (!projectId) return;

      try {
        const result = await functionCallApplicator.applyFunctionCall(projectId, functionCall);
        
        if (result.success) {
          updateFunctionCallStatus(projectId, messageId, functionCall.id, true, result);
          
          setMessageEditCards(prev => ({
            ...prev,
            [messageId]: prev[messageId]?.map(card => 
              card.id === functionCall.id 
                ? { ...card, isApplied: true }
                : card
            ) || []
          }));
          
          await runtimeProcessor.continueAfterFunctionCall(functionCall, true, result.message);
        } else {
          console.error('Failed to apply function call:', result.error || result.message);
          showError('Function Call Failed', `Failed to apply changes: ${result.error || result.message}`);
          
          updateFunctionCallStatus(projectId, messageId, functionCall.id, false, result, result.error);
        }
      } catch (error) {
        console.error('Error applying function call:', error);
        showError('Function Call Error', 'An error occurred while applying changes. Please try again.');
        
        updateFunctionCallStatus(projectId, messageId, functionCall.id, false, undefined, error instanceof Error ? error.message : 'Unknown error');
      }
    };
  };

  const createFunctionCallRejectHandler = (messageId: string, functionCall: FunctionCallMetadata) => {
    return async () => {
      if (!projectId) return;
      
      updateFunctionCallStatus(projectId, messageId, functionCall.id, true);
      
      setMessageEditCards(prev => ({
        ...prev,
        [messageId]: prev[messageId]?.map(card => 
          card.id === functionCall.id 
            ? { ...card, isApplied: true }
            : card
        ) || []
      }));
      
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
      setMessageEditCards(prev => {
        const updated = { ...prev };
        delete updated[messageId];
        return updated;
      });
    }
  };

  const storyTabs: { id: TabType; label: string; icon: string }[] = [
    { id: 'basicInfo', label: 'Basic Info', icon: '📋' },
    { id: 'characters', label: 'Characters', icon: '👥' },
    { id: 'organizations', label: 'Organizations', icon: '🏛️' },
    { id: 'locations', label: 'Locations', icon: '🗺️' },
    { id: 'lorebook', label: 'Lorebook', icon: '📚' },
    { id: 'outline', label: 'Outline', icon: '📝' },
  ];

  const renderStoryContent = () => {
    switch (activeStoryTab) {
      case 'basicInfo':
        return <BasicInfoManager />;
      case 'characters':
        return (
          <NameDescriptionManager
            category="character"
            title="Characters"
            singularName="Character"
            pluralName="Characters"
            placeholder={{
              name: 'Enter character name',
              description: 'Describe the character\'s appearance, personality, background, etc.'
            }}
          />
        );
      case 'organizations':
        return (
          <NameDescriptionManager
            category="organization"
            title="Organizations"
            singularName="Organization"
            pluralName="Organizations"
            placeholder={{
              name: 'Enter organization name',
              description: 'Describe the organization\'s purpose, structure, role, etc.'
            }}
          />
        );
      case 'locations':
        return (
          <NameDescriptionManager
            category="location"
            title="Locations"
            singularName="Location"
            pluralName="Locations"
            placeholder={{
              name: 'Enter location name',
              description: 'Describe the location\'s features, atmosphere, importance, etc.'
            }}
          />
        );
      case 'lorebook':
        return (
          <NameDescriptionManager
            category="lorebook"
            title="Lorebook"
            singularName="Entry"
            pluralName="Entries"
            placeholder={{
              name: 'Enter term or concept name',
              description: 'Write a detailed description of this term or concept'
            }}
          />
        );
      case 'outline':
        return <OutlineManager />;
      default:
        return <BasicInfoManager />;
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
    <div className="workspace-container">
      {/* Header */}
      <div className="workspace-header">
        <div className="breadcrumb">
          <Link to="/" className="breadcrumb-link">Home</Link>
          <span className="breadcrumb-separator"> / </span>
          <Link to={`/project/${projectId}`} className="breadcrumb-link">
            {currentProject.name}
          </Link>
          <span className="breadcrumb-separator"> / </span>
          <span className="breadcrumb-current">Workspace</span>
        </div>
        <div className="workspace-title">
          <h1>{currentProject.name} - Workspace</h1>
          <div className="workspace-controls">
            <button 
              className={`chat-toggle-btn mobile-only ${isChatVisible ? 'active' : ''}`}
              onClick={() => {
                setIsChatVisible(!isChatVisible);
                setIsMobileSidebarVisible(false); // Always close sidebar when opening chat
              }}
            >
              💬 Chat
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className={`workspace-content ${isChatVisible ? 'chat-visible' : ''}`}>
        {/* Chat Sidebar */}
        <ChatSidebar 
          projectId={projectId || ''}
          onSelectChat={handleSelectChat}
          isMobileVisible={isMobileSidebarVisible}
          isDesktopVisible={isDesktopChatListVisible}
        />

        {/* Chat Panel */}
        <div className={`chat-panel ${isChatVisible ? 'visible' : 'hidden'}`}>
          <div className="chat-header">
            <div className="chat-header-left">
              <button 
                className="chat-list-btn"
                onClick={() => {
                  if (window.innerWidth <= 768) {
                    setIsMobileSidebarVisible(true);
                  } else {
                    setIsDesktopChatListVisible(!isDesktopChatListVisible);
                  }
                }}
                title="View chat list"
              >
                📋
              </button>
              <h2>💬 {selectedChatId ? getChats(projectId || '').find(chat => chat.id === selectedChatId)?.name || 'AI Chat' : 'AI Chat'}</h2>
            </div>
            <button 
              className="chat-close-btn mobile-only"
              onClick={() => setIsChatVisible(false)}
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
              
              const isSystemMessage = message.content && 
                typeof message.content === 'string' && 
                /<system>[\s\S]*?<\/system>/i.test(message.content) &&
                message.role === 'user';
              
              return (
                <div key={message.id}>
                  {!isSystemMessage && (
                    <div className={`message ${message.role}`}>
                      <div className="message-avatar">
                        {message.role === 'user' ? '👤' : '🤖'}
                      </div>
                      <div className="message-content">
                        {editingMessageId === message.id ? (
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
                          <>
                            <div className="message-text-container">
                              {message.role === 'assistant' ? (
                                chatPipeline.processForDisplay({ ...message }, displayContext).displayContent
                              ) : (
                                <div className="message-text">{message.content}</div>
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

        {/* Story Editor Panel */}
        <div className="story-panel">
          <div className="story-header">
            <h2>📋 Story Objects</h2>
          </div>

          <div className="story-tabs">
            {storyTabs.map((tab) => (
              <button
                key={tab.id}
                className={`tab-button ${activeStoryTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveStoryTab(tab.id)}
              >
                <span className="tab-icon">{tab.icon}</span>
                <span className="tab-label">{tab.label}</span>
              </button>
            ))}
          </div>

          <div className="story-content">
            {renderStoryContent()}
          </div>
        </div>
      </div>

      {/* Mobile Chat Overlay */}
      {isChatVisible && (
        <div className="chat-overlay mobile-only" onClick={() => setIsChatVisible(false)} />
      )}

      {/* Mobile Sidebar Overlay */}
      {isMobileSidebarVisible && (
        <div className="sidebar-overlay mobile-only" onClick={() => setIsMobileSidebarVisible(false)} />
      )}

      {/* Error Modal */}
      <ErrorModal
        isOpen={!!currentError}
        title={currentError?.title || ''}
        message={currentError?.message || ''}
        onClose={hideError}
      />

    </div>
  );
};

export default Workspace;