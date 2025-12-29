import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useChatStore, type StoredChatMessage } from '../../../store/chatStore';
import { useChatUIStore } from '../../../store/chatUIStore';
import { useSidebarStore } from '../../../store/sidebarStore';
import { useProjectStore } from '../../../store/projectStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useErrorStore } from '../../../store/errorStore';
import { useNovelEditorStore } from '../../../store/novelEditorStore';
import { useLLMTaskStore } from '../../../store/llmTaskStore';
import type { EditCard } from '../../../chat/types';
import ObjectPicker from '../../../components/ObjectPicker/ObjectPicker';
import { TranslationService } from '../../../services/translationService';
import { DefaultDisplayProcessor } from '../../../chat/processors/DisplayProcessor';
import type { StoryObjects } from '../../../types/storyObject';
import type { ChatMessage, FunctionCallProgress } from '../../../llm/requestTypes';
import ThinkingDisplay from '../../../components/ThinkingDisplay';
import { FunctionCallCard } from '../../../components/functionCall';
import { TextButton } from '../../../components/TextButton';
import { IconButton } from '../../../components/IconButton';
import { collapseContentParts } from '../../../chat/utils/contentParts';
import { Settings, Edit, Trash, Globe, CircularArrow, ChevronUp, ChevronDown } from '../../../components/icons';

interface ChatPanelProps
{
    projectId: string;
    selectedContextIds: string[];
    onContextIdsChange: (ids: string[]) => void;
    totalObjectCount: number;
    storyObjects: StoryObjects;
    messageEditCards: Record<string, EditCard[]>;
    activeFunctionCalls: Record<string, FunctionCallProgress[]>;
    onBatchConfirm: (messageId: string, selections: Record<string, boolean>) => Promise<void>;
    isMessageConfirmed: (messageId: string) => boolean;
    onSubmit: (e: React.FormEvent, input: string, isLoading: boolean) => Promise<void>;
    onStop: () => void;
    onEditMessage: (messageId: string, content: string, language: string) => void;
    onEditContentChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onSaveEdit: (editingMessageId: string | null, editContent: string, language: string) => void;
    onCancelEdit: () => void;
    onDeleteMessage: (messageId: string) => void;
    editTextareaRef: React.RefObject<HTMLTextAreaElement>;
    mode: 'novelEditor' | 'workspace';
    onClose?: () => void;
}

// Context picker component for selecting which objects to include in chat context
interface ChatContextPickerProps {
    projectId: string;
    language: string;
    selectedIds: string[];
    totalCount: number;
    onChange: (ids: string[]) => void;
}

const ChatContextPicker: React.FC<ChatContextPickerProps> = React.memo(({
    projectId,
    language,
    selectedIds,
    totalCount,
    onChange
}) => {
    const [isCollapsed, setIsCollapsed] = useState(true);

    return (
        <div className={`chat-controls ${isCollapsed ? 'collapsed' : 'expanded'}`}>
            <div className="chat-controls-header" onClick={() => setIsCollapsed(!isCollapsed)}>
                <span className="chat-controls-title">
                    <Settings size="sm" /> Context ({selectedIds.length}/{totalCount})
                </span>
                <button
                    type="button"
                    className="chat-controls-toggle"
                    aria-label={isCollapsed ? "Expand context picker" : "Collapse context picker"}
                >
                    {isCollapsed ? <ChevronUp size="xs" /> : <ChevronDown size="xs" />}
                </button>
            </div>
            <div className="chat-controls-content">
                <div className="chat-controls-content-inner">
                    <ObjectPicker
                        mode="all"
                        selectionMode="multi"
                        selectedIds={selectedIds}
                        onChange={(ids) => onChange(ids as string[])}
                        projectId={projectId}
                        language={language}
                        maxHeight="300px"
                        showSearch={true}
                        selectAllOnLoad={true}
                    />
                </div>
            </div>
        </div>
    );
});

// Separate component for input form to avoid re-rendering messages on typing
interface ChatInputFormProps {
    projectId: string;
    mainLanguage: string;
    onSubmit: (e: React.FormEvent, input: string, isLoading: boolean) => Promise<void>;
    onStop: () => void;
}

const ChatInputForm: React.FC<ChatInputFormProps> = React.memo(({ projectId, mainLanguage, onSubmit, onStop }) => {
    const input = useChatUIStore((state) => state.inputByProject[projectId] ?? '');
    const isLoading = useChatUIStore((state) => state.loadingByProject[projectId] ?? false);
    const setInput = useChatUIStore((state) => state.setInput);

    const handleSubmit = useCallback((e: React.FormEvent) => {
        onSubmit(e, input, isLoading);
    }, [onSubmit, input, isLoading]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSubmit(e as any, input, isLoading);
        }
    }, [onSubmit, input, isLoading]);

    return (
        <form onSubmit={handleSubmit} className="chat-form">
            <div className="input-group">
                <textarea
                    value={input}
                    onChange={(e) => setInput(projectId, e.target.value)}
                    placeholder={`Enter a message in ${mainLanguage}...`}
                    rows={1}
                    className="chat-input"
                    disabled={isLoading}
                    onKeyDown={handleKeyDown}
                />
                {isLoading ? (
                    <TextButton key="stop" type="button" variant="danger" onClick={onStop} className="chat-submit-btn">
                        Stop
                    </TextButton>
                ) : (
                    <TextButton key="send" type="submit" variant="primary" className="chat-submit-btn">
                        Send
                    </TextButton>
                )}
            </div>
        </form>
    );
});

// Separate component for message edit form to avoid re-rendering all messages on typing
interface MessageEditFormProps {
    projectId: string;
    displayLanguage: string;
    editTextareaRef: React.RefObject<HTMLTextAreaElement>;
    onEditContentChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onSaveEdit: (messageId: string | null, content: string, language: string) => void;
    onCancelEdit: () => void;
}

const MessageEditForm: React.FC<MessageEditFormProps> = React.memo(({
    projectId,
    displayLanguage,
    editTextareaRef,
    onEditContentChange,
    onSaveEdit,
    onCancelEdit
}) => {
    const editingMessageId = useChatUIStore((state) => state.editingByProject[projectId]?.messageId ?? null);
    const editingContent = useChatUIStore((state) => state.editingByProject[projectId]?.content ?? '');
    const editingLanguage = useChatUIStore((state) => state.editingByProject[projectId]?.language ?? null);

    return (
        <div className="message-edit">
            <textarea
                ref={editTextareaRef}
                value={editingContent}
                onChange={onEditContentChange}
                placeholder="Edit content"
            />
            <div className="edit-actions">
                <TextButton
                    variant="primary"
                    size="sm"
                    onClick={() => onSaveEdit(editingMessageId, editingContent, editingLanguage || displayLanguage)}
                >
                    Save
                </TextButton>
                <TextButton variant="secondary" size="sm" onClick={onCancelEdit}>Cancel</TextButton>
            </div>
        </div>
    );
});

interface DisplayMessageInfo
{
    storedMessage: StoredChatMessage;
    chatMessage: ChatMessage;
    requestedLanguage: string;
    displayLanguage: string;
    hasRequestedLanguage: boolean;
    fallbackLanguage: string | null;
}

const ChatPanel: React.FC<ChatPanelProps> = ({
    projectId,
    selectedContextIds,
    onContextIdsChange,
    totalObjectCount,
    storyObjects,
    messageEditCards,
    activeFunctionCalls,
    onBatchConfirm,
    isMessageConfirmed,
    onSubmit,
    onStop,
    onEditMessage,
    onEditContentChange,
    onSaveEdit,
    onCancelEdit,
    onDeleteMessage,
    editTextareaRef,
    mode,
    onClose,
}) =>
{
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const isUserNearBottomRef = useRef(true);
    const [showScrollButton, setShowScrollButton] = useState(false);
    const displayProcessor = useMemo(() => new DefaultDisplayProcessor(), []);
    const { convertToDisplayMessage, addTranslatedMessage } = useChatStore();

    // Use selectors for chatUI to avoid re-rendering on input changes
    const isLoading = useChatUIStore((state) => state.loadingByProject[projectId] ?? false);
    const chatVisibleState = useChatUIStore((state) => state.chatVisibleByProject[projectId] ?? false);
    const editingMessageId = useChatUIStore((state) => state.editingByProject[projectId]?.messageId ?? null);
    const setChatVisible = useChatUIStore((state) => state.setChatVisible);

    // Handle desktop visibility separately to avoid selector side effects
    const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;
    const isChatVisible = isDesktop ? true : chatVisibleState;

    const { getCurrentProject } = useProjectStore();
    const { settings } = useSettingsStore();
    const { showError } = useErrorStore();
    const novelEditorStore = useNovelEditorStore();
    const taskStore = useLLMTaskStore();

    // Check if editor has unsaved changes (only relevant in novelEditor mode)
    const hasUnsavedChanges = mode === 'novelEditor'
        ? novelEditorStore.getHasUnsavedChanges(projectId)
        : false;

    const mainLanguage = settings.mainLanguage;
    const defaultSubLanguage = settings.defaultSubLanguage;

    // Use state selectors for proper Zustand reactivity (re-render when store changes)
    // IMPORTANT: Get chatId from state inside selector, not from closure (avoids stale value)
    const selectedChatId = useChatStore((state) => state.selectedChatByProject[projectId]);
    const selectedChat = useChatStore((state) => {
        const chatId = state.selectedChatByProject[projectId];
        if (!chatId) return undefined;
        return state.chatsByProject[projectId]?.find((c) => c.id === chatId);
    });
    const storedMessages = useMemo(() => selectedChat?.messages ?? [], [selectedChat]);

    const [translatingMessages, setTranslatingMessages] = useState<Record<string, boolean>>({});
    const [translationErrors, setTranslationErrors] = useState<Record<string, string | null>>({});
    // Per-message language view: tracks which messages are showing translation
    const [messageLanguageView, setMessageLanguageView] = useState<Record<string, 'primary' | 'secondary'>>({});

    const currentProject = getCurrentProject();

    const formatTimestamp = useCallback((input: Date | string | number | undefined | null) =>
    {
        if (!input) return '';

        const date = input instanceof Date ? input : new Date(input);
        if (Number.isNaN(date.getTime()))
        {
            return '';
        }

        return date.toLocaleTimeString();
    }, []);

    useEffect(() =>
    {
        setTranslatingMessages({});
        setTranslationErrors({});
    }, [selectedChatId]);

    useEffect(() =>
    {
        // If secondary language disappears, reset all per-message views to primary
        if (!defaultSubLanguage) {
            setMessageLanguageView({});
        }
    }, [defaultSubLanguage]);

    // Scroll event handler to detect user's scroll position
    const handleScroll = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const threshold = 100; // pixels from bottom
        const isNearBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight < threshold;

        isUserNearBottomRef.current = isNearBottom;
        // Show scroll button only when scrolled up AND streaming is active
        setShowScrollButton(!isNearBottom && isLoading);
    }, [isLoading]);

    // Attach scroll listener to container
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, [handleScroll]);

    // Auto-scroll only when user is near bottom
    useEffect(() =>
    {
        if (isUserNearBottomRef.current && scrollContainerRef.current)
        {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
    }, [storedMessages, isLoading]);

    // Hide scroll button when streaming stops
    useEffect(() => {
        if (!isLoading) {
            setShowScrollButton(false);
        }
    }, [isLoading]);


    const resolveDisplayInfo = useCallback(
        (message: StoredChatMessage): DisplayMessageInfo =>
        {
            // Check per-message language preference
            const messageView = messageLanguageView[message.id];
            const wantsTranslation = Boolean(messageView === 'secondary' && defaultSubLanguage);
            const requestedLanguage = wantsTranslation && defaultSubLanguage ? defaultSubLanguage : mainLanguage;
            const hasRequestedLanguage = Boolean(requestedLanguage && message.data[requestedLanguage]);

            if (hasRequestedLanguage)
            {
                return {
                    storedMessage: message,
                    chatMessage: convertToDisplayMessage(message, requestedLanguage),
                    requestedLanguage,
                    displayLanguage: requestedLanguage,
                    hasRequestedLanguage: true,
                    fallbackLanguage: null
                };
            }

            const fallback = TranslationService.getBestLanguageData(
                message.data,
                mainLanguage,
                defaultSubLanguage ?? undefined
            );

            const displayLanguage = fallback?.language ?? requestedLanguage ?? mainLanguage;
            const fallbackLanguage = fallback ? fallback.language : null;
            const chatMessage = convertToDisplayMessage(message, displayLanguage);

            return {
                storedMessage: message,
                chatMessage,
                requestedLanguage,
                displayLanguage,
                hasRequestedLanguage: false,
                fallbackLanguage
            };
        },
        [messageLanguageView, mainLanguage, defaultSubLanguage, convertToDisplayMessage]
    );

    const displayMessages = useMemo(
        () => storedMessages.map(resolveDisplayInfo),
        [storedMessages, resolveDisplayInfo]
    );

    const translateMessage = async (message: StoredChatMessage) =>
    {
        if (!defaultSubLanguage)
        {
            showError('Translation Failed', 'No default translation language configured. Add sub languages in Settings.');
            return;
        }
        if (!selectedChatId)
        {
            showError('Translation Failed', 'No active chat selected.');
            return;
        }

        const sourceLanguage = mainLanguage;
        const targetLanguage = defaultSubLanguage;
        const sourceData = message.data[sourceLanguage] || TranslationService.getBestLanguageData(message.data, sourceLanguage)?.data;
        if (!sourceData)
        {
            showError('Translation Failed', `No ${sourceLanguage} content available to translate.`);
            return;
        }
        const contentParts = sourceData?.contentParts ?? [];
        const {
            content: sourceContent,
            thinking
        } = collapseContentParts(contentParts);

        if (!sourceContent.trim())
        {
            showError('Translation Failed', `No ${sourceLanguage} content available to translate.`);
            return;
        }

        // Generate toast session ID for this translation
        const toastSessionId = `chat-translation-${message.id}`;

        try
        {
            setTranslatingMessages(prev => ({ ...prev, [message.id]: true }));
            setTranslationErrors(prev => ({ ...prev, [message.id]: null }));
            TranslationService.setTranslationStatus(message.id, { objectId: message.id, isTranslating: true });

            // Start toast notification
            taskStore.setRunning(toastSessionId, 'Chat Translation', 'chat-translation');

            const translationResult = await TranslationService.translateChatMessage(
                {
                    content: sourceContent
                },
                {
                    projectId,
                    sourceLanguage,
                    targetLanguage
                }
            );
            const translatedContent = translationResult.content || sourceContent;
            const translatedThinking = thinking;

            // Reconstruct contentParts with translated text
            const translatedContentParts = contentParts.map((part: any) => {
                if (part.type === 'content') {
                    return { ...part, text: translatedContent };
                } else if (part.type === 'thinking') {
                    return { ...part, text: translatedThinking };
                }
                return part;
            });

            const translatedData: any = {
                contentParts: translatedContentParts,
                thinking_details: sourceData.thinking_details, // Keep original (not translated)
            };

            await addTranslatedMessage(projectId, selectedChatId, message.id, translatedData, targetLanguage);

            // Mark toast as success
            taskStore.setSuccess(toastSessionId);

            // Auto-switch to show translation after successful translate
            setMessageLanguageView(prev => ({
                ...prev,
                [message.id]: 'secondary'
            }));
        } catch (error)
        {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred during translation.';
            setTranslationErrors(prev => ({ ...prev, [message.id]: errorMessage }));
            showError('Translation Failed', errorMessage);
            // Mark toast as error
            taskStore.setTaskError(toastSessionId, errorMessage);
        } finally
        {
            setTranslatingMessages(prev => ({ ...prev, [message.id]: false }));
            TranslationService.clearTranslationStatus(message.id);
        }
    };

    const renderMessageContent = (
        message: DisplayMessageInfo,
        processed: { displayContent: React.ReactNode }
    ) =>
    {
        // Extract error parts from contentParts
        const errorParts = message.chatMessage.contentParts?.filter(
            (part: any) => part.type === 'error'
        ) || [];

        return (
            <div className="message-content">
                {!message.hasRequestedLanguage && (
                    <div className="language-fallback-badge">
                        Using {message.fallbackLanguage || message.displayLanguage}
                    </div>
                )}
                {processed.displayContent}
                {isLoading &&
                    message.chatMessage.role === 'assistant' &&
                    message === displayMessages[displayMessages.length - 1] && (
                        <div className="typing-indicator inline">
                            <div className="loading-track">
                                <div className="loading-bar" />
                            </div>
                        </div>
                    )}
                {errorParts.map((errorPart: any, index: number) => (
                    <div key={`error-${index}`} className="message-error">
                        {errorPart.text}
                    </div>
                ))}
            </div>
        );
    };

    const translationEnabled = Boolean(defaultSubLanguage && defaultSubLanguage !== mainLanguage);
    const translationTargetLabel = defaultSubLanguage || 'secondary language';

    return (
        <div className={`chat-panel ${isChatVisible ? 'visible' : 'hidden'}`}>
            <div className="chat-header">
                <div className="chat-header-left">
                    <TextButton
                        variant="secondary"
                        size="sm"
                        onClick={() => useSidebarStore.getState().toggleSidebar(projectId, 'chat')}
                        title="View chat list"
                    >
                        Chats
                    </TextButton>
                    <h2>{selectedChat?.name || 'AI Chat'}</h2>
                </div>
                <TextButton
                    variant="secondary"
                    size="sm"
                    className="mobile-only"
                    onClick={() => onClose ? onClose() : setChatVisible(projectId, false)}
                >
                    Close
                </TextButton>
            </div>

            <div className="chat-messages" ref={scrollContainerRef}>
                {displayMessages.length === 0 && (
                    <div className="welcome-message">
                        <div className="ai-avatar">AI</div>
                        <div className="message-content">
                            <p>Hello! I am here to help with your novel writing.</p>
                            {currentProject && (
                                <p>{`What can I help you with for the "${currentProject.name}" project?`}</p>
                            )}
                        </div>
                    </div>
                )}

                {displayMessages.map((message) =>
                {
                    const isUser = message.chatMessage.role === 'user';
                    const isEditing = editingMessageId === message.chatMessage.id;
                    const processingResult = displayProcessor.process(message.chatMessage as any, { projectId, mode } as any);
                    const isTranslating = Boolean(translatingMessages[message.storedMessage.id]);
                    const primaryMessage = message.storedMessage.data[mainLanguage]
                        ? convertToDisplayMessage(message.storedMessage, mainLanguage)
                        : message.chatMessage;
                    const { content: primaryPlainContent } = collapseContentParts(primaryMessage.contentParts);
                    const translationAvailable = defaultSubLanguage ? Boolean(message.storedMessage.data[defaultSubLanguage]) : false;
                    const translateButtonLabel = translationAvailable
                        ? `Refresh ${translationTargetLabel}`
                        : `Translate to ${translationTargetLabel}`;
                    const translateDisabled = !translationEnabled || isTranslating;

                    return (
                        <div
                            key={message.chatMessage.id}
                            className={`chat-message ${message.chatMessage.role}${isEditing ? ' editing' : ''}`}
                        >
                            {/* Show thinking above the message bubble */}
                            {message.chatMessage.role === 'assistant' && (
                                <ThinkingDisplay
                                    messageId={message.chatMessage.id}
                                    contentParts={message.chatMessage.contentParts}
                                    displayMode="separate"
                                    isStreaming={isLoading && message.chatMessage.id === storedMessages[storedMessages.length - 1]?.id}
                                />
                            )}

                            <div className="message-wrapper">
                                <div className="message-header">
                                    <span className="message-role">{isUser ? 'You' : 'AI'}</span>
                                    <span className="message-time">{formatTimestamp(message.chatMessage.timestamp)}</span>
                                </div>

                                {isEditing ? (
                                    <MessageEditForm
                                        projectId={projectId}
                                        displayLanguage={message.displayLanguage}
                                        editTextareaRef={editTextareaRef}
                                        onEditContentChange={onEditContentChange}
                                        onSaveEdit={onSaveEdit}
                                        onCancelEdit={onCancelEdit}
                                    />
                                ) : (
                                    <>
                                        {renderMessageContent(message, processingResult)}
                                        {activeFunctionCalls[message.chatMessage.id] && activeFunctionCalls[message.chatMessage.id].length > 0 && (
                                            <div className="message-edit-cards">
                                                <FunctionCallCard
                                                    mode="streaming"
                                                    streamingProgress={activeFunctionCalls[message.chatMessage.id]}
                                                    storyObjects={storyObjects}
                                                />
                                            </div>
                                        )}

                                        {messageEditCards[message.chatMessage.id] && messageEditCards[message.chatMessage.id].length > 0 && (
                                            <div className="message-edit-cards">
                                                <FunctionCallCard
                                                    mode={isMessageConfirmed(message.chatMessage.id) ? 'confirmed' : 'pending'}
                                                    cards={messageEditCards[message.chatMessage.id]}
                                                    onConfirm={(selections: Record<string, boolean>) => onBatchConfirm(message.chatMessage.id, selections)}
                                                    storyObjects={storyObjects}
                                                    isApplyDisabled={hasUnsavedChanges}
                                                    applyDisabledReason={hasUnsavedChanges ? "Save your changes first - unsaved work will be overwritten" : undefined}
                                                />
                                            </div>
                                        )}
                                                                                <div className="message-actions">
                                            {translationErrors[message.storedMessage.id] && (
                                                <div className="translation-error">{translationErrors[message.storedMessage.id]}</div>
                                            )}
                                            <div className="action-buttons">
                                                {/* Per-message language toggle - only show when translation exists */}
                                                {translationAvailable && (
                                                    <TextButton
                                                        variant="secondary"
                                                        size="sm"
                                                        onClick={() => setMessageLanguageView(prev => ({
                                                            ...prev,
                                                            [message.storedMessage.id]: prev[message.storedMessage.id] === 'secondary' ? 'primary' : 'secondary'
                                                        }))}
                                                        title={messageLanguageView[message.storedMessage.id] === 'secondary'
                                                            ? `Switch to ${mainLanguage}`
                                                            : `Switch to ${defaultSubLanguage}`
                                                        }
                                                    >
                                                        {messageLanguageView[message.storedMessage.id] === 'secondary'
                                                            ? defaultSubLanguage?.slice(0, 2).toUpperCase()
                                                            : mainLanguage?.slice(0, 2).toUpperCase()
                                                        }
                                                    </TextButton>
                                                )}
                                                {translationEnabled && (
                                                    <IconButton
                                                        icon={isTranslating ? <CircularArrow size="sm" /> : translationAvailable ? <CircularArrow size="sm" /> : <Globe size="sm" />}
                                                        onClick={() => translateMessage(message.storedMessage)}
                                                        disabled={translateDisabled}
                                                        title={translateButtonLabel}
                                                        size="sm"
                                                    />
                                                )}
                                                <IconButton
                                                    icon={<Edit size="sm" />}
                                                    onClick={() => {
                                                        // Switch to primary view for this message when editing
                                                        setMessageLanguageView(prev => ({
                                                            ...prev,
                                                            [message.storedMessage.id]: 'primary'
                                                        }));
                                                        onEditMessage(message.chatMessage.id, primaryPlainContent, mainLanguage);
                                                    }}
                                                    disabled={isTranslating || !primaryPlainContent.trim()}
                                                    title="Edit"
                                                    size="sm"
                                                />
                                                <IconButton
                                                    icon={<Trash size="sm" />}
                                                    onClick={() => onDeleteMessage(message.chatMessage.id)}
                                                    disabled={isTranslating}
                                                    title="Delete"
                                                    size="sm"
                                                    variant="danger"
                                                />
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}

                <div ref={messagesEndRef} />

                {showScrollButton && (
                    <IconButton
                        className="scroll-to-bottom-button"
                        icon={<ChevronDown size="sm" />}
                        onClick={() => {
                            if (scrollContainerRef.current) {
                                isUserNearBottomRef.current = true;
                                scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
                                setShowScrollButton(false);
                            }
                        }}
                        title="Scroll to bottom"
                        variant="primary"
                    />
                )}
            </div>

            <div className="chat-input-container">
                <ChatContextPicker
                    projectId={projectId}
                    language={mainLanguage}
                    selectedIds={selectedContextIds}
                    totalCount={totalObjectCount}
                    onChange={onContextIdsChange}
                />
                <ChatInputForm
                    projectId={projectId}
                    mainLanguage={mainLanguage}
                    onSubmit={onSubmit}
                    onStop={onStop}
                />
            </div>
        </div>
    );
};

export default ChatPanel;

