import React, { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { useChatStore } from '../store/chatStore';
import { useStoryObjectStore } from '../store/storyObjectStore';
import { streamCopilot } from '../llm_request/copilot';
import { type ChatMessage } from '../llm_request/types';
import { ChatPipeline } from '../chat/ChatPipeline';
import type { ProcessedChatMessage, SystemInsertConfig, EditCard } from '../chat/types';
import { EditCardComponent } from '../chat/processors/DisplayProcessor';
import { EditTagApplicator } from '../chat/utils/editTagApplicator';
import '../chat/styles.css';

const Chat: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { getCurrentProject } = useProjectStore();
  const { addMessage, updateMessage, updateMessageEditTags, updateEditTagStatus, getChatHistory } = useChatStore();
  const storyObjectStore = useStoryObjectStore();
  const { getStoryObjects } = storyObjectStore;
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [systemInsertConfig, setSystemInsertConfig] = useState<SystemInsertConfig>(
    ChatPipeline.createDefaultSystemConfig()
  );
  const [chatPipeline] = useState(() => new ChatPipeline());
  const [messageEditCards, setMessageEditCards] = useState<Record<string, EditCard[]>>({});
  const [editTagApplicator] = useState(() => new EditTagApplicator(storyObjectStore));
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const currentProject = getCurrentProject();
  const chatHistory = getChatHistory(projectId || '');
  const storyObjects = getStoryObjects(projectId || '');

  // Create pipeline context for message display
  const displayContext = ChatPipeline.createContext(
    projectId || '',
    storyObjects,
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
      if (message.role === 'assistant' && message.editTags && message.editTags.length > 0) {
        const editCards = message.editTags.map(tag => ({
          id: tag.id,
          type: tag.type,
          title: getCardTitleFromType(tag.type),
          description: tag.summary,
          isApplied: tag.isApplied,
          data: tag.content,
          onApply: createApplyHandler(message.id, tag),
          onReject: createRejectHandler(message.id, tag.id)
        }));
        
        restoredEditCards[message.id] = editCards;
      }
    });
    
    setMessageEditCards(restoredEditCards);
  }, [projectId]); // Only run when projectId changes

  const getCardTitleFromType = (type: string): string => {
    switch (type) {
      case 'init': return '🔄 Initialize Story';
      case 'add': return '➕ Add Items';
      case 'edit': return '✏️ Edit Items';
      case 'remove': return '🗑️ Remove Items';
      default: return '📝 Edit';
    }
  };

  const createApplyHandler = (messageId: string, editTag: any) => {
    return async () => {
      if (!projectId) return;

      try {
        const result = await editTagApplicator.applyEditTag(projectId, editTag);
        
        if (result.success) {
          // Mark as applied in the chat store
          updateEditTagStatus(projectId, messageId, editTag.id, true);
          
          // Update the messageEditCards state immediately for real-time UI update
          setMessageEditCards(prev => ({
            ...prev,
            [messageId]: prev[messageId]?.map(card => 
              card.id === editTag.id 
                ? { ...card, isApplied: true }
                : card
            ) || []
          }));
          
          console.log('Successfully applied edit tag:', result.message);
        } else {
          console.error('Failed to apply edit tag:', result.error || result.message);
          alert(`Failed to apply changes: ${result.error || result.message}`);
        }
      } catch (error) {
        console.error('Error applying edit tag:', error);
        alert('An error occurred while applying changes. Please try again.');
      }
    };
  };

  const createRejectHandler = (messageId: string, tagId: string) => {
    return () => {
      if (!projectId) return;
      
      // Mark as processed but rejected in the chat store
      updateEditTagStatus(projectId, messageId, tagId, true);
      
      // Update the messageEditCards state immediately for real-time UI update
      setMessageEditCards(prev => ({
        ...prev,
        [messageId]: prev[messageId]?.map(card => 
          card.id === tagId 
            ? { ...card, isApplied: true }
            : card
        ) || []
      }));
      
      console.log('Rejecting edit tag:', tagId, 'from message:', messageId);
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

    addMessage(projectId, userMessage);
    setInput('');
    setIsLoading(true);

    const assistantMessageId = crypto.randomUUID();
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };

    addMessage(projectId, assistantMessage);

    try {
      // Create pipeline context
      const context = ChatPipeline.createContext(
        projectId,
        storyObjects,
        systemInsertConfig
      );

      // Debug: Log pipeline context
      console.log('=== DEBUG: Pipeline Context ===');
      console.log('Project ID:', projectId);
      console.log('System Insert Config:', systemInsertConfig);
      console.log('Story Objects:', storyObjects);
      console.log('=== END DEBUG ===');

      // Pre-process messages
      const { conversationBlocks } = chatPipeline.preProcess(
        chatHistory,
        userMessage,
        context
      );

      // Debug: Log conversation blocks being sent to AI
      console.log('=== DEBUG: Conversation blocks sent to AI ===');
      conversationBlocks.forEach((block, index) => {
        console.log(`Block ${index} (${block.role}):`);
        console.log(block.content);
        console.log('---');
      });
      console.log('=== END DEBUG ===');

      abortControllerRef.current = new AbortController();
      
      let accumulatedContent = '';
      for await (const chunk of streamCopilot(conversationBlocks, {
        signal: abortControllerRef.current.signal,
      })) {
        accumulatedContent += chunk;
        updateMessage(projectId, assistantMessageId, accumulatedContent);
      }

      // Post-process the final AI response
      const { message: processedMessage } = chatPipeline.postProcess(
        accumulatedContent,
        context
      );

      // Process for display and generate edit cards
      const { editCards } = chatPipeline.processForDisplay(processedMessage, context);
      
      // Save edit tags to message metadata
      if (editCards.length > 0) {
        const editTagsMetadata = editCards.map(card => ({
          id: card.id,
          type: card.type,
          content: card.data,
          summary: card.description,
          isApplied: card.isApplied,
          appliedAt: undefined
        }));
        
        updateMessageEditTags(projectId, assistantMessageId, editTagsMetadata);
        
        // Create edit cards with correct handlers
        const editCardsWithHandlers = editCards.map((card, index) => {
          const editTag = editTagsMetadata[index];
          return {
            ...card,
            onApply: createApplyHandler(assistantMessageId, editTag),
            onReject: createRejectHandler(assistantMessageId, card.id)
          };
        });
        
        setMessageEditCards(prev => ({
          ...prev,
          [assistantMessageId]: editCardsWithHandlers
        }));
      }

    } catch (error) {
      console.error('Chat error:', error);
      if (error instanceof Error && error.name !== 'AbortError') {
        updateMessage(
          projectId,
          assistantMessageId,
          'Sorry, an error occurred while generating a response. Please try again.'
        );
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
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

        {chatHistory.map((message) => (
          <div key={message.id}>
            <div className={`message ${message.role}`}>
              <div className="message-avatar">
                {message.role === 'user' ? '👤' : '🤖'}
              </div>
              <div className="message-content">
                {message.role === 'assistant' ? (
                  // Process AI messages for display
                  chatPipeline.processForDisplay({ ...message }, displayContext).displayContent
                ) : (
                  // Show user messages as is
                  <div className="message-text">{message.content}</div>
                )}
                <div className="message-time">
                  {message.timestamp.toLocaleTimeString()}
                </div>
              </div>
            </div>
            
            {/* Edit Cards for this specific message */}
            {message.role === 'assistant' && messageEditCards[message.id] && (
              <div className="message-edit-cards">
                {messageEditCards[message.id].map(card => (
                  <EditCardComponent key={card.id} card={card} />
                ))}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="message assistant">
            <div className="message-avatar">🤖</div>
            <div className="message-content">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}

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