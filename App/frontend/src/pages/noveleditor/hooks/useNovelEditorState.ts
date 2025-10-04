import { useState, useCallback, useMemo } from 'react';

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
  activeStoryTab: 'basicInfo' | 'characters' | 'organizations' | 'locations' | 'lorebook' | 'outline'; // For compatibility with Workspace
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
  setActiveStoryTab: (tab: 'basicInfo' | 'characters' | 'organizations' | 'locations' | 'lorebook' | 'outline') => void; // For compatibility with Workspace
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
  activeStoryTab: 'basicInfo', // For compatibility with Workspace
});

export const useNovelEditorState = () => {
  const [state, setState] = useState<NovelEditorUIState>(createInitialState);

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
