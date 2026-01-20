import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import PromptTreeNav from './PromptTreeNav';
import FragmentTreeNav from './FragmentTreeNav';
import VariableListNav from './VariableListNav';
import VariableEditor from './VariableEditor';
import CreateVariableModal from './CreateVariableModal';
import TemplateEditor from './TemplateEditor';
import VersionHistoryModal from '../../Modal/VersionHistoryModal';
import PresetSelector from '../PresetSelector';
import PresetModal from '../PresetModal';
import { BaseModal } from '../../BaseModal';
import { usePromptEditor } from '../hooks/usePromptEditor';
import { useFragmentEditor } from '../hooks/useFragmentEditor';
import { usePresetStore } from '../../../store/presetStore';
import { fragmentService } from '../../../api/fragmentService';
import { PromptManager } from '../../../llm/PromptManager';
import { PROMPT_TREE, getFirstPromptNode, type PromptNode } from './promptTree';
import { IconButton } from '../../IconButton';
import { TextButton } from '../../TextButton';
import { ChevronLeft, ChevronRight, Document, Copy, Clock, Trash, Edit } from '../../icons';
import './PromptsTemplatesPanel.css';
import TemplateSyntaxHint from './TemplateSyntaxHint';
import type { PresetListItem } from '../../../types/presets';

type SubTab = 'prompts' | 'fragments' | 'variables';

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
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [newFolderPath, setNewFolderPath] = useState(folderPath || '');
    const [content, setContent] = useState('');
    const [description, setDescription] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState('');

    const handleCreate = async () => {
        if (!name.trim()) {
            setError(t('settings.promptEditor.createFragment.nameRequired'));
            return;
        }

        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
            setError(t('settings.promptEditor.createFragment.invalidName'));
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
                setError(t('settings.promptEditor.createFragment.duplicateName'));
            } else {
                setError(t('settings.promptEditor.createFragment.createFailed'));
            }
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title={t('settings.promptEditor.createFragment.title')}
            size="small"
            zIndexLayer={1}
            footer={
                <>
                    <TextButton variant="secondary" onClick={onClose}>
                        {t('common.cancel')}
                    </TextButton>
                    <TextButton
                        variant="primary"
                        onClick={handleCreate}
                        disabled={isCreating || !name.trim()}
                        loading={isCreating}
                    >
                        {t('settings.promptEditor.createNewFragment')}
                    </TextButton>
                </>
            }
        >
            <div className="form-group">
                <label className="form-label" htmlFor="fragment-folder">{t('settings.promptEditor.createFragment.folderPath')}</label>
                <input
                    id="fragment-folder"
                    className="form-input"
                    type="text"
                    value={newFolderPath}
                    onChange={(e) => setNewFolderPath(e.target.value)}
                    placeholder={t('settings.promptEditor.createFragment.folderPathPlaceholder')}
                />
                <small className="form-hint">{t('settings.promptEditor.createFragment.folderPathHint')}</small>
            </div>

            <div className="form-group">
                <label className="form-label" htmlFor="fragment-name">{t('settings.promptEditor.createFragment.fragmentName')}</label>
                <input
                    id="fragment-name"
                    className="form-input"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('settings.promptEditor.createFragment.fragmentNamePlaceholder')}
                    autoFocus
                />
            </div>

            <div className="form-group">
                <label className="form-label" htmlFor="fragment-desc">{t('settings.promptEditor.createFragment.description')}</label>
                <input
                    id="fragment-desc"
                    className="form-input"
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('settings.promptEditor.createFragment.descriptionPlaceholder')}
                />
            </div>

            <div className="form-group">
                <label className="form-label" htmlFor="fragment-content">{t('settings.promptEditor.createFragment.initialContent')}</label>
                <textarea
                    id="fragment-content"
                    className="form-textarea"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={t('settings.promptEditor.createFragment.initialContentPlaceholder')}
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
    const { t } = useTranslation();
    const editor = usePromptEditor(
        node.functionType!,
        node.category!,
        node.name!
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
            placeholder={t('settings.promptEditor.enterPromptTemplate')}
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
    const { t } = useTranslation();
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
            placeholder={t('settings.promptEditor.enterFragmentTemplate')}
        />
    );
};

const PromptsTemplatesPanel: React.FC = () => {
    const { t } = useTranslation();
    const [subTab, setSubTab] = useState<SubTab>('prompts');
    const [selectedPrompt, setSelectedPrompt] = useState<PromptNode | null>(null);
    const [selectedFragment, setSelectedFragment] = useState<SelectedFragment | null>(null);
    const [selectedVariableId, setSelectedVariableId] = useState<string | null>(null);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showCreateVariableModal, setShowCreateVariableModal] = useState(false);
    const [createFolderPath, setCreateFolderPath] = useState<string | null>(null);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    // Editor state from wrappers
    const [editorState, setEditorState] = useState<EditorState | null>(null);

    // Version history modal
    const [showVersionHistory, setShowVersionHistory] = useState(false);

    // Inline description editing
    const [isEditingDescription, setIsEditingDescription] = useState(false);
    const [editedDescription, setEditedDescription] = useState('');

    // Preset modal state
    const [showPresetModal, setShowPresetModal] = useState(false);
    const [presetModalMode, setPresetModalMode] = useState<'create' | 'duplicate' | 'edit'>('create');
    const [presetModalSource, setPresetModalSource] = useState<PresetListItem | null>(null);
    const { getPresetById } = usePresetStore();

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
            setSelectedVariableId(null);
        } else if (newTab === 'fragments') {
            setSelectedPrompt(null);
            setSelectedVariableId(null);
        } else {
            setSelectedPrompt(null);
            setSelectedFragment(null);
        }
    };

    const handleVariableSelect = (id: string) => {
        setSelectedVariableId(id);
        if (window.innerWidth <= 768) {
            setIsSidebarCollapsed(true);
        }
    };

    const handleVariableCreated = (id: string) => {
        setSelectedVariableId(id);
    };

    const handleVariableDeleted = () => {
        setSelectedVariableId(null);
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

    // Preset handlers
    const handleCreatePreset = () => {
        setPresetModalMode('create');
        setPresetModalSource(null);
        setShowPresetModal(true);
    };

    const handleDuplicatePreset = (presetId: string) => {
        const preset = getPresetById(presetId);
        if (preset) {
            setPresetModalMode('duplicate');
            setPresetModalSource(preset);
            setShowPresetModal(true);
        }
    };

    const handleEditPreset = (presetId: string) => {
        const preset = getPresetById(presetId);
        if (preset) {
            setPresetModalMode('edit');
            setPresetModalSource(preset);
            setShowPresetModal(true);
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
        return null;
    };

    const hasSelection = (subTab === 'prompts' && selectedPrompt) ||
        (subTab === 'fragments' && selectedFragment) ||
        (subTab === 'variables');

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
                        <div className="editor-wrapper">
                            {/* Header - always visible for prompts/fragments tabs, hidden for variables tab as VariableEditor has its own */}
                            {subTab !== 'variables' && (
                            <header className="editor-wrapper__header">
                                {/* Title group - only shown when something is selected */}
                                {hasSelection && (
                                <div className="editor-wrapper__title-group">
                                    <div className="editor-wrapper__title-row">
                                        <h3 className="editor-wrapper__title">{getEditorTitle()}</h3>
                                        {subTab === 'fragments' && selectedPath && (
                                            <IconButton
                                                icon={<Copy size="sm" />}
                                                onClick={handleCopyFragmentPath}
                                                title={t('settings.promptEditor.copyPathForTemplates')}
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
                                                    placeholder={t('settings.promptEditor.addDescription')}
                                                    className="editor-wrapper__description-input"
                                                    autoFocus
                                                />
                                            ) : (
                                                <>
                                                    <span className="editor-wrapper__description-text">
                                                        {editorState.description || t('settings.promptEditor.noDescription')}
                                                    </span>
                                                    <button
                                                        className="editor-wrapper__description-edit"
                                                        onClick={handleStartEditDescription}
                                                        title={t('settings.promptEditor.editDescription')}
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
                                            <span>{t('settings.promptEditor.chars', { count: editorState.content.length })}</span>
                                            {editorState.hasChanges && (
                                                <span className="editor-wrapper__unsaved"> • {t('settings.promptEditor.unsavedChanges')}</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                                )}

                                <div className="editor-wrapper__actions">
                                    {/* These buttons only show when something is selected */}
                                    {hasSelection && (
                                        <>
                                            <TemplateSyntaxHint selectedNode={subTab === 'prompts' ? selectedPrompt : null} />

                                            {/* History button */}
                                            {editorState?.versionHistoryProps && (
                                                <IconButton
                                                    icon={<Clock size="sm" />}
                                                    onClick={() => setShowVersionHistory(true)}
                                                    title={t('settings.promptEditor.versionHistory')}
                                                    size="sm"
                                                    disabled={editorState.isSaving || editorState.isDeleting}
                                                />
                                            )}

                                            {/* Delete button (fragments only) */}
                                            {subTab === 'fragments' && editorState?.onDelete && (
                                                <IconButton
                                                    icon={<Trash size="sm" />}
                                                    onClick={editorState.onDelete}
                                                    title={t('settings.promptEditor.deleteFragment')}
                                                    size="sm"
                                                    disabled={editorState.isDeleting || editorState.isSaving}
                                                    className="editor-wrapper__delete-btn"
                                                />
                                            )}
                                        </>
                                    )}

                                    {/* Sidebar toggle - ALWAYS visible */}
                                    <IconButton
                                        icon={isSidebarCollapsed ? <ChevronLeft size="sm" /> : <ChevronRight size="sm" />}
                                        onClick={toggleSidebar}
                                        title={isSidebarCollapsed ? t('settings.promptEditor.expandSidebar') : t('settings.promptEditor.collapseSidebar')}
                                        size="sm"
                                    />
                                </div>
                            </header>
                            )}

                            {/* Editor Component or Empty State */}
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
                                {subTab === 'variables' && (
                                    <VariableEditor
                                        key={selectedVariableId}
                                        variableId={selectedVariableId}
                                        onDelete={handleVariableDeleted}
                                        isSidebarCollapsed={isSidebarCollapsed}
                                        onToggleSidebar={toggleSidebar}
                                    />
                                )}
                                {/* Empty state for prompts/fragments when nothing is selected */}
                                {!hasSelection && (
                                    <div className="empty-state">
                                        <div className="empty-state__icon"><Document size="4xl" /></div>
                                        <h3 className="empty-state__title">
                                            {subTab === 'prompts' ? t('settings.promptEditor.selectPromptToEdit') : t('settings.promptEditor.selectFragmentToEdit')}
                                        </h3>
                                        <p className="empty-state__text">
                                            {subTab === 'prompts'
                                                ? t('settings.promptEditor.choosePromptHint')
                                                : t('settings.promptEditor.chooseFragmentHint')}
                                        </p>
                                        {subTab === 'fragments' && (
                                            <TextButton
                                                variant="primary"
                                                size="md"
                                                onClick={() => handleCreateFragment(null)}
                                            >
                                                {t('settings.promptEditor.createNewFragment')}
                                            </TextButton>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </main>

                    {/* Sidebar */}
                    <aside className="panel-split__sidebar">
                        {/* Preset Selector */}
                        <PresetSelector
                            onCreatePreset={handleCreatePreset}
                            onDuplicatePreset={handleDuplicatePreset}
                            onEditPreset={handleEditPreset}
                        />

                        {/* Toggle at top of sidebar */}
                        <div className="sidebar-toggle">
                            <button
                                className={`sidebar-toggle__btn ${subTab === 'prompts' ? 'sidebar-toggle__btn--active' : ''}`}
                                onClick={() => handleSubTabChange('prompts')}
                            >
                                {t('settings.promptEditor.prompts')}
                            </button>
                            <button
                                className={`sidebar-toggle__btn ${subTab === 'fragments' ? 'sidebar-toggle__btn--active' : ''}`}
                                onClick={() => handleSubTabChange('fragments')}
                            >
                                {t('settings.promptEditor.fragments')}
                            </button>
                            <button
                                className={`sidebar-toggle__btn ${subTab === 'variables' ? 'sidebar-toggle__btn--active' : ''}`}
                                onClick={() => handleSubTabChange('variables')}
                            >
                                {t('settings.promptEditor.variables')}
                            </button>
                        </div>

                        {/* Tree Navigation */}
                        {subTab === 'prompts' && (
                            <PromptTreeNav
                                tree={PROMPT_TREE}
                                selectedNodeId={selectedPrompt?.id || null}
                                onNodeSelect={handlePromptSelect}
                                onClose={() => setIsSidebarCollapsed(true)}
                            />
                        )}
                        {subTab === 'fragments' && (
                            <FragmentTreeNav
                                selectedPath={selectedPath}
                                onFragmentSelect={handleFragmentSelect}
                                onCreateFragment={handleCreateFragment}
                                refreshTrigger={refreshTrigger}
                                onClose={() => setIsSidebarCollapsed(true)}
                            />
                        )}
                        {subTab === 'variables' && (
                            <VariableListNav
                                selectedId={selectedVariableId}
                                onVariableSelect={handleVariableSelect}
                                onCreateVariable={() => setShowCreateVariableModal(true)}
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

            {/* Create variable modal */}
            <CreateVariableModal
                isOpen={showCreateVariableModal}
                onClose={() => setShowCreateVariableModal(false)}
                onCreate={handleVariableCreated}
            />

            {/* Preset modal */}
            <PresetModal
                isOpen={showPresetModal}
                onClose={() => setShowPresetModal(false)}
                mode={presetModalMode}
                sourcePreset={presetModalSource}
            />
        </div>
    );
};

export default PromptsTemplatesPanel;
