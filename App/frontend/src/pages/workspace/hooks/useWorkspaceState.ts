import { useState, useEffect, useRef } from 'react';
import { useChatStore } from '../../../store/chatStore';

type TabType = 'basicInfo' | 'characters' | 'organizations' | 'locations' | 'lorebook' | 'outline';

export interface WorkspaceUIState {
  isChatVisible: boolean;
  activeStoryTab: TabType;
  selectedChatId: string | null;
  isMobileSidebarVisible: boolean;
  isDesktopChatListVisible: boolean;
  isSettingsOpen: boolean;
  input: string;
  isLoading: boolean;
  editingMessageId: string | null;
  editingLanguage: string | null;
  editContent: string;
}

export interface WorkspaceUIActions {
  setIsChatVisible: (visible: boolean) => void;
  setActiveStoryTab: (tab: TabType) => void;
  setSelectedChatId: (id: string | null) => void;
  setIsMobileSidebarVisible: (visible: boolean) => void;
  setIsDesktopChatListVisible: (visible: boolean) => void;
  setIsSettingsOpen: (open: boolean) => void;
  setInput: (input: string) => void;
  setIsLoading: (loading: boolean) => void;
  setEditingMessageId: (id: string | null) => void;
  setEditingLanguage: (language: string | null) => void;
  setEditContent: (content: string) => void;
}

export function useWorkspaceState(projectId: string | undefined) {
  const chatStore = useChatStore();
  const { getChats, getSelectedChatId, selectChat, createChat } = chatStore;
  const initializedProjectRef = useRef<string | null>(null);
  const chats = projectId ? getChats(projectId) : [];

  const [state, setState] = useState<WorkspaceUIState>({
    isChatVisible: true,
    activeStoryTab: 'basicInfo',
    selectedChatId: null,
    isMobileSidebarVisible: false,
    isDesktopChatListVisible: false,
    isSettingsOpen: false,
    input: '',
    isLoading: false,
    editingMessageId: null,
    editingLanguage: null,
    editContent: '',
  });

  // Initialize chat selection AFTER chats are loaded
  useEffect(() => {
    if (!projectId) return;

    // Prevent re-initialization for the same project
    if (initializedProjectRef.current === projectId) return;

    // Get fresh chat data from store
    const projectChats = getChats(projectId);

    // Check if chats have been loaded for this project
    // If chats array is populated OR if we've confirmed fetch completed (chats.length check handles both empty and populated cases)
    // We need to distinguish between "not yet fetched" vs "fetched but empty"
    // The store initializes chatsByProject[projectId] to [] after successful fetch
    const hasLoadedChats = chatStore.chatsByProject[projectId] !== undefined;

    if (!hasLoadedChats) {
      return;
    }

    // Also wait if still loading
    if (chatStore.isLoading) {
      return;
    }

    // Mark as initialized IMMEDIATELY to prevent race conditions
    initializedProjectRef.current = projectId;

    const initializeChat = async () => {
      const currentSelectedId = getSelectedChatId(projectId);
      let targetChatId: string | null = null;

      if (projectChats.length === 0) {
        // No chats exist, create the first one
        const newChatId = await createChat(projectId, 'Main Chat');
        targetChatId = newChatId;
      } else if (!currentSelectedId) {
        // Chats exist but none selected, select the first one
        const firstChatId = projectChats[0].id;
        selectChat(projectId, firstChatId);
        targetChatId = firstChatId;
      } else {
        // Use the currently selected chat
        targetChatId = currentSelectedId;
      }

      setState(prev => (prev.selectedChatId === targetChatId
        ? prev
        : { ...prev, selectedChatId: targetChatId }));
    };

    initializeChat();
    // Only re-run when projectId or chats.length changes, or loading state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, chats.length, chatStore.isLoading]);

  const actions: WorkspaceUIActions = {
    setIsChatVisible: (visible: boolean) =>
      setState(prev => ({ ...prev, isChatVisible: visible })),
    setActiveStoryTab: (tab: TabType) =>
      setState(prev => ({ ...prev, activeStoryTab: tab })),
    setSelectedChatId: (id: string | null) =>
      setState(prev => ({ ...prev, selectedChatId: id })),
    setIsMobileSidebarVisible: (visible: boolean) =>
      setState(prev => ({ ...prev, isMobileSidebarVisible: visible })),
    setIsDesktopChatListVisible: (visible: boolean) =>
      setState(prev => ({ ...prev, isDesktopChatListVisible: visible })),
    setIsSettingsOpen: (open: boolean) =>
      setState(prev => ({ ...prev, isSettingsOpen: open })),
    setInput: (input: string) =>
      setState(prev => ({ ...prev, input })),
    setIsLoading: (loading: boolean) =>
      setState(prev => ({ ...prev, isLoading: loading })),
    setEditingMessageId: (id: string | null) =>
      setState(prev => ({ ...prev, editingMessageId: id })),
    setEditingLanguage: (language: string | null) =>
      setState(prev => ({ ...prev, editingLanguage: language })),
    setEditContent: (content: string) =>
      setState(prev => ({ ...prev, editContent: content })),
  };

  return { state, actions };
}
