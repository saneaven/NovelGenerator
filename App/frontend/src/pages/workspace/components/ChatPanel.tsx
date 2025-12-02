import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useChatStore, type StoredChatMessage } from '../../../store/chatStore';
import { useChatUIStore } from '../../../store/chatUIStore';
import { useProjectStore } from '../../../store/projectStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useErrorStore } from '../../../store/errorStore';
import { useNovelEditorStore } from '../../../store/novelEditorStore';
import type { SystemInsertConfig, EditCard } from '../../../chat/types';
import { TranslationService } from '../../../services/translationService';
import { LLMRequestPipeline } from '../../../chat/LLMRequestPipeline';
import type { StoryObjects } from '../../../types/storyObject';
import type { ChatMessage, FunctionCallProgress } from '../../../llm_request/types';
import ToggleSwitch from '../../../components/ToggleSwitch';
import ThinkingDisplay from '../../../components/ThinkingDisplay';
import GroupedFunctionCallCard from '../../../components/functionCall/GroupedFunctionCallCard';
import { collapseContentParts } from '../../../chat/utils/contentParts';

interface ChatPanelProps
{
    projectId: string;
    systemInsertConfig: SystemInsertConfig;
    setSystemInsertConfig: (config: SystemInsertConfig | ((prev: SystemInsertConfig) => SystemInsertConfig)) => void;
    chatPipeline: LLMRequestPipeline;
    storyObjects: StoryObjects;
    novelData?: Record<string, unknown>;
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
}

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
    systemInsertConfig,
    setSystemInsertConfig,
    chatPipeline,
    storyObjects,
    novelData,
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
}) =>
{
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const { convertToDisplayMessage, addTranslatedMessage } = useChatStore();
    const chatUI = useChatUIStore();
    const { getCurrentProject } = useProjectStore();
    const { settings } = useSettingsStore();
    const { showError } = useErrorStore();
    const novelEditorStore = useNovelEditorStore();

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
    const [isControlsCollapsed, setIsControlsCollapsed] = useState(true);
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

    useEffect(() =>
    {
        if (messagesEndRef.current)
        {
            const chatMessagesContainer = messagesEndRef.current.closest('.chat-messages');
            if (chatMessagesContainer)
            {
                chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
            }
        }
    }, [storedMessages, chatUI.isLoading(projectId)]);

    const displayContext = useMemo(() =>
    {
        return LLMRequestPipeline.createContext(
            projectId,
            storyObjects,
            mode,
            systemInsertConfig,
            novelData
        );
    }, [projectId, storyObjects, mode, systemInsertConfig, novelData]);

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

        try
        {
            setTranslatingMessages(prev => ({ ...prev, [message.id]: true }));
            setTranslationErrors(prev => ({ ...prev, [message.id]: null }));
            TranslationService.setTranslationStatus(message.id, { objectId: message.id, isTranslating: true });

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
        return (
            <div className="message-content">
                {!message.hasRequestedLanguage && (
                    <div className="language-fallback-badge">
                        Using {message.fallbackLanguage || message.displayLanguage}
                    </div>
                )}
                {processed.displayContent}
                {chatUI.isLoading(projectId) &&
                    message.chatMessage.role === 'assistant' &&
                    message === displayMessages[displayMessages.length - 1] && (
                        <div className="typing-indicator inline">
                            <div className="loading-track">
                                <div className="loading-bar" />
                            </div>
                        </div>
                    )}
            </div>
        );
    };

    const translationEnabled = Boolean(defaultSubLanguage && defaultSubLanguage !== mainLanguage);
    const translationTargetLabel = defaultSubLanguage || 'secondary language';

    return (
        <div className={`chat-panel ${chatUI.isChatVisible(projectId) ? 'visible' : 'hidden'}`}>
            <div className="chat-header">
                <div className="chat-header-left">
                    <button
                        className="chat-list-btn"
                        onClick={() =>
                        {
                            if (window.innerWidth <= 768)
                            {
                                chatUI.setMobileSidebarVisible(projectId, true);
                            } else
                            {
                                chatUI.setDesktopChatListVisible(projectId, !chatUI.isDesktopChatListVisible(projectId));
                            }
                        }}
                        title="View chat list"
                    >
                        Chats
                    </button>
                    <h2>{selectedChat?.name || 'AI Chat'}</h2>
                </div>
                <button
                    className="chat-close-btn mobile-only"
                    onClick={() => chatUI.setChatVisible(projectId, false)}
                >
                    Close
                </button>
            </div>

            <div className="chat-messages">
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
                    const editing = chatUI.getEditing(projectId);
                    const isEditing = editing.messageId === message.chatMessage.id;
                    const processingResult = chatPipeline.processForDisplay(message.chatMessage, displayContext);
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
                                    isStreaming={chatUI.isLoading(projectId) && message.chatMessage.id === storedMessages[storedMessages.length - 1]?.id}
                                />
                            )}

                            <div className="message-wrapper">
                                <div className="message-header">
                                    <span className="message-role">{isUser ? 'You' : 'AI'}</span>
                                    <span className="message-time">{formatTimestamp(message.chatMessage.timestamp)}</span>
                                </div>

                                {isEditing ? (
                                    <div className="message-edit">
                                        <textarea
                                            ref={editTextareaRef}
                                            value={editing.content}
                                            onChange={onEditContentChange}
                                            placeholder={`Edit content`}
                                        />
                                        <div className="edit-actions">
                                            <button
                                                className="save-button"
                                                onClick={() => onSaveEdit(
                                                    editing.messageId,
                                                    editing.content,
                                                    editing.language || message.displayLanguage
                                                )}
                                            >
                                                Save
                                            </button>
                                            <button className="cancel-button" onClick={onCancelEdit}>Cancel</button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {renderMessageContent(message, processingResult)}
                                        {activeFunctionCalls[message.chatMessage.id] && activeFunctionCalls[message.chatMessage.id].length > 0 && (
                                            <div className="message-edit-cards">
                                                <GroupedFunctionCallCard
                                                    mode="streaming"
                                                    streamingProgress={activeFunctionCalls[message.chatMessage.id]}
                                                    storyObjects={storyObjects}
                                                />
                                            </div>
                                        )}

                                        {messageEditCards[message.chatMessage.id] && messageEditCards[message.chatMessage.id].length > 0 && (
                                            <div className="message-edit-cards">
                                                <GroupedFunctionCallCard
                                                    mode={isMessageConfirmed(message.chatMessage.id) ? 'confirmed' : 'pending'}
                                                    cards={messageEditCards[message.chatMessage.id]}
                                                    onConfirm={(selections) => onBatchConfirm(message.chatMessage.id, selections)}
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
                                                    <button
                                                        className="action-btn language-toggle-btn"
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
                                                    </button>
                                                )}
                                                {translationEnabled && (
                                                    <button
                                                        className="action-btn translate-btn"
                                                        onClick={() => translateMessage(message.storedMessage)}
                                                        disabled={translateDisabled}
                                                        title={translateButtonLabel}
                                                    >
                                                        {isTranslating ? '⟳' : translationAvailable ? '↻' : '🌐'}
                                                    </button>
                                                )}
                                                <button
                                                    className="action-btn edit-btn"
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
                                                >
                                                    ✎
                                                </button>
                                                <button
                                                    className="action-btn delete-btn"
                                                    onClick={() => onDeleteMessage(message.chatMessage.id)}
                                                    disabled={isTranslating}
                                                    title="Delete"
                                                >
                                                    🗑
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}

                <div ref={messagesEndRef} />
            </div>

            <div className="chat-input-container">
                <div className={`chat-controls ${isControlsCollapsed ? 'collapsed' : 'expanded'}`}>
                    <div className="chat-controls-header" onClick={() => setIsControlsCollapsed(!isControlsCollapsed)}>
                        <span className="chat-controls-title">
                            {isControlsCollapsed ? '⚙️ Contexts' : '⚙️ Contexts'}
                        </span>
                        <button
                            type="button"
                            className="chat-controls-toggle"
                            aria-label={isControlsCollapsed ? "Expand contexts" : "Collapse contexts"}
                        >
                            {isControlsCollapsed ? '▲' : '▼'}
                        </button>
                    </div>
                    {!isControlsCollapsed && (
                        <div className="chat-controls-content">
                            <ToggleSwitch
                                checked={systemInsertConfig.enabled}
                                onChange={(checked) => setSystemInsertConfig(prev => ({
                                    ...prev,
                                    enabled: checked
                                }))}
                                label="Include story context in messages"
                                icon="📚"
                            />
                            <ToggleSwitch
                                checked={systemInsertConfig.includeNovelContent}
                                onChange={(checked) => setSystemInsertConfig(prev => ({
                                    ...prev,
                                    includeNovelContent: checked
                                }))}
                                label="Include novel content in messages"
                                icon="📖"
                            />
                        </div>
                    )}
                </div>

                <form onSubmit={(e) => onSubmit(e, chatUI.getInput(projectId), chatUI.isLoading(projectId))} className="chat-form">
                    <div className="input-group">
                        <textarea
                            value={chatUI.getInput(projectId)}
                            onChange={(e) => chatUI.setInput(projectId, e.target.value)}
                            placeholder={`Enter a message in ${mainLanguage}...`}
                            rows={1}
                            className="chat-input"
                            disabled={chatUI.isLoading(projectId)}
                            onKeyDown={(e) =>
                            {
                                if (e.key === 'Enter' && !e.shiftKey)
                                {
                                    e.preventDefault();
                                    onSubmit(e as any, chatUI.getInput(projectId), chatUI.isLoading(projectId));
                                }
                            }}
                        />
                        {chatUI.isLoading(projectId) ? (
                            <button type="button" onClick={onStop} className="stop-button">
                                Stop
                            </button>
                        ) : (
                            <button type="submit" className="send-button">
                                Send
                            </button>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ChatPanel;


