import { useRef } from 'react';
import { useChatStore } from '../../../store/chatStore';
import { useSettingsStore } from '../../../store/settingsStore';
import type { ChatMessage, FunctionCallResultSummary } from '../../../llm_request/types';
import type { ChatManager } from '../../../chat/processors/ChatManager';
import type { WorkspaceUIActions } from './useWorkspaceState';
import type { ContentPart } from '../../../api/types';

export function useChatHandlers(
  projectId: string | undefined,
  uiActions: WorkspaceUIActions,
  chatManager: ChatManager | null,
  pendingFunctionCallResults?: FunctionCallResultSummary[],
  clearPendingFunctionCallResults?: () => void
) {
  const { selectChat, getSelectedChatId, updateMessage, deleteMessage, clearMessageTranslations } = useChatStore();
  const primaryLanguage = useSettingsStore(state => state.settings.primaryLanguage);
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
    if (!uiActions || !projectId || !chatManager) return;
    if (isLoading) return;

    const chatId = getActiveChatId();
    if (!chatId) return;

    if (pendingFunctionCallResults?.length && clearPendingFunctionCallResults) {
      clearPendingFunctionCallResults();
    }

    uiActions.setInput('');

    if (!input?.trim()) {
      await chatManager.processEmptyRequest();
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      contentParts: [{ type: 'content', text: input.trim() }],
      timestamp: new Date(),
    };

    await chatManager.processUserMessage(userMessage);
  };

  const handleStop = () => {
    chatManager?.abort();
  };

  const adjustTextareaHeight = () => {
    if (editTextareaRef.current) {
      editTextareaRef.current.style.height = 'auto';
      editTextareaRef.current.style.height = `${editTextareaRef.current.scrollHeight}px`; 
    }
  };

  const handleEditMessage = (messageId: string, content: string, _language: string) => {
    uiActions.setEditingMessageId(messageId);
    uiActions.setEditingLanguage(primaryLanguage);
    uiActions.setEditContent(content);
    setTimeout(adjustTextareaHeight, 0);
  };

  const handleEditContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    uiActions.setEditContent(e.target.value);
    adjustTextareaHeight();
  };

  const handleSaveEdit = (editingMessageId: string | null, editContent: string, _language: string) => {
    if (!projectId || !editingMessageId) return;
    const chatId = getActiveChatId();
    if (!chatId) return;

    // Convert the string content to ContentPart array for the primary language only
    const contentParts: ContentPart[] = [{ type: 'content', text: editContent }];

    updateMessage(projectId, chatId, editingMessageId, contentParts, primaryLanguage);
    // Purge cached translations so the next view requires a fresh translate
    clearMessageTranslations(projectId, chatId, editingMessageId, [primaryLanguage]);
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

