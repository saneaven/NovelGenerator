import React, { useState, useEffect, useCallback, useRef } from 'react';
import PromptTreeNav from './PromptTreeNav';
import FragmentTreeNav from './FragmentTreeNav';
import TemplateEditor from './TemplateEditor';
import VersionHistoryModal from '../VersionHistoryModal';
import { BaseModal } from '../BaseModal';
import { usePromptEditor } from './hooks/usePromptEditor';
import { useFragmentEditor } from './hooks/useFragmentEditor';
import { fragmentService } from '../../api/fragmentService';
import { PromptManager } from '../../llm/PromptManager';
import { PROMPT_TREE, getFirstPromptNode, type PromptNode } from './promptTree';
import { IconButton } from '../IconButton';
import { TextButton } from '../TextButton';
import { ChevronLeft, ChevronRight, Document, Copy, Clock, Trash, Edit } from '../icons';
import './PromptsTemplatesPanel.css';
import TemplateSyntaxHint from './TemplateSyntaxHint';

type SubTab = 'prompts' | 'fragments';

interface SelectedFragment {
    folderPath: string | null;
    fragmentName: string;
}

interface EditorState {
    content: string;
    hasChanges: boolean;
    isSaving: boolean;
    isDeleting?: boolean;
    description?: string;
    setDescription?: (desc: string) => void;
    versionHistoryProps?: {
        title: string;
        loadVersions: () => Promise<any[]>;
        restoreVersion: (versionNumber: number) => Promise<void>;
    };
    reload?: () => void;
    onDelete?: () => void;
}

interface CreateFragmentModalProps {
    isOpen: boolean;
    folderPath: string | null;
    onClose: () => void;
    onCreate: (folderPath: string | null, fragmentName: string) => void;
}

const CreateFragmentModal: React.FC<CreateFragmentModalProps> = ({
    isOpen,
    folderPath,
    onClose,
    onCreate,
}) => {
    const [name, setName] = useState('');
    const [newFolderPath, setNewFolderPath] = useState(folderPath || '');
    const [content, setContent] = useState('');
    const [description, setDescription] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState('');

    const handleCreate = async () => {
        if (!name.trim()) {
            setError('Fragment name is required');
            return;
        }

        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
            setError('Fragment name can only contain letters, numbers, dashes, and underscores');
            return;
        }

        setIsCreating(true);
        setError('');

        try {
            const finalFolderPath = newFolderPath.trim() || null;
            await fragmentService.createFragment(
                finalFolderPath,
                name.trim(),
                content || `{{! ${name} fragment }}`,
                description || undefined,
                'Initial creation'
            );
            onCreate(finalFolderPath, name.trim());
            onClose();
        } catch (err: any) {
            if (err.message?.includes('409') || err.message?.includes('already exists')) {
                setError('A fragment with this name already exists in this folder');
            } else {
                setError('Failed to create fragment. Please try again.');
            }
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Create New Fragment"
            size="small"
            zIndexLayer={1}
            footer={
                <>
                    <TextButton variant="secondary" onClick={onClose}>
                        Cancel
                    </TextButton>
                    <TextButton
                        variant="primary"
                        onClick={handleCreate}
                        disabled={isCreating || !name.trim()}
                        loading={isCreating}
                    >
                        Create Fragment
                    </TextButton>
                </>
            }
        >
            <div className="form-group">
                <label className="form-label" htmlFor="fragment-folder">Folder Path (optional)</label>
                <input
                    id="fragment-folder"
                    className="form-input"
                    type="text"
                    value={newFolderPath}
                    onChange={(e) => setNewFolderPath(e.target.value)}
                    placeholder="e.g., common/context"
                />
                <small className="form-hint">Use forward slashes to create nested folders</small>
            </div>

            <div className="form-group">
                <label className="form-label" htmlFor="fragment-name">Fragment Name *</label>
                <input
                    id="fragment-name"
                    className="form-input"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., customThinkingInstruction"
                    autoFocus
                />
            </div>

            <div className="form-group">
                <label className="form-label" htmlFor="fragment-desc">Description (optional)</label>
                <input
                    id="fragment-desc"
                    className="form-input"
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Brief description of this fragment"
                />
            </div>

            <div className="form-group">
                <label className="form-label" htmlFor="fragment-content">Initial Content (optional)</label>
                <textarea
                    id="fragment-content"
                    className="form-textarea"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="{{! Your fragment content here }}"
                    rows={4}
                />
            </div>

            {error && <div className="form-error">{error}</div>}
        </BaseModal>
    );
};

// Prompt Editor Wrapper - exposes state for header
const PromptEditorWrapper: React.FC<{
    node: PromptNode;
    onStateChange: (state: EditorState) => void;
}> = ({ node, onStateChange }) => {
    const editor = usePromptEditor(
        node.functionType!,
        node.category!,
        node.name
    );

    // Track previous primitive values to avoid infinite loops
    const prevStateRef = useRef({ content: '', hasChanges: false, isSaving: false });

    // Notify parent of state changes - only when primitive values change
    useEffect(() => {
        const prev = prevStateRef.current;
        if (prev.content !== editor.content ||
            prev.hasChanges !== editor.hasChanges ||
            prev.isSaving !== editor.isSaving) {
            prevStateRef.current = {
                content: editor.content,
                hasChanges: editor.hasChanges,
                isSaving: editor.isSaving
            };
            onStateChange({
                content: editor.content,
                hasChanges: editor.hasChanges,
                isSaving: editor.isSaving,
                versionHistoryProps: editor.versionHistoryProps,
                reload: editor.reload,
            });
        }
    }, [editor.content, editor.hasChanges, editor.isSaving, editor.versionHistoryProps, editor.reload, onStateChange]);

    return (
        <TemplateEditor
            content={editor.content}
            onContentChange={editor.setContent}
            validation={editor.validation}
            isLoading={editor.isLoading}
            isSaving={editor.isSaving}
            hasChanges={editor.hasChanges}
            onSave={async () => { await editor.onSave(); }}
            placeholder="Enter prompt template..."
        />
    );
};

// Fragment Editor Wrapper - exposes state for header
const FragmentEditorWrapper: React.FC<{
    folderPath: string | null;
    fragmentName: string;
    onDelete: () => void;
    onSave: () => void;
    onStateChange: (state: EditorState) => void;
}> = ({ folderPath, fragmentName, onDelete, onSave, onStateChange }) => {
    const editor = useFragmentEditor(folderPath, fragmentName, {
        onDeleted: onDelete,
        onSaved: onSave,
    });

    // Track previous primitive values to avoid infinite loops
    const prevStateRef = useRef({
        content: '',
        hasChanges: false,
        isSaving: false,
        isDeleting: false,
        description: ''
    });

    // Notify parent of state changes - only when primitive values change
    useEffect(() => {
        const prev = prevStateRef.current;
        if (prev.content !== editor.content ||
            prev.hasChanges !== editor.hasChanges ||
            prev.isSaving !== editor.isSaving ||
            prev.isDeleting !== editor.isDeleting ||
            prev.description !== editor.description) {
            prevStateRef.current = {
                content: editor.content,
                hasChanges: editor.hasChanges,
                isSaving: editor.isSaving,
                isDeleting: editor.isDeleting,
                description: editor.description
            };
            onStateChange({
                content: editor.content,
                hasChanges: editor.hasChanges,
                isSaving: editor.isSaving,
                isDeleting: editor.isDeleting,
                description: editor.description,
                setDescription: editor.setDescription,
                versionHistoryProps: editor.versionHistoryProps,
                reload: editor.reload,
                onDelete: editor.onDelete,
            });
        }
    }, [
        editor.content, editor.hasChanges, editor.isSaving, editor.isDeleting,
        editor.description, editor.setDescription, editor.versionHistoryProps,
        editor.reload, editor.onDelete, onStateChange
    ]);

    return (
        <TemplateEditor
            content={editor.content}
            onContentChange={editor.setContent}
            validation={editor.validation}
            isLoading={editor.isLoading}
            isSaving={editor.isSaving}
            hasChanges={editor.hasChanges}
            onSave={async () => { await editor.onSave(); }}
            placeholder="Enter fragment template..."
        />
    );
};

const PromptsTemplatesPanel: React.FC = () => {
    const [subTab, setSubTab] = useState<SubTab>('prompts');
    const [selectedPrompt, setSelectedPrompt] = useState<PromptNode | null>(null);
    const [selectedFragment, setSelectedFragment] = useState<SelectedFragment | null>(null);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createFolderPath, setCreateFolderPath] = useState<string | null>(null);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    // Editor state from wrappers
    const [editorState, setEditorState] = useState<EditorState | null>(null);

    // Version history modal
    const [showVersionHistory, setShowVersionHistory] = useState(false);

    // Inline description editing
    const [isEditingDescription, setIsEditingDescription] = useState(false);
    const [editedDescription, setEditedDescription] = useState('');

    // Memoize state change handler to prevent infinite loops
    const handleEditorStateChange = useCallback((state: EditorState) => {
        setEditorState(state);
    }, []);

    // Initialize with first prompt on mount
    useEffect(() => {
        const firstPrompt = getFirstPromptNode();
        if (firstPrompt) {
            setSelectedPrompt(firstPrompt);
        }
    }, []);

    // Reset editor state when selection changes
    useEffect(() => {
        setEditorState(null);
        setIsEditingDescription(false);
    }, [selectedPrompt, selectedFragment]);

    const handlePromptSelect = (node: PromptNode) => {
        if (node.type === 'prompt') {
            setSelectedPrompt(node);
            if (window.innerWidth <= 768) {
                setIsSidebarCollapsed(true);
            }
        }
    };

    const handleFragmentSelect = (folderPath: string | null, fragmentName: string) => {
        setSelectedFragment({ folderPath, fragmentName });
        if (window.innerWidth <= 768) {
            setIsSidebarCollapsed(true);
        }
    };

    const handleCreateFragment = (folderPath: string | null) => {
        setCreateFolderPath(folderPath);
        setShowCreateModal(true);
    };

    const handleFragmentCreated = (folderPath: string | null, fragmentName: string) => {
        setRefreshTrigger((prev) => prev + 1);
        setSelectedFragment({ folderPath, fragmentName });
        PromptManager.reloadFragments();
    };

    const handleFragmentDeleted = () => {
        setSelectedFragment(null);
        setRefreshTrigger((prev) => prev + 1);
        PromptManager.reloadFragments();
    };

    const handleFragmentSaved = () => {
        PromptManager.reloadFragments();
    };

    const toggleSidebar = () => {
        setIsSidebarCollapsed(!isSidebarCollapsed);
    };

    const handleSubTabChange = (newTab: SubTab) => {
        setSubTab(newTab);
        if (newTab === 'prompts') {
            setSelectedFragment(null);
        } else {
            setSelectedPrompt(null);
        }
    };

    const handleRestoreComplete = () => {
        editorState?.reload?.();
        setShowVersionHistory(false);
    };

    const handleStartEditDescription = () => {
        setEditedDescription(editorState?.description || '');
        setIsEditingDescription(true);
    };

    const handleSaveDescription = () => {
        editorState?.setDescription?.(editedDescription);
        setIsEditingDescription(false);
    };

    const handleCancelEditDescription = () => {
        setIsEditingDescription(false);
    };

    const selectedPath = selectedFragment
        ? (selectedFragment.folderPath
            ? `${selectedFragment.folderPath}/${selectedFragment.fragmentName}`
            : selectedFragment.fragmentName)
        : null;

    const getEditorTitle = () => {
        if (subTab === 'prompts' && selectedPrompt) {
            return selectedPrompt.label;
        }
        if (subTab === 'fragments' && selectedPath) {
            return selectedPath;
        }
        return '';
    };

    const handleCopyFragmentPath = () => {
        if (selectedPath) {
            const pathToCopy = `{{prompt "${selectedPath}"}}`;
            navigator.clipboard.writeText(pathToCopy);
        }
    };

    const getEditorDescription = () => {
        if (subTab === 'prompts' && selectedPrompt?.description) {
            return selectedPrompt.description;
        }
        return null;
    };

    const hasSelection = (subTab === 'prompts' && selectedPrompt) ||
        (subTab === 'fragments' && selectedFragment);

    return (
        <div className="prompts-layout">
            <div className="prompts-layout__content">
                <div className={`panel-split ${isSidebarCollapsed ? 'panel-split--collapsed' : ''}`}>
                    {/* Mobile Backdrop */}
                    {!isSidebarCollapsed && (
                        <div className="panel-split__backdrop" onClick={() => setIsSidebarCollapsed(true)} />
                    )}

                    {/* Main Content Area */}
                    <main className="panel-split__main">
                        {hasSelection ? (
                            <div className="editor-wrapper">
                                {/* Header */}
                                <header className="editor-wrapper__header">
                                    <div className="editor-wrapper__title-group">
                                        <div className="editor-wrapper__title-row">
                                            <h3 className="editor-wrapper__title">{getEditorTitle()}</h3>
                                            {subTab === 'fragments' && selectedPath && (
                                                <IconButton
                                                    icon={<Copy size="sm" />}
                                                    onClick={handleCopyFragmentPath}
                                                    title="Copy path for use in templates"
                                                    size="xs"
                                                    className="editor-wrapper__copy-btn"
                                                />
                                            )}
                                        </div>

                                        {/* Description - inline editable for fragments */}
                                        {subTab === 'fragments' && editorState ? (
                                            <div className="editor-wrapper__description editor-wrapper__description--editable">
                                                {isEditingDescription ? (
                                                    <input
                                                        type="text"
                                                        value={editedDescription}
                                                        onChange={(e) => setEditedDescription(e.target.value)}
                                                        onBlur={handleSaveDescription}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') handleSaveDescription();
                                                            if (e.key === 'Escape') handleCancelEditDescription();
                                                        }}
                                                        placeholder="Add description..."
                                                        className="editor-wrapper__description-input"
                                                        autoFocus
                                                    />
                                                ) : (
                                                    <>
                                                        <span className="editor-wrapper__description-text">
                                                            {editorState.description || 'No description'}
                                                        </span>
                                                        <button
                                                            className="editor-wrapper__description-edit"
                                                            onClick={handleStartEditDescription}
                                                            title="Edit description"
                                                        >
                                                            <Edit size="xs" />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        ) : (
                                            getEditorDescription() && (
                                                <p className="editor-wrapper__description">
                                                    {getEditorDescription()}
                                                </p>
                                            )
                                        )}

                                        {/* Meta info */}
                                        {editorState && (
                                            <div className="editor-wrapper__meta">
                                                <span>{editorState.content.length} chars</span>
                                                {editorState.hasChanges && (
                                                    <span className="editor-wrapper__unsaved"> • Unsaved changes</span>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    <div className="editor-wrapper__actions">
                                        <TemplateSyntaxHint selectedNode={subTab === 'prompts' ? selectedPrompt : null} />

                                        {/* History button */}
                                        {editorState?.versionHistoryProps && (
                                            <IconButton
                                                icon={<Clock size="sm" />}
                                                onClick={() => setShowVersionHistory(true)}
                                                title="Version history"
                                                size="sm"
                                                disabled={editorState.isSaving || editorState.isDeleting}
                                            />
                                        )}

                                        {/* Delete button (fragments only) */}
                                        {subTab === 'fragments' && editorState?.onDelete && (
                                            <IconButton
                                                icon={<Trash size="sm" />}
                                                onClick={editorState.onDelete}
                                                title="Delete fragment"
                                                size="sm"
                                                disabled={editorState.isDeleting || editorState.isSaving}
                                                className="editor-wrapper__delete-btn"
                                            />
                                        )}

                                        <IconButton
                                            icon={isSidebarCollapsed ? <ChevronLeft size="sm" /> : <ChevronRight size="sm" />}
                                            onClick={toggleSidebar}
                                            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                                            size="sm"
                                        />
                                    </div>
                                </header>

                                {/* Editor Component */}
                                <div className="editor-wrapper__body">
                                    {subTab === 'prompts' && selectedPrompt && (
                                        <PromptEditorWrapper
                                            key={`${selectedPrompt.functionType}-${selectedPrompt.category}-${selectedPrompt.name || ''}`}
                                            node={selectedPrompt}
                                            onStateChange={handleEditorStateChange}
                                        />
                                    )}
                                    {subTab === 'fragments' && selectedFragment && (
                                        <FragmentEditorWrapper
                                            key={selectedPath}
                                            folderPath={selectedFragment.folderPath}
                                            fragmentName={selectedFragment.fragmentName}
                                            onDelete={handleFragmentDeleted}
                                            onSave={handleFragmentSaved}
                                            onStateChange={handleEditorStateChange}
                                        />
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="empty-state">
                                <div className="empty-state__icon"><Document size="4xl" /></div>
                                <h3 className="empty-state__title">
                                    {subTab === 'prompts' ? 'Select a prompt to edit' : 'Select a fragment to edit'}
                                </h3>
                                <p className="empty-state__text">
                                    {subTab === 'prompts'
                                        ? 'Choose a prompt from the sidebar to view and edit its content'
                                        : 'Choose a fragment from the sidebar or create a new one'}
                                </p>
                                {subTab === 'fragments' && (
                                    <TextButton
                                        variant="primary"
                                        size="md"
                                        onClick={() => handleCreateFragment(null)}
                                    >
                                        Create New Fragment
                                    </TextButton>
                                )}
                            </div>
                        )}
                    </main>

                    {/* Sidebar */}
                    <aside className="panel-split__sidebar">
                        {/* Toggle at top of sidebar */}
                        <div className="sidebar-toggle">
                            <button
                                className={`sidebar-toggle__btn ${subTab === 'prompts' ? 'sidebar-toggle__btn--active' : ''}`}
                                onClick={() => handleSubTabChange('prompts')}
                            >
                                Prompts
                            </button>
                            <button
                                className={`sidebar-toggle__btn ${subTab === 'fragments' ? 'sidebar-toggle__btn--active' : ''}`}
                                onClick={() => handleSubTabChange('fragments')}
                            >
                                Fragments
                            </button>
                        </div>

                        {/* Tree Navigation */}
                        {subTab === 'prompts' ? (
                            <PromptTreeNav
                                tree={PROMPT_TREE}
                                selectedNodeId={selectedPrompt?.id || null}
                                onNodeSelect={handlePromptSelect}
                                onClose={() => setIsSidebarCollapsed(true)}
                            />
                        ) : (
                            <FragmentTreeNav
                                selectedPath={selectedPath}
                                onFragmentSelect={handleFragmentSelect}
                                onCreateFragment={handleCreateFragment}
                                refreshTrigger={refreshTrigger}
                                onClose={() => setIsSidebarCollapsed(true)}
                            />
                        )}
                    </aside>
                </div>
            </div>

            {/* Create fragment modal */}
            <CreateFragmentModal
                isOpen={showCreateModal}
                folderPath={createFolderPath}
                onClose={() => setShowCreateModal(false)}
                onCreate={handleFragmentCreated}
            />

            {/* Version history modal */}
            {showVersionHistory && editorState?.versionHistoryProps && (
                <VersionHistoryModal
                    isOpen={showVersionHistory}
                    onClose={() => setShowVersionHistory(false)}
                    onRestoreVersion={handleRestoreComplete}
                    textVersionProps={editorState.versionHistoryProps}
                />
            )}
        </div>
    );
};

export default PromptsTemplatesPanel;
