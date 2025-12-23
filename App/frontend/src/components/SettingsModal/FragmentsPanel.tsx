import React, { useState, useCallback } from 'react';
import FragmentTreeNav from './FragmentTreeNav';
import FragmentEditor from './FragmentEditor';
import { fragmentService } from '../../api/fragmentService';
import { PromptManager } from '../../llm/PromptManager';
import { IconButton } from '../IconButton';
import { TextButton } from '../TextButton';
import { ChevronLeft, ChevronRight, Document, Close } from '../icons';
import TemplateSyntaxHint from './TemplateSyntaxHint';
import './FragmentsPanel.css';

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

const FragmentsPanel: React.FC = () => {
  const [selectedFragment, setSelectedFragment] = useState<SelectedFragment | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createFolderPath, setCreateFolderPath] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

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

  const selectedPath = selectedFragment
    ? (selectedFragment.folderPath
      ? `${selectedFragment.folderPath}/${selectedFragment.fragmentName}`
      : selectedFragment.fragmentName)
    : null;

  return (
    <div className={`panel-split ${isSidebarCollapsed ? 'panel-split--collapsed' : ''}`}>
      {/* Mobile Backdrop */}
      {!isSidebarCollapsed && (
        <div className="panel-split__backdrop" onClick={() => setIsSidebarCollapsed(true)} />
      )}

      {/* Main Content Area */}
      <main className="panel-split__main">
        {selectedFragment ? (
          <div className="editor-wrapper">
            <header className="editor-wrapper__header">
              <div className="editor-wrapper__title-group">
                <h3 className="editor-wrapper__title">Edit Fragment</h3>
                <p className="editor-wrapper__description">
                  Reusable template snippet that can be included in prompts using{' '}
                  <code>{`{{prompt "${selectedPath}"}}`}</code>
                </p>
              </div>
              <div className="editor-wrapper__actions">
                <TemplateSyntaxHint selectedNode={null} />
                <IconButton
                  icon={isSidebarCollapsed ? <ChevronLeft size="sm" /> : <ChevronRight size="sm" />}
                  onClick={toggleSidebar}
                  title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  size="sm"
                />
              </div>
            </header>

            <div className="editor-wrapper__body">
              <FragmentEditor
                key={selectedPath}
                folderPath={selectedFragment.folderPath}
                fragmentName={selectedFragment.fragmentName}
                onDelete={handleFragmentDeleted}
                onSave={handleFragmentSaved}
              />
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state__icon"><Document size="4xl" /></div>
            <h3 className="empty-state__title">Select a fragment to edit</h3>
            <p className="empty-state__text">Choose a fragment from the sidebar or create a new one</p>
            <TextButton
              variant="primary"
              size="md"
              onClick={() => handleCreateFragment(null)}
            >
              Create New Fragment
            </TextButton>
          </div>
        )}
      </main>

      {/* Right Sidebar: Tree navigation */}
      <aside className="panel-split__sidebar">
        <FragmentTreeNav
          selectedPath={selectedPath}
          onFragmentSelect={handleFragmentSelect}
          onCreateFragment={handleCreateFragment}
          refreshTrigger={refreshTrigger}
          onClose={() => setIsSidebarCollapsed(true)}
        />
      </aside>

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

export default FragmentsPanel;