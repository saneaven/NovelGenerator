import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useChatStore, type StoredChatMessage } from '../../../store/chatStore';
import { useProjectStore } from '../../../store/projectStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useErrorStore } from '../../../store/errorStore';
import type { SystemInsertConfig, EditCard } from '../../../chat/types';
import { TranslationService } from '../../../services/translationService';
import { ChatPipeline } from '../../../chat/ChatPipeline';
import { EditCardComponent } from '../../../chat/processors/DisplayProcessor';
import type { WorkspaceUIState, WorkspaceUIActions } from '../hooks/useWorkspaceState';
import type { StoryObjects } from '../../../types/storyObject';
import type { ChatMessage, FunctionCallProgress } from '../../../llm_request/types';
import ToggleSwitch from '../../../components/ToggleSwitch';
import ThinkingDisplay from '../../../components/ThinkingDisplay';
import FunctionCallPreviewCard from './FunctionCallPreviewCard';
import { collapseContentParts } from '../../../chat/utils/contentParts';

interface ChatPanelProps
{
    projectId: string;
    uiState: WorkspaceUIState;
    uiActions: WorkspaceUIActions;
    systemInsertConfig: SystemInsertConfig;
    setSystemInsertConfig: (config: SystemInsertConfig | ((prev: SystemInsertConfig) => SystemInsertConfig)) => void;
    chatPipeline: ChatPipeline;
    storyObjects: StoryObjects;
    novelData?: Record<string, unknown>;
    messageEditCards: Record<string, EditCard[]>;
    activeFunctionCalls: Record<string, FunctionCallProgress[]>;
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
    uiState,
    uiActions,
    systemInsertConfig,
    setSystemInsertConfig,
    chatPipeline,
    storyObjects,
    novelData,
    messageEditCards,
    activeFunctionCalls,
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
    const { getSelectedChatId, getSelectedChat, convertToDisplayMessage, addTranslatedMessage } = useChatStore();
    const { getCurrentProject } = useProjectStore();
    const { settings } = useSettingsStore();
    const { showError } = useErrorStore();

    const primaryLanguage = settings.primaryLanguage;
    const secondaryLanguage = settings.secondaryLanguage;
    const aiModel = settings.aiModel;

    const selectedChatId = getSelectedChatId(projectId);
    const selectedChat = selectedChatId ? getSelectedChat(projectId) : undefined;
    const storedMessages = useMemo(() => selectedChat?.messages ?? [], [selectedChat]);

    const [translatingMessages, setTranslatingMessages] = useState<Record<string, boolean>>({});
    const [translationErrors, setTranslationErrors] = useState<Record<string, string | null>>({});
    const [isControlsCollapsed, setIsControlsCollapsed] = useState(true);
    const [isTranslationView, setIsTranslationView] = useState(false);

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
        // If secondary language disappears, snap back to primary view
        if (!secondaryLanguage) {
            setIsTranslationView(false);
        }
    }, [secondaryLanguage]);

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
    }, [storedMessages, uiState.isLoading]);

    const displayContext = useMemo(() =>
    {
        return ChatPipeline.createContext(
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
            const wantsTranslation = Boolean(isTranslationView && secondaryLanguage);
            const requestedLanguage = wantsTranslation && secondaryLanguage ? secondaryLanguage : primaryLanguage;
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
                primaryLanguage,
                secondaryLanguage ?? undefined
            );

            const displayLanguage = fallback?.language ?? requestedLanguage ?? primaryLanguage;
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
        [isTranslationView, primaryLanguage, secondaryLanguage, convertToDisplayMessage]
    );

    const displayMessages = useMemo(
        () => storedMessages.map(resolveDisplayInfo),
        [storedMessages, resolveDisplayInfo]
    );

    const translateMessage = async (message: StoredChatMessage) =>
    {
        if (!secondaryLanguage)
        {
            showError('Translation Failed', 'No secondary language configured.');
            return;
        }
        if (!selectedChatId)
        {
            showError('Translation Failed', 'No active chat selected.');
            return;
        }

        const sourceLanguage = primaryLanguage;
        const targetLanguage = secondaryLanguage;
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

            addTranslatedMessage(projectId, selectedChatId, message.id, translatedData, targetLanguage);
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
                {uiState.isLoading &&
                    message.chatMessage.role === 'assistant' &&
                    message === displayMessages[displayMessages.length - 1] && (
                        <div className="typing-indicator inline">
                            <span />
                            <span />
                            <span />
                        </div>
                    )}
            </div>
        );
    };

    const translationEnabled = Boolean(secondaryLanguage && secondaryLanguage !== primaryLanguage);
    const translationTargetLabel = secondaryLanguage || 'secondary language';

    return (
        <div className={`chat-panel ${uiState.isChatVisible ? 'visible' : 'hidden'}`}>
            <div className="chat-header">
                <div className="chat-header-left">
                    <button
                        className="chat-list-btn"
                        onClick={() =>
                        {
                            if (window.innerWidth <= 768)
                            {
                                uiActions.setIsMobileSidebarVisible(true);
                            } else
                            {
                                uiActions.setIsDesktopChatListVisible(!uiState.isDesktopChatListVisible);
                            }
                        }}
                        title="View chat list"
                    >
                        Chats
                    </button>
                    <h2>{selectedChat?.name || 'AI Chat'}</h2>
                </div>
                {translationEnabled && (
                    <div className="chat-translation-toggle">
                        <button
                            className="chat-toggle-btn"
                            onClick={() => setIsTranslationView(prev => !prev)}
                            disabled={uiState.isLoading}
                            title={isTranslationView ? `View ${primaryLanguage}` : `View ${translationTargetLabel}`}
                        >
                            {isTranslationView ? `View ${primaryLanguage}` : `View ${translationTargetLabel}`}
                        </button>
                        {isTranslationView && (
                            <span className="translation-view-note">Viewing translation (read-only)</span>
                        )}
                    </div>
                )}
                <button
                    className="chat-close-btn mobile-only"
                    onClick={() => uiActions.setIsChatVisible(false)}
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

                {displayMessages.map((message, index) =>
                {
                    const isAssistant = message.chatMessage.role === 'assistant';
                    const isUser = message.chatMessage.role === 'user';
                    const isEditing = uiState.editingMessageId === message.chatMessage.id;
                    const processingResult = chatPipeline.processForDisplay(message.chatMessage, displayContext);
                    const isLastAssistantLoading = isAssistant && index === displayMessages.length - 1 && uiState.isLoading;
                    const isTranslating = Boolean(translatingMessages[message.storedMessage.id]);
                    const primaryMessage = message.storedMessage.data[primaryLanguage]
                        ? convertToDisplayMessage(message.storedMessage, primaryLanguage)
                        : message.chatMessage;
                    const { content: primaryPlainContent } = collapseContentParts(primaryMessage.contentParts);
                    const translationAvailable = secondaryLanguage ? Boolean(message.storedMessage.data[secondaryLanguage]) : false;
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
                                    contentParts={message.chatMessage.contentParts}
                                    displayMode="separate"
                                    isStreaming={uiState.isLoading && message.chatMessage.id === storedMessages[storedMessages.length - 1]?.id}
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
                                            value={uiState.editContent}
                                            onChange={onEditContentChange}
                                            placeholder={`Edit content`}
                                        />
                                        <div className="edit-actions">
                                            <button
                                                className="save-button"
                                                onClick={() => onSaveEdit(
                                                    uiState.editingMessageId,
                                                    uiState.editContent,
                                                    uiState.editingLanguage || message.displayLanguage
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

                                        <div className="message-actions">
                                            {translationErrors[message.storedMessage.id] && (
                                                <div className="translation-error">{translationErrors[message.storedMessage.id]}</div>
                                            )}
                                            <div className="action-buttons">
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
                                                        setIsTranslationView(false);
                                                        onEditMessage(message.chatMessage.id, primaryPlainContent, primaryLanguage);
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

                            {isLastAssistantLoading && (
                                <div className="typing-indicator inline">
                                    <span />
                                    <span />
                                    <span />
                                </div>
                            )}

                            {activeFunctionCalls[message.chatMessage.id] && activeFunctionCalls[message.chatMessage.id].length > 0 && (
                                <div className="message-edit-cards">
                                    <div className="function-call-indicator">
                                        <div className="function-call-indicator-header">
                                            <div className="function-call-indicator-text">AI is composing function-call arguments…</div>
                                            <div className="function-call-spinner">
                                                <div className="spinner" />
                                            </div>
                                        </div>
                                        <div className="function-call-preview">
                                            {activeFunctionCalls[message.chatMessage.id].map((progress) => (
                                                <FunctionCallPreviewCard
                                                    key={progress.draft.id}
                                                    progress={progress}
                                                    storyObjects={storyObjects}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {messageEditCards[message.chatMessage.id] && (
                                <div className="message-edit-cards">
                                    {messageEditCards[message.chatMessage.id].map(card => (
                                        <EditCardComponent key={card.id} card={card} />
                                    ))}
                                </div>
                            )}
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

                <form onSubmit={(e) => onSubmit(e, uiState.input, uiState.isLoading)} className="chat-form">
                    <div className="input-group">
                        <textarea
                            value={uiState.input}
                            onChange={(e) => uiActions.setInput(e.target.value)}
                            placeholder={`Enter a message in ${primaryLanguage}...`}
                            rows={1}
                            className="chat-input"
                            disabled={uiState.isLoading}
                            onKeyDown={(e) =>
                            {
                                if (e.key === 'Enter' && !e.shiftKey)
                                {
                                    e.preventDefault();
                                    onSubmit(e as any, uiState.input, uiState.isLoading);
                                }
                            }}
                        />
                        {uiState.isLoading ? (
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


