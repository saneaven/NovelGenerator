import { useRef } from 'react';
import { useChatStore } from '../../../store/chatStore';
import type { ChatMessage, FunctionCallResultSummary } from '../../../llm_request/types';
import type { ChatManager } from '../../../chat/processors/ChatManager';
import type { WorkspaceUIActions } from './useWorkspaceState';

export function useChatHandlers(
  projectId: string | undefined,
  uiActions: WorkspaceUIActions,
  chatManager: ChatManager | null,
  pendingFunctionCallResults?: FunctionCallResultSummary[],
  clearPendingFunctionCallResults?: () => void
) {
  const { selectChat, editMessage, deleteMessage } = useChatStore();
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSelectChat = (chatId: string) => {
    if (!projectId) return;
    selectChat(projectId, chatId);
    uiActions.setSelectedChatId(chatId);
    // Close sidebar when chat is selected
    uiActions.setIsMobileSidebarVisible(false);
    uiActions.setIsDesktopChatListVisible(false);
  };

  const handleSubmit = async (e: React.FormEvent, input: string, isLoading: boolean) => {
    e.preventDefault();
    if (!uiActions || !projectId || !chatManager) return;

    if (isLoading) return;

    // Clear function call results - they will be processed through pipeline context
    if (pendingFunctionCallResults && pendingFunctionCallResults.length > 0 && clearPendingFunctionCallResults) {
      clearPendingFunctionCallResults();
    }

    uiActions.setInput('');

    // If input is empty, send request without adding user message
    if (!input?.trim()) {
      await chatManager.processEmptyRequest();
      return;
    }

    // Create raw user message - no modifications, all system processing happens in pipeline
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(), // Raw user input only
      timestamp: new Date(),
    };

    await chatManager.processUserMessage(userMessage);
  };

  const handleStop = () => {
    if (chatManager) {
      chatManager.abort();
    }
  };

  const adjustTextareaHeight = () => {
    if (editTextareaRef.current) {
      editTextareaRef.current.style.height = 'auto';
      editTextareaRef.current.style.height = `${editTextareaRef.current.scrollHeight}px`;
    }
  };

  const handleEditMessage = (messageId: string, content: string | null) => {
    if (!content) return;
    uiActions.setEditingMessageId(messageId);
    uiActions.setEditContent(content);
    setTimeout(() => {
      adjustTextareaHeight();
    }, 0);
  };

  const handleEditContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    uiActions.setEditContent(e.target.value);
    adjustTextareaHeight();
  };

  const handleSaveEdit = (editingMessageId: string | null, editContent: string) => {
    if (!projectId || !editingMessageId) return;
    editMessage(projectId, editingMessageId, editContent);
    uiActions.setEditingMessageId(null);
    uiActions.setEditContent('');
  };

  const handleCancelEdit = () => {
    uiActions.setEditingMessageId(null);
    uiActions.setEditContent('');
  };

  const handleDeleteMessage = (messageId: string) => {
    if (!projectId) return;
    if (confirm('Are you sure you want to delete this message?')) {
      deleteMessage(projectId, messageId);
    }
  };

  return {
    editTextareaRef,
    handleSelectChat,
    handleSubmit,
    handleStop,
    handleEditMessage,
    handleEditContentChange,
    handleSaveEdit,
    handleCancelEdit,
    handleDeleteMessage,
  };
}