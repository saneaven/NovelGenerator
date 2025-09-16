import { useState, useEffect } from 'react';
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
  setEditContent: (content: string) => void;
}

export function useWorkspaceState(projectId: string | undefined) {
  const { getChats, getSelectedChatId, selectChat, createChat } = useChatStore();
  
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
    editContent: '',
  });

  // Initialize chat selection
  useEffect(() => {
    if (!projectId) return;
    
    const chats = getChats(projectId);
    const currentSelectedId = getSelectedChatId(projectId);
    
    if (chats.length === 0) {
      // No chats exist, create the first one
      const newChatId = createChat(projectId, 'Main Chat');
      setState(prev => ({ ...prev, selectedChatId: newChatId }));
    } else if (!currentSelectedId) {
      // Chats exist but none selected, select the first one
      selectChat(projectId, chats[0].id);
      setState(prev => ({ ...prev, selectedChatId: chats[0].id }));
    } else {
      // Use the currently selected chat
      setState(prev => ({ ...prev, selectedChatId: currentSelectedId }));
    }
  }, [projectId, getChats, getSelectedChatId, selectChat, createChat]);

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
    setEditContent: (content: string) => 
      setState(prev => ({ ...prev, editContent: content })),
  };

  return { state, actions };
}
