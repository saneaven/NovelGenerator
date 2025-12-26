import React, { useState, useEffect } from 'react';
import PromptTreeNav from './PromptTreeNav';
import FragmentTreeNav from './FragmentTreeNav';
import TemplateEditor from './TemplateEditor';
import { usePromptEditor } from './hooks/usePromptEditor';
import { useFragmentEditor } from './hooks/useFragmentEditor';
import { fragmentService } from '../../api/fragmentService';
import { PromptManager } from '../../llm/PromptManager';
import { PROMPT_TREE, getFirstPromptNode, type PromptNode } from './promptTree';
import { IconButton } from '../IconButton';
import { TextButton } from '../TextButton';
import { ChevronLeft, ChevronRight, Document, Copy } from '../icons';
import './PromptsTemplatesPanel.css';
import TemplateSyntaxHint from './TemplateSyntaxHint';

type SubTab = 'prompts' | 'fragments';

interface SelectedFragment {
    folderPath: string | null;
    fragmentName: string;
}

interface CreateFragmentModalProps {
    folderPath: string | null;
    onClose: () => void;
    onCreate: (folderPath: string | null, fragmentName: string) => void;
}

const CreateFragmentModal: React.FC<CreateFragmentModalProps> = ({
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
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <header className="modal-header">
                    <h3>Create New Fragment</h3>
                </header>

                <div className="modal-body">
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
                </div>

                <footer className="modal-footer">
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
                </footer>
            </div>
        </div>
    );
};

// Prompt Editor Wrapper using hook
const PromptEditorWrapper: React.FC<{
    node: PromptNode;
}> = ({ node }) => {
    const editor = usePromptEditor(
        node.functionType!,
        node.category!,
        node.name
    );

    return (
        <TemplateEditor
            mode="prompt"
            content={editor.content}
            onContentChange={editor.setContent}
            validation={editor.validation}
            isLoading={editor.isLoading}
            isSaving={editor.isSaving}
            hasChanges={editor.hasChanges}
            onSave={editor.onSave}
            versionHistoryProps={editor.versionHistoryProps}
            onRestoreVersion={editor.reload}
        />
    );
};

// Fragment Editor Wrapper using hook
const FragmentEditorWrapper: React.FC<{
    folderPath: string | null;
    fragmentName: string;
    onDelete: () => void;
    onSave: () => void;
}> = ({ folderPath, fragmentName, onDelete, onSave }) => {
    const editor = useFragmentEditor(folderPath, fragmentName, {
        onDeleted: onDelete,
        onSaved: onSave,
    });

    return (
        <TemplateEditor
            mode="fragment"
            content={editor.content}
            onContentChange={editor.setContent}
            validation={editor.validation}
            isLoading={editor.isLoading}
            isSaving={editor.isSaving}
            hasChanges={editor.hasChanges}
            onSave={editor.onSave}
            versionHistoryProps={editor.versionHistoryProps}
            onRestoreVersion={editor.reload}
            fragmentDescription={editor.description}
            onDescriptionChange={editor.setDescription}
            onDelete={editor.onDelete}
            isDeleting={editor.isDeleting}
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

    // Initialize with first prompt on mount
    useEffect(() => {
        const firstPrompt = getFirstPromptNode();
        if (firstPrompt) {
            setSelectedPrompt(firstPrompt);
        }
    }, []);

    const handlePromptSelect = (node: PromptNode) => {
        if (node.type === 'prompt') {
            setSelectedPrompt(node);
            // On mobile, collapse sidebar after selection
            if (window.innerWidth <= 768) {
                setIsSidebarCollapsed(true);
            }
        }
    };

    const handleFragmentSelect = (folderPath: string | null, fragmentName: string) => {
        setSelectedFragment({ folderPath, fragmentName });
        // On mobile, collapse sidebar after selection
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
        // Clear selection when switching tabs
        if (newTab === 'prompts') {
            setSelectedFragment(null);
        } else {
            setSelectedPrompt(null);
        }
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
        if (subTab === 'fragments' && selectedFragment) {
            return (
                <>
                    Reusable template snippet that can be included in prompts using{' '}
                    <code>{`{{prompt "${selectedPath}"}}`}</code>
                </>
            );
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
                                        {getEditorDescription() && (
                                            <p className="editor-wrapper__description">
                                                {getEditorDescription()}
                                            </p>
                                        )}
                                    </div>
                                    <div className="editor-wrapper__actions">
                                        <TemplateSyntaxHint selectedNode={subTab === 'prompts' ? selectedPrompt : null} />
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
                                        />
                                    )}
                                    {subTab === 'fragments' && selectedFragment && (
                                        <FragmentEditorWrapper
                                            key={selectedPath}
                                            folderPath={selectedFragment.folderPath}
                                            fragmentName={selectedFragment.fragmentName}
                                            onDelete={handleFragmentDeleted}
                                            onSave={handleFragmentSaved}
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
            {showCreateModal && (
                <CreateFragmentModal
                    folderPath={createFolderPath}
                    onClose={() => setShowCreateModal(false)}
                    onCreate={handleFragmentCreated}
                />
            )}
        </div>
    );
};

export default PromptsTemplatesPanel;
