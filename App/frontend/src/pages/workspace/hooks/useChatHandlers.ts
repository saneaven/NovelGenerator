import { useRef } from 'react';
import { useChatStore } from '../../../store/chatStore';
import type { ChatMessage, FunctionCallResultSummary } from '../../../llm_request/types';
import type { LLMRequestManager } from '../../../chat/processors/LLMRequestManager';
import type { WorkspaceUIActions } from './useWorkspaceState';
import type { ContentPart } from '../../../api/types';

export function useChatHandlers(
  projectId: string | undefined,
  uiActions: WorkspaceUIActions,
  llmRequestManager: LLMRequestManager | null,
  pendingFunctionCallResults?: FunctionCallResultSummary[],
  clearPendingFunctionCallResults?: () => void
) {
  const { selectChat, getSelectedChatId, updateMessage, deleteMessage } = useChatStore();
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const getActiveChatId = () => (projectId ? getSelectedChatId(projectId) : undefined);

  const handleSelectChat = (chatId: string) => {
    if (!projectId) return;
    selectChat(projectId, chatId);
    uiActions.setSelectedChatId(chatId);
    uiActions.setIsMobileSidebarVisible(false);
    uiActions.setIsDesktopChatListVisible(false);
  };

  const handleSubmit = async (e: React.FormEvent, input: string, isLoading: boolean) => {
    e.preventDefault();
    if (!uiActions || !projectId || !llmRequestManager) return;
    if (isLoading) return;

    const chatId = getActiveChatId();
    if (!chatId) return;

    if (pendingFunctionCallResults?.length && clearPendingFunctionCallResults) {
      clearPendingFunctionCallResults();
    }

    uiActions.setInput('');

    if (!input?.trim()) {
      await llmRequestManager.processEmptyRequest();
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    await llmRequestManager.processUserMessage(userMessage);
  };

  const handleStop = () => {
    llmRequestManager?.abort();
  };

  const adjustTextareaHeight = () => {
    if (editTextareaRef.current) {
      editTextareaRef.current.style.height = 'auto';
      editTextareaRef.current.style.height = `${editTextareaRef.current.scrollHeight}px`; 
    }
  };

  const handleEditMessage = (messageId: string, content: string | null, language: string) => {
    if (!content) return;
    uiActions.setEditingMessageId(messageId);
    uiActions.setEditingLanguage(language);
    uiActions.setEditContent(content);
    setTimeout(adjustTextareaHeight, 0);
  };

  const handleEditContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    uiActions.setEditContent(e.target.value);
    adjustTextareaHeight();
  };

  const handleSaveEdit = (editingMessageId: string | null, editContent: string, language: string) => {
    if (!projectId || !editingMessageId) return;
    const chatId = getActiveChatId();
    if (!chatId) return;

    // Convert the string content to ContentPart array
    const contentParts: ContentPart[] = [{ type: 'content', text: editContent }];

    updateMessage(projectId, chatId, editingMessageId, contentParts, language);
    uiActions.setEditingMessageId(null);
    uiActions.setEditingLanguage(null);
    uiActions.setEditContent('');
  };

  const handleCancelEdit = () => {
    uiActions.setEditingMessageId(null);
    uiActions.setEditingLanguage(null);
    uiActions.setEditContent('');
  };

  const handleDeleteMessage = (messageId: string) => {
    if (!projectId) return;
    const chatId = getActiveChatId();
    if (!chatId) return;

    if (confirm('Are you sure you want to delete this message?')) {
      deleteMessage(projectId, chatId, messageId);
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

