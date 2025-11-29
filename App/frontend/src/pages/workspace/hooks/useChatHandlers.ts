import { useRef, useCallback } from 'react';
import { useChatStore } from '../../../store/chatStore';
import { useChatUIStore } from '../../../store/chatUIStore';
import { useSettingsStore } from '../../../store/settingsStore';
import type { ChatMessage, FunctionCallResultSummary } from '../../../llm_request/types';
import type { ChatManager } from '../../../chat/processors/ChatManager';
import type { ContentPart } from '../../../api/types';

export function useChatHandlers(
  projectId: string | undefined,
  chatManager: ChatManager | null,
  pendingFunctionCallResults?: FunctionCallResultSummary[],
  clearPendingFunctionCallResults?: () => void
) {
  const { selectChat, getSelectedChatId, updateMessage, deleteMessage, clearMessageTranslations } = useChatStore();
  const chatUI = useChatUIStore();
  const mainLanguage = useSettingsStore(state => state.settings.mainLanguage);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const getActiveChatId = useCallback(() => (projectId ? getSelectedChatId(projectId) : undefined), [projectId, getSelectedChatId]);

  const handleSelectChat = useCallback((chatId: string) => {
    if (!projectId) return;
    selectChat(projectId, chatId);
    chatUI.setMobileSidebarVisible(projectId, false);
    chatUI.setDesktopChatListVisible(projectId, false);
  }, [projectId, selectChat, chatUI]);

  const handleSubmit = useCallback(async (e: React.FormEvent, input: string) => {
    e.preventDefault();
    if (!projectId || !chatManager) return;
    if (chatUI.isLoading(projectId)) return;

    const chatId = getActiveChatId();
    if (!chatId) return;

    if (pendingFunctionCallResults?.length && clearPendingFunctionCallResults) {
      clearPendingFunctionCallResults();
    }

    chatUI.clearInput(projectId);

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
  }, [projectId, chatManager, chatUI, getActiveChatId, pendingFunctionCallResults, clearPendingFunctionCallResults]);

  const handleStop = useCallback(() => {
    chatManager?.abort();
  }, [chatManager]);

  const adjustTextareaHeight = useCallback(() => {
    if (editTextareaRef.current) {
      editTextareaRef.current.style.height = 'auto';
      editTextareaRef.current.style.height = `${editTextareaRef.current.scrollHeight}px`;
    }
  }, []);

  const handleEditMessage = useCallback((messageId: string, content: string, _language: string) => {
    if (!projectId) return;
    chatUI.startEditing(projectId, messageId, mainLanguage, content);
    setTimeout(adjustTextareaHeight, 0);
  }, [projectId, chatUI, mainLanguage, adjustTextareaHeight]);

  const handleEditContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!projectId) return;
    chatUI.updateEditContent(projectId, e.target.value);
    adjustTextareaHeight();
  }, [projectId, chatUI, adjustTextareaHeight]);

  const handleSaveEdit = useCallback(() => {
    if (!projectId) return;
    const chatId = getActiveChatId();
    if (!chatId) return;

    const editing = chatUI.getEditing(projectId);
    if (!editing.messageId) return;

    // Convert the string content to ContentPart array for the primary language only
    const contentParts: ContentPart[] = [{ type: 'content', text: editing.content }];

    updateMessage(projectId, chatId, editing.messageId, contentParts, mainLanguage);
    // Purge cached translations so the next view requires a fresh translate
    clearMessageTranslations(projectId, chatId, editing.messageId, [mainLanguage]);
    chatUI.cancelEditing(projectId);
  }, [projectId, chatUI, getActiveChatId, updateMessage, clearMessageTranslations, mainLanguage]);

  const handleCancelEdit = useCallback(() => {
    if (!projectId) return;
    chatUI.cancelEditing(projectId);
  }, [projectId, chatUI]);

  const handleDeleteMessage = useCallback((messageId: string) => {
    if (!projectId) return;
    const chatId = getActiveChatId();
    if (!chatId) return;

    if (confirm('Are you sure you want to delete this message?')) {
      deleteMessage(projectId, chatId, messageId);
    }
  }, [projectId, getActiveChatId, deleteMessage]);

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

