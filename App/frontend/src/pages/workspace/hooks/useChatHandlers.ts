import { useRef } from 'react';
import { useChatStore } from '../../../store/chatStore';
import { useErrorStore } from '../../../store/errorStore';
import type { ChatMessage } from '../../../llm_request/types';
import type { RuntimeProcessor } from '../../../chat/processors/RuntimeProcessor';
import type { WorkspaceUIActions } from './useWorkspaceState';
import { SystemTagManager, type SystemTagData } from '../../../chat/utils/SystemTagManager';

export function useChatHandlers(
  projectId: string | undefined,
  uiActions: WorkspaceUIActions,
  runtimeProcessor: RuntimeProcessor | null,
  pendingFunctionCallResults?: Array<{
    functionCall: any;
    accepted: boolean;
    resultMessage: string;
  }>,
  clearPendingFunctionCallResults?: () => void
) {
  const { selectChat, editMessage, deleteMessage } = useChatStore();
  const { showError } = useErrorStore();
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
    if (!uiActions || !projectId || !runtimeProcessor) return;
    
    if (!input?.trim() || isLoading) return;

    let messageContent = input.trim();
    
    // Add pending function call results using centralized system tag manager
    if (pendingFunctionCallResults && pendingFunctionCallResults.length > 0) {
      const systemTagData: SystemTagData = {
        functionCallResults: pendingFunctionCallResults
      };
      
      const systemTag = SystemTagManager.generateSystemTag(systemTagData);
      messageContent = SystemTagManager.addSystemTagToMessage(messageContent, systemTag);
      
      // Clear pending results after including them
      if (clearPendingFunctionCallResults) {
        clearPendingFunctionCallResults();
      }
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: messageContent,
      timestamp: new Date(),
    };

    uiActions.setInput('');
    await runtimeProcessor.processUserMessage(userMessage);
  };

  const handleStop = () => {
    if (runtimeProcessor) {
      runtimeProcessor.abort();
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