import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { useChatStore } from '../store/chatStore';
import { useStoryObjectStore } from '../store/storyObjectStore';
import { useNovelStore } from '../store/novelStore';
import { useSettingsStore } from '../store/settingsStore';
import { useErrorStore } from '../store/errorStore';
import { type ChatMessage } from '../llm_request/types';
import { ChatPipeline } from '../chat/ChatPipeline';
import type { SystemInsertConfig } from '../chat/types';
import { DefaultDisplayProcessor } from '../chat/processors/DisplayProcessor';
import { ChatManager, type ChatManagerCallbacks } from '../chat/processors/ChatManager';
import { NOVEL_EDITOR_FUNCTIONS } from '../chat/types/functionCalling';

// Novel Editor Components
import ChatSidebar from '../components/ChatSidebar';
import ErrorModal from '../components/ErrorModal';
import SettingsModal from '../components/SettingsModal';
import ChatPanel from './workspace/components/ChatPanel';
import NovelEditorPanel from './noveleditor/components/NovelEditorPanel';

// Novel Editor Hooks
import { useNovelEditorState } from './noveleditor/hooks/useNovelEditorState';
import { useChatHandlers } from './workspace/hooks/useChatHandlers';
import { useNovelEditorFunctionCallHandlers } from './noveleditor/hooks/useNovelEditorFunctionCallHandlers';

import './NovelEditor.css';
import './workspace/styles/ChatPanel.css';
import './workspace/styles/ChatHeader.css';
import './workspace/styles/ChatMessages.css';
import './workspace/styles/MessageEdit.css';
import './workspace/styles/ChatInput.css';
import './workspace/styles/ChatSidebar.css';
import './workspace/styles/MessageEditCards.css';

const NovelEditor: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { getCurrentProject } = useProjectStore();
  const { addMessage, updateMessage, getChatHistory } = useChatStore();
  const storyObjectStore = useStoryObjectStore();
  const { getStoryObjects, getChapterById } = storyObjectStore;
  const { selectChapter, getSelectedChapterId } = useNovelStore();
  const { settings } = useSettingsStore();
  const { currentError, showError, hideError } = useErrorStore();

  // Custom hooks
  const { state: uiState, actions: uiActions } = useNovelEditorState();

  // Chat State - reuse from workspace
  const [systemInsertConfig, setSystemInsertConfig] = useState<SystemInsertConfig>(
    ChatPipeline.createDefaultSystemConfig()
  );
  const [chatPipeline] = useState(() => new ChatPipeline());
  const [displayProcessor] = useState(() => new DefaultDisplayProcessor());

  const currentProject = getCurrentProject();
  const storyObjects = getStoryObjects(projectId || '');

  // Get current chapter info
  const selectedChapterId = getSelectedChapterId(projectId || '');
  const selectedChapter = selectedChapterId ? getChapterById(projectId || '', selectedChapterId) : null;


  // Create a ref to store function call handlers for callbacks
  const functionCallHandlersRef = useRef<any>(null);

  const chatManagerCallbacks: ChatManagerCallbacks = {
    onUpdateMessage: (messageId: string, content: string) => {
      updateMessage(projectId || '', messageId, content);
    },
    onFunctionCalls: (messageId: string, functionCalls: any[]) => {
      if (functionCallHandlersRef.current) {
        functionCallHandlersRef.current.handleFunctionCalls(messageId, functionCalls);
      }
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
      if (functionCallHandlersRef.current) {
        functionCallHandlersRef.current.handleFunctionCallsDetected(messageId, functionCalls);
      }
    }
  };

  // Update function call handlers first
  const updatedFunctionCallHandlers = useNovelEditorFunctionCallHandlers(projectId);

  const chatManager = useMemo(() => {
    const updatedConfig = {
      projectId: projectId || '',
      getStoryObjects: () => getStoryObjects(projectId || ''),
      getNovelData: () => {
        const { getAllChapterContents } = useNovelStore.getState();
        return getAllChapterContents(projectId || '');
      },
      getFunctionCallResults: () => updatedFunctionCallHandlers.pendingFunctionCallResults,
      systemInsertConfig,
      chatPipeline,
      isLoading: uiState.isLoading,
      setIsLoading: uiActions.setIsLoading,
      abortControllerRef: { current: null },
      outputLanguage: settings.outputLanguage,
      aiModel: settings.aiModel,
      functions: NOVEL_EDITOR_FUNCTIONS,
      mode: 'novel-editor' as const
    };
    return new ChatManager(updatedConfig, chatManagerCallbacks);
  }, [projectId, systemInsertConfig, uiState.isLoading, getStoryObjects, settings, updatedFunctionCallHandlers.pendingFunctionCallResults]);

  // Update the ref with current handlers
  functionCallHandlersRef.current = updatedFunctionCallHandlers;

  // Chat handlers - reuse from workspace
  const chatHandlers = useChatHandlers(
    projectId,
    uiActions,
    chatManager,
    updatedFunctionCallHandlers.pendingFunctionCallResults,
    () => updatedFunctionCallHandlers.setPendingFunctionCallResults([])
  );

  // Auto-select first chapter if none selected
  useEffect(() => {
    if (!projectId || selectedChapterId) return;

    const outline = storyObjects.outline;
    if (outline?.acts && outline.acts.length > 0) {
      const firstAct = outline.acts[0];
      if (firstAct.chapters && firstAct.chapters.length > 0) {
        const firstChapter = firstAct.chapters[0];
        selectChapter(projectId, firstChapter.id);
      }
    }
  }, [projectId, selectedChapterId, storyObjects.outline, selectChapter]);

  // Restore edit cards from persisted message metadata on initial load
  useEffect(() => {
    if (!projectId) return;

    const chatHistory = getChatHistory(projectId);
    const restoredEditCards: Record<string, any[]> = {};

    chatHistory.forEach(message => {
      const processed = displayProcessor.process(message, {
        projectId,
        storyObjects,
        systemInsertConfig,
        mode: 'novel-editor'
      });

      if (processed.editCards.length > 0) {
        const editCardsWithHandlers = processed.editCards.map((card) => {
          if (message.role === 'assistant' && message.functionCalls) {
            const funcCall = message.functionCalls.find(fc => fc.id === card.id);
            if (funcCall) {
              return {
                ...card,
                appliedAt: funcCall.appliedAt,
                onApply: updatedFunctionCallHandlers.createFunctionCallApplyHandler(message.id, funcCall),
                onReject: updatedFunctionCallHandlers.createFunctionCallRejectHandler(message.id, funcCall)
              };
            }
          }

          return card;
        });

        restoredEditCards[message.id] = editCardsWithHandlers;
      }
    });

    updatedFunctionCallHandlers.setMessageEditCards(restoredEditCards);
  }, [projectId, getChatHistory(projectId || '').length]);

  if (!currentProject) {
    return (
      <div className="error-container">
        <h2>Project Not Found</h2>
        <Link to="/">Go back to Home</Link>
      </div>
    );
  }

  return (
    <div className="novel-editor-container">
      {/* Header */}
      <div className="novel-editor-header">
        <div className="breadcrumb">
          <Link to="/" className="breadcrumb-link">Home</Link>
          <span className="breadcrumb-separator"> / </span>
          <Link to={`/project/${projectId}`} className="breadcrumb-link">
            {currentProject.name}
          </Link>
          <span className="breadcrumb-separator"> / </span>
          <span className="breadcrumb-current">Novel Editor</span>
        </div>
        <div className="novel-editor-title">
          <button
            className={`chat-toggle-btn mobile-only ${uiState.isChatVisible ? 'active' : ''}`}
            onClick={() => {
              uiActions.setIsChatVisible(!uiState.isChatVisible);
              uiActions.setIsMobileSidebarVisible(false);
            }}
          >
            💬 Chat
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className={`novel-editor-content ${uiState.isChatVisible ? 'chat-visible' : ''}`}>
        {/* Chat Sidebar */}
        <ChatSidebar
          projectId={projectId || ''}
          onSelectChat={chatHandlers.handleSelectChat}
          isMobileVisible={uiState.isMobileSidebarVisible}
          isDesktopVisible={uiState.isDesktopChatListVisible}
        />

        {/* Chat Panel */}
        <ChatPanel
          projectId={projectId || ''}
          uiState={uiState}
          uiActions={uiActions}
          systemInsertConfig={systemInsertConfig}
          setSystemInsertConfig={setSystemInsertConfig}
          chatPipeline={chatPipeline}
          storyObjects={storyObjects}
          novelData={useNovelStore.getState().getAllChapterContents(projectId || '')}
          messageEditCards={updatedFunctionCallHandlers.messageEditCards}
          activeFunctionCalls={updatedFunctionCallHandlers.activeFunctionCalls}
          onSubmit={chatHandlers.handleSubmit}
          onStop={chatHandlers.handleStop}
          onEditMessage={chatHandlers.handleEditMessage}
          onEditContentChange={chatHandlers.handleEditContentChange}
          onSaveEdit={chatHandlers.handleSaveEdit}
          onCancelEdit={chatHandlers.handleCancelEdit}
          onDeleteMessage={chatHandlers.handleDeleteMessage}
          editTextareaRef={chatHandlers.editTextareaRef as React.RefObject<HTMLTextAreaElement>}
          mode="novel-editor"
        />

        {/* Novel Editor Panel */}
        <NovelEditorPanel
          projectId={projectId || ''}
          selectedChapter={selectedChapter}
          selectedChapterId={selectedChapterId || null}
          storyObjects={storyObjects}
          uiState={uiState}
          uiActions={uiActions}
          onToggleSidebar={() => uiActions.setIsChapterSidebarVisible(!uiState.isChapterSidebarVisible)}
          onSelectChapter={(chapterId) => selectChapter(projectId || '', chapterId)}
        />
      </div>

      {/* Mobile Chat Overlay */}
      {uiState.isChatVisible && (
        <div className="chat-overlay mobile-only" onClick={() => uiActions.setIsChatVisible(false)} />
      )}

      {/* Mobile Sidebar Overlay */}
      {uiState.isMobileSidebarVisible && (
        <div className="sidebar-overlay mobile-only" onClick={() => uiActions.setIsMobileSidebarVisible(false)} />
      )}

      {/* Desktop Chat List Overlay */}
      {uiState.isDesktopChatListVisible && (
        <div className="desktop-chat-overlay desktop-only" onClick={() => uiActions.setIsDesktopChatListVisible(false)} />
      )}


      {/* Error Modal */}
      <ErrorModal
        isOpen={!!currentError}
        title={currentError?.title || ''}
        message={currentError?.message || ''}
        onClose={hideError}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={uiState.isSettingsOpen}
        onClose={() => uiActions.setIsSettingsOpen(false)}
      />

    </div>
  );
};

export default NovelEditor;
