import React, { useEffect, useRef, useState } from 'react';
import { useChatStore, type Chat } from '../store/chatStore';
import { useSettingsStore } from '../store/settingsStore';
import { TranslationService } from '../services/translationService';

interface ChatSidebarProps {
  projectId: string;
  onSelectChat: (chatId: string) => void;
  isMobileVisible?: boolean;
  isDesktopVisible?: boolean;
}

const ChatSidebar: React.FC<ChatSidebarProps> = ({
  projectId,
  onSelectChat,
  isMobileVisible = false,
  isDesktopVisible = false,
}) => {
  const {
    createChat,
    getChats,
    getSelectedChatId,
    selectChat,
    renameChat,
    deleteChat,
  } = useChatStore();
  const { settings } = useSettingsStore();

  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const chats = getChats(projectId);
  const selectedChatId = getSelectedChatId(projectId);

  useEffect(() => {
    if (editingChatId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingChatId]);

  const handleCreateChat = () => {
    const newChatId = createChat(projectId);
    onSelectChat(newChatId);
  };

  const handleSelectChatInternal = (chatId: string) => {
    selectChat(projectId, chatId);
    onSelectChat(chatId);
  };

  const handleStartEdit = (chat: Chat, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(chat.id);
    setEditName(chat.name);
  };

  const handleSaveEdit = () => {
    if (editingChatId && editName.trim()) {
      renameChat(projectId, editingChatId, editName.trim());
    }
    setEditingChatId(null);
    setEditName('');
  };

  const handleCancelEdit = () => {
    setEditingChatId(null);
    setEditName('');
  };

  const handleDeleteChat = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (chats.length <= 1) {
      alert('Cannot delete the last chat');
      return;
    }

    if (confirm('Are you sure you want to delete this chat?')) {
      deleteChat(projectId, chatId);
      const remainingChats = getChats(projectId);
      if (remainingChats.length > 0) {
        const newSelectedId = getSelectedChatId(projectId);
        if (newSelectedId) {
          onSelectChat(newSelectedId);
        }
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const resolvePreviewContent = (chat: Chat): string => {
    if (chat.messages.length === 0) {
      return 'No messages yet';
    }

    const lastMessage = chat.messages[chat.messages.length - 1];
    const primaryLanguage = settings.primaryLanguage;
    const secondaryLanguage = settings.secondaryLanguage ?? undefined;

    if (lastMessage.data[primaryLanguage]) {
      const content = lastMessage.data[primaryLanguage].content;
      return content.length > 50 ? `${content.substring(0, 50)}...` : content;
    }

    const fallback = TranslationService.getBestLanguageData(lastMessage.data, primaryLanguage, secondaryLanguage);
    if (fallback) {
      const content = fallback.data.content;
      return content.length > 50 ? `${content.substring(0, 50)}...` : content;
    }

    const availableLanguages = Object.keys(lastMessage.data);
    if (availableLanguages.length > 0) {
      const content = lastMessage.data[availableLanguages[0]].content;
      return content.length > 50 ? `${content.substring(0, 50)}...` : content;
    }

    return 'No messages yet';
  };

  const formatTime = (date: Date | string): string => {
    const now = new Date();
    const targetDate = date instanceof Date ? date : new Date(date);

    if (Number.isNaN(targetDate.getTime())) {
      return 'Unknown';
    }

    const diffMs = now.getTime() - targetDate.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return targetDate.toLocaleDateString();
  };

  return (
    <div className={`chat-sidebar ${isMobileVisible ? 'mobile-visible' : ''} ${isDesktopVisible ? 'desktop-visible' : ''}`}>
      <div className="chat-sidebar-header">
        <div className="sidebar-title">
          <h3>Chats</h3>
        </div>
        <div className="sidebar-controls">
          <button
            className="add-chat-btn"
            onClick={handleCreateChat}
            title="Create new chat"
          >
            New Chat
          </button>
        </div>
      </div>

      <div className="chat-list">
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={`chat-item ${selectedChatId === chat.id ? 'selected' : ''}`}
            onClick={() => handleSelectChatInternal(chat.id)}
          >
            <div className="chat-item-main">
              {editingChatId === chat.id ? (
                <input
                  ref={editInputRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={handleSaveEdit}
                  onKeyDown={handleKeyDown}
                  className="chat-name-edit"
                />
              ) : (
                <>
                  <div className="chat-name">{chat.name}</div>
                  <div className="chat-preview">{resolvePreviewContent(chat)}</div>
                  <div className="chat-time">{formatTime(chat.updatedAt)}</div>
                </>
              )}
            </div>

            {editingChatId !== chat.id && (
              <div className="chat-actions">
                <button
                  className="chat-action-btn edit-btn"
                  onClick={(e) => handleStartEdit(chat, e)}
                  title="Rename chat"
                >
                  Rename
                </button>
                <button
                  className="chat-action-btn delete-btn"
                  onClick={(e) => handleDeleteChat(chat.id, e)}
                  title="Delete chat"
                  disabled={chats.length <= 1}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ChatSidebar;
