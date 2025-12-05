import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useChatStore } from '../../../store/chatStore';

export interface NovelEditorUIState {
  // Chat related (inherited from workspace)
  isChatVisible: boolean;
  isLoading: boolean;
  input: string;
  editingMessageId: string | null;
  editingLanguage: string | null;
  editContent: string;
  isMobileSidebarVisible: boolean;
  isDesktopChatListVisible: boolean;
  selectedChatId: string | null;

  // Novel editor specific
  isChapterSidebarVisible: boolean;
  isAIEditModalOpen: boolean;
  isVersionModalOpen: boolean;
  isSettingsOpen: boolean;
  editorContent: string;
  isSaving: boolean;
  activeStoryTab: 'basicInfo' | 'characters' | 'organizations' | 'locations' | 'lorebook' | 'outline';
}

export interface NovelEditorUIActions {
  // Chat related (inherited from workspace)
  setIsChatVisible: (visible: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  setInput: (input: string) => void;
  setEditingMessageId: (id: string | null) => void;
  setEditingLanguage: (language: string | null) => void;
  setEditContent: (content: string) => void;
  setIsMobileSidebarVisible: (visible: boolean) => void;
  setIsDesktopChatListVisible: (visible: boolean) => void;
  setSelectedChatId: (chatId: string | null) => void;

  // Novel editor specific
  setIsChapterSidebarVisible: (visible: boolean) => void;
  setIsAIEditModalOpen: (open: boolean) => void;
  setIsVersionModalOpen: (open: boolean) => void;
  setIsSettingsOpen: (open: boolean) => void;
  setEditorContent: (content: string) => void;
  setIsSaving: (saving: boolean) => void;
  setActiveStoryTab: (tab: 'basicInfo' | 'characters' | 'organizations' | 'locations' | 'lorebook' | 'outline') => void;
}

const createInitialState = (): NovelEditorUIState => ({
  // Chat related (inherited from workspace)
  isChatVisible: window.innerWidth > 768, // Show on desktop by default
  isLoading: false,
  input: '',
  editingMessageId: null,
  editingLanguage: null,
  editContent: '',
  isMobileSidebarVisible: false,
  isDesktopChatListVisible: false,
  selectedChatId: null,

  // Novel editor specific
  isChapterSidebarVisible: false,
  isAIEditModalOpen: false,
  isVersionModalOpen: false,
  isSettingsOpen: false,
  editorContent: '',
  isSaving: false,
  activeStoryTab: 'basicInfo',
});

export const useNovelEditorState = (projectId?: string) => {
  const chatStore = useChatStore();
  const { getChats, getSelectedChatId, selectChat, createChat } = chatStore;
  const initializedProjectRef = useRef<string | null>(null);
  const chats = projectId ? getChats(projectId) : [];

  const [state, setState] = useState<NovelEditorUIState>(createInitialState);

  // Initialize chat selection AFTER chats are loaded
  useEffect(() => {
    if (!projectId) return;

    // Prevent re-initialization for the same project
    if (initializedProjectRef.current === projectId) return;

    // Get fresh chat data from store
    const projectChats = getChats(projectId);

    // Check if chats have been loaded for this project
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, chats.length, chatStore.isLoading]);

  // Chat related actions (inherited from workspace)
  const setIsChatVisible = useCallback((visible: boolean) => {
    setState(prev => ({ ...prev, isChatVisible: visible }));
  }, []);

  const setIsLoading = useCallback((loading: boolean) => {
    setState(prev => ({ ...prev, isLoading: loading }));
  }, []);

  const setInput = useCallback((input: string) => {
    setState(prev => ({ ...prev, input }));
  }, []);

  const setEditingMessageId = useCallback((id: string | null) => {
    setState(prev => ({ ...prev, editingMessageId: id }));
  }, []);

  const setEditingLanguage = useCallback((language: string | null) => {
    setState(prev => ({ ...prev, editingLanguage: language }));
  }, []);

  const setEditContent = useCallback((content: string) => {
    setState(prev => ({ ...prev, editContent: content }));
  }, []);

  const setIsMobileSidebarVisible = useCallback((visible: boolean) => {
    setState(prev => ({ ...prev, isMobileSidebarVisible: visible }));
  }, []);

  const setIsDesktopChatListVisible = useCallback((visible: boolean) => {
    setState(prev => ({ ...prev, isDesktopChatListVisible: visible }));
  }, []);

  const setSelectedChatId = useCallback((chatId: string | null) => {
    setState(prev => ({ ...prev, selectedChatId: chatId }));
  }, []);

  // Novel editor specific actions
  const setIsChapterSidebarVisible = useCallback((visible: boolean) => {
    setState(prev => ({ ...prev, isChapterSidebarVisible: visible }));
  }, []);

  const setIsAIEditModalOpen = useCallback((open: boolean) => {
    setState(prev => ({ ...prev, isAIEditModalOpen: open }));
  }, []);

  const setIsVersionModalOpen = useCallback((open: boolean) => {
    setState(prev => ({ ...prev, isVersionModalOpen: open }));
  }, []);

  const setIsSettingsOpen = useCallback((open: boolean) => {
    setState(prev => ({ ...prev, isSettingsOpen: open }));
  }, []);

  const setEditorContent = useCallback((content: string) => {
    setState(prev => ({ ...prev, editorContent: content }));
  }, []);

  const setIsSaving = useCallback((saving: boolean) => {
    setState(prev => ({ ...prev, isSaving: saving }));
  }, []);

  const setActiveStoryTab = useCallback((tab: 'basicInfo' | 'characters' | 'organizations' | 'locations' | 'lorebook' | 'outline') => {
    setState(prev => ({ ...prev, activeStoryTab: tab }));
  }, []);

  const actions: NovelEditorUIActions = useMemo(() => ({
    // Chat related
    setIsChatVisible,
    setIsLoading,
    setInput,
    setEditingMessageId,
    setEditingLanguage,
    setEditContent,
    setIsMobileSidebarVisible,
    setIsDesktopChatListVisible,
    setSelectedChatId,

    // Novel editor specific
    setIsChapterSidebarVisible,
    setIsAIEditModalOpen,
    setIsVersionModalOpen,
    setIsSettingsOpen,
    setEditorContent,
    setIsSaving,
    setActiveStoryTab,
  }), [
    setIsChatVisible,
    setIsLoading,
    setInput,
    setEditingMessageId,
    setEditingLanguage,
    setEditContent,
    setIsMobileSidebarVisible,
    setIsDesktopChatListVisible,
    setSelectedChatId,
    setIsChapterSidebarVisible,
    setIsAIEditModalOpen,
    setIsVersionModalOpen,
    setIsSettingsOpen,
    setEditorContent,
    setIsSaving,
    setActiveStoryTab,
  ]);

  return { state, actions };
};
