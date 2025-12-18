import React, { useState, useCallback } from 'react';
import FragmentTreeNav from './FragmentTreeNav';
import FragmentEditor from './FragmentEditor';
import { fragmentService } from '../../api/fragmentService';
import { PromptManager } from '../../llm/PromptManager';
import { IconButton } from '../IconButton';
import { TextButton } from '../TextButton';
import { ChevronLeft, ChevronRight, Document } from '../icons';
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

    // Validate name (alphanumeric, dash, underscore)
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
      <div className="create-fragment-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Create New Fragment</h3>

        <div className="form-group">
          <label htmlFor="fragment-folder">Folder Path (optional)</label>
          <input
            id="fragment-folder"
            type="text"
            value={newFolderPath}
            onChange={(e) => setNewFolderPath(e.target.value)}
            placeholder="e.g., common/context"
          />
          <small>Use forward slashes to create nested folders</small>
        </div>

        <div className="form-group">
          <label htmlFor="fragment-name">Fragment Name *</label>
          <input
            id="fragment-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., customThinkingInstruction"
            autoFocus
          />
        </div>

        <div className="form-group">
          <label htmlFor="fragment-desc">Description (optional)</label>
          <input
            id="fragment-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of this fragment"
          />
        </div>

        <div className="form-group">
          <label htmlFor="fragment-content">Initial Content (optional)</label>
          <textarea
            id="fragment-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="{{! Your fragment content here }}"
            rows={4}
          />
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="modal-actions">
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
        </div>
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
  };

  const handleCreateFragment = (folderPath: string | null) => {
    setCreateFolderPath(folderPath);
    setShowCreateModal(true);
  };

  const handleFragmentCreated = (folderPath: string | null, fragmentName: string) => {
    // Refresh tree and select new fragment
    setRefreshTrigger((prev) => prev + 1);
    setSelectedFragment({ folderPath, fragmentName });
    // Reload fragments in PromptManager
    PromptManager.reloadFragments();
  };

  const handleFragmentDeleted = () => {
    setSelectedFragment(null);
    setRefreshTrigger((prev) => prev + 1);
    // Reload fragments in PromptManager
    PromptManager.reloadFragments();
  };

  const handleFragmentSaved = () => {
    // Reload fragments in PromptManager after save
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
    <div className={`fragments-panel ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Left content: Fragment editor */}
      <div className="fragments-content">
        <div className="fragments-content-body">
          {selectedFragment ? (
            <div className="fragments-editor-container">
              {/* Header */}
              <div className="fragments-editor-header">
                <div className="fragments-editor-header-text">
                  <h3>Edit Fragment</h3>
                  <p className="fragments-editor-description">
                    Reusable template snippet that can be included in prompts using{' '}
                    <code>{`{{prompt "${selectedPath}"}}`}</code>
                  </p>
                </div>
                <div className="fragments-editor-header-actions">
                  <TemplateSyntaxHint selectedNode={null} />
                  <IconButton
                    icon={isSidebarCollapsed ? <ChevronLeft size="sm" /> : <ChevronRight size="sm" />}
                    onClick={toggleSidebar}
                    title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                    size="sm"
                  />
                </div>
              </div>

              {/* Fragment editor */}
              <FragmentEditor
                key={selectedPath}
                folderPath={selectedFragment.folderPath}
                fragmentName={selectedFragment.fragmentName}
                onDelete={handleFragmentDeleted}
                onSave={handleFragmentSaved}
              />
            </div>
          ) : (
            <div className="fragments-empty-state">
              <div className="empty-state-icon"><Document size="4xl" /></div>
              <h3>Select a fragment to edit</h3>
              <p>Choose a fragment from the sidebar or create a new one</p>
              <TextButton
                variant="primary"
                size="md"
                onClick={() => handleCreateFragment(null)}
              >
                Create New Fragment
              </TextButton>
            </div>
          )}
        </div>
      </div>

      {/* Right sidebar: Tree navigation */}
      <div className="fragments-sidebar">
        <FragmentTreeNav
          selectedPath={selectedPath}
          onFragmentSelect={handleFragmentSelect}
          onCreateFragment={handleCreateFragment}
          refreshTrigger={refreshTrigger}
        />
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

export default FragmentsPanel;
