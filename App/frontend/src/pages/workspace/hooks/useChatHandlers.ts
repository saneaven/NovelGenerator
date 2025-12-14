import { useRef, useCallback } from 'react';
import { useChatStore } from '../../../store/chatStore';
import { useChatUIStore } from '../../../store/chatUIStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import type { ChatMessage, FunctionCallResultSummary } from '../../../llm/requestTypes';
import type { ChatManager } from '../../../chat/processors/ChatManager';
import type { ContentPart } from '../../../api/types';
import { generateTempId } from '../../../utils/tempId';

export function useChatHandlers(
  projectId: string | undefined,
  chatManager: ChatManager | null,
  pendingFunctionCallResults?: FunctionCallResultSummary[],
  clearPendingFunctionCallResults?: () => void
) {
  const { selectChat, getSelectedChatId, updateMessage, deleteMessage, clearMessageTranslations } = useChatStore();
  // Use individual selectors for actions to avoid unnecessary re-renders
  // Actions are stable references, so we can select them individually
  const isLoading = useChatUIStore(state => state.isLoading);
  const clearInput = useChatUIStore(state => state.clearInput);
  const startEditing = useChatUIStore(state => state.startEditing);
  const updateEditContent = useChatUIStore(state => state.updateEditContent);
  const getEditing = useChatUIStore(state => state.getEditing);
  const cancelEditing = useChatUIStore(state => state.cancelEditing);
  const setMobileSidebarVisible = useChatUIStore(state => state.setMobileSidebarVisible);
  const setDesktopChatListVisible = useChatUIStore(state => state.setDesktopChatListVisible);
  const mainLanguage = useSettingsStore(state => state.settings.mainLanguage);
  const getObjectsMissingMainLanguage = useUnifiedObjectStore(state => state.getObjectsMissingMainLanguage);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const getActiveChatId = useCallback(() => (projectId ? getSelectedChatId(projectId) : undefined), [projectId, getSelectedChatId]);

  const handleSelectChat = useCallback((chatId: string) => {
    if (!projectId) return;
    selectChat(projectId, chatId);
    setMobileSidebarVisible(projectId, false);
    setDesktopChatListVisible(projectId, false);
  }, [projectId, selectChat, setMobileSidebarVisible, setDesktopChatListVisible]);

  const handleSubmit = useCallback(async (e: React.FormEvent, input: string) => {
    e.preventDefault();
    if (!projectId || !chatManager) return;
    if (isLoading(projectId)) return;

    const chatId = getActiveChatId();
    if (!chatId) return;

    // Check for objects missing main language content
    const missingMainLanguageObjects = getObjectsMissingMainLanguage(projectId, mainLanguage);
    if (missingMainLanguageObjects.length > 0) {
      // Build a list of object names for the confirmation message
      const objectNames = missingMainLanguageObjects
        .map(obj => {
          // Get name from first available language since main language is missing
          const availableLanguages = Object.keys(obj.data || {});
          const fallbackLang = availableLanguages[0];
          const data = fallbackLang ? obj.data[fallbackLang] : {};
          const name = data?.name || data?.title || obj.id;
          const type = obj.type.replace('_', ' ');
          return `- ${type}: ${name}`;
        })
        .join('\n');

      const confirmMessage = `The following objects only have content in a sub-language (not ${mainLanguage}):\n\n${objectNames}\n\nDo you want to send using sub-language content instead?`;

      if (!confirm(confirmMessage)) {
        return; // User cancelled, don't send
      }
    }

    if (pendingFunctionCallResults?.length && clearPendingFunctionCallResults) {
      clearPendingFunctionCallResults();
    }

    clearInput(projectId);

    if (!input?.trim()) {
      await chatManager.processEmptyRequest();
      return;
    }

    const userMessage: ChatMessage = {
      id: generateTempId(),
      role: 'user',
      contentParts: [{ type: 'content', text: input.trim() }],
      timestamp: new Date(),
    };

    await chatManager.processUserMessage(userMessage);
  }, [projectId, chatManager, isLoading, clearInput, getActiveChatId, getObjectsMissingMainLanguage, mainLanguage, pendingFunctionCallResults, clearPendingFunctionCallResults]);

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
    startEditing(projectId, messageId, mainLanguage, content);
    setTimeout(adjustTextareaHeight, 0);
  }, [projectId, startEditing, mainLanguage, adjustTextareaHeight]);

  const handleEditContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!projectId) return;
    updateEditContent(projectId, e.target.value);
    adjustTextareaHeight();
  }, [projectId, updateEditContent, adjustTextareaHeight]);

  const handleSaveEdit = useCallback(() => {
    if (!projectId) return;
    const chatId = getActiveChatId();
    if (!chatId) return;

    const editing = getEditing(projectId);
    if (!editing.messageId) return;

    // Convert the string content to ContentPart array for the primary language only
    const contentParts: ContentPart[] = [{ type: 'content', text: editing.content }];

    updateMessage(projectId, chatId, editing.messageId, contentParts, mainLanguage);
    // Purge cached translations so the next view requires a fresh translate
    clearMessageTranslations(projectId, chatId, editing.messageId, [mainLanguage]);
    cancelEditing(projectId);
  }, [projectId, getEditing, cancelEditing, getActiveChatId, updateMessage, clearMessageTranslations, mainLanguage]);

  const handleCancelEdit = useCallback(() => {
    if (!projectId) return;
    cancelEditing(projectId);
  }, [projectId, cancelEditing]);

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
